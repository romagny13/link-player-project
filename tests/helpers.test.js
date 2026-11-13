import {afterEach, describe, expect, it, vi} from "vitest";
import {
    AUTOPLAY_MODES,
    DefBuilder,
    describe as describeElement,
    isEmpty,
    isTouch,
    toAutoplayMode,
    toBoolean,
    toInt,
    toNumber
} from "../src/utils/helpers.js";

// Remarque : l'import `describe` de helpers est renommé `describeElement` pour ne pas
// entrer en collision avec le `describe` de vitest.

describe("toInt", () => {
    it("convertit une chaîne d'entier", () => {
        expect(toInt("42")).toBe(42);
        expect(toInt("-7")).toBe(-7);
    });

    it("tronque les décimaux", () => {
        expect(toInt("3.9")).toBe(3);
        expect(toInt(3.9)).toBe(3);
    });

    it("retourne undefined quand ce n'est pas un nombre", () => {
        expect(toInt("abc")).toBeUndefined();
        expect(toInt("")).toBeUndefined();
        expect(toInt(null)).toBeUndefined();
        expect(toInt(undefined)).toBeUndefined();
    });

    it("est tolérant : lit le début de la chaîne (parseInt)", () => {
        expect(toInt("12px")).toBe(12);
    });
});

describe("toNumber", () => {
    it("convertit entiers et décimaux", () => {
        expect(toNumber("3.5")).toBe(3.5);
        expect(toNumber("0")).toBe(0);
        expect(toNumber(12)).toBe(12);
    });

    it("retourne undefined pour absent, vide ou espaces", () => {
        expect(toNumber(undefined)).toBeUndefined();
        expect(toNumber(null)).toBeUndefined();
        expect(toNumber("")).toBeUndefined();
        expect(toNumber("   ")).toBeUndefined();
    });

    it("est strict : refuse un nombre suivi de texte (contrairement à toInt)", () => {
        expect(toNumber("12px")).toBeUndefined();
        expect(toNumber("abc")).toBeUndefined();
    });
});

describe("toBoolean (attribut data-*)", () => {
    it("absent => false", () => {
        expect(toBoolean(undefined)).toBe(false);
        expect(toBoolean(null)).toBe(false);
    });

    it("présent sans valeur ou \"true\" => true", () => {
        expect(toBoolean("")).toBe(true);
        expect(toBoolean("true")).toBe(true);
    });

    it("\"false\", \"0\" et \"no\" => false, sans tenir compte de la casse ni des espaces", () => {
        for (const v of ["false", "0", "no", " FALSE ", "No"]) expect(toBoolean(v)).toBe(false);
    });

    it("toute autre valeur => true", () => {
        for (const v of ["yes", "1", "oui", "n'importe quoi"]) expect(toBoolean(v)).toBe(true);
    });
});

describe("isEmpty", () => {
    it("vrai pour \"\", null et undefined", () => {
        expect(isEmpty("")).toBe(true);
        expect(isEmpty(null)).toBe(true);
        expect(isEmpty(undefined)).toBe(true);
    });

    it("faux pour les valeurs « falsy » qui ne sont pas vides", () => {
        expect(isEmpty(0)).toBe(false);
        expect(isEmpty(false)).toBe(false);
        expect(isEmpty("a")).toBe(false);
        expect(isEmpty([])).toBe(false);
    });
});

describe("isTouch", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("vrai quand matchMedia annonce un pointeur tactile sans survol", () => {
        const matchMedia = vi.fn(() => ({matches: true}));
        vi.stubGlobal("matchMedia", matchMedia);
        expect(isTouch()).toBe(true);
        expect(matchMedia).toHaveBeenCalledWith("(hover: none) and (pointer: coarse)");
    });

    it("faux quand matchMedia ne correspond pas", () => {
        vi.stubGlobal("matchMedia", () => ({matches: false}));
        expect(isTouch()).toBe(false);
    });

    it("faux quand matchMedia n'existe pas (environnement sans navigateur)", () => {
        vi.stubGlobal("matchMedia", undefined);
        expect(isTouch()).toBe(false);
    });
});

describe("AUTOPLAY_MODES", () => {
    it("expose les trois modes", () => {
        expect(AUTOPLAY_MODES).toEqual({NONE: "none", INIT: "init", CLICK: "click"});
    });

    it("est figé", () => {
        expect(Object.isFrozen(AUTOPLAY_MODES)).toBe(true);
    });
});

describe("toAutoplayMode", () => {
    it("absent => NONE", () => {
        expect(toAutoplayMode(undefined)).toBe(AUTOPLAY_MODES.NONE);
        expect(toAutoplayMode(null)).toBe(AUTOPLAY_MODES.NONE);
    });

    it("attribut présent sans valeur, \"true\" ou true => INIT", () => {
        expect(toAutoplayMode("")).toBe(AUTOPLAY_MODES.INIT);
        expect(toAutoplayMode("true")).toBe(AUTOPLAY_MODES.INIT);
        expect(toAutoplayMode(" TRUE ")).toBe(AUTOPLAY_MODES.INIT);
        expect(toAutoplayMode(true)).toBe(AUTOPLAY_MODES.INIT);
    });

    it("\"click\" => CLICK, sans tenir compte de la casse", () => {
        expect(toAutoplayMode("click")).toBe(AUTOPLAY_MODES.CLICK);
        expect(toAutoplayMode("CLICK")).toBe(AUTOPLAY_MODES.CLICK);
    });

    it("\"false\", false et valeurs inconnues => NONE", () => {
        for (const v of ["false", false, "0", "peut-être"]) expect(toAutoplayMode(v)).toBe(AUTOPLAY_MODES.NONE);
    });

    it("conserve \"none\" => NONE", () => {
        expect(toAutoplayMode(AUTOPLAY_MODES.NONE)).toBe(AUTOPLAY_MODES.NONE);
    });

    // BUG connu : "init" (la valeur de AUTOPLAY_MODES.INIT) n'est pas reconnue, alors que
    // DefBuilder.autoplay() produit justement cette valeur par défaut. Les définitions construites
    // avec le builder perdent donc leur autoplay. Quand le bug est corrigé, ce test passera et
    // vitest signalera que `it.fails` n'est plus nécessaire : remplacer alors par `it`.
    it.fails("BUG : relit sa propre valeur \"init\" => INIT (aller-retour avec DefBuilder)", () => {
        expect(toAutoplayMode(AUTOPLAY_MODES.INIT)).toBe(AUTOPLAY_MODES.INIT);
    });

    it.fails("BUG : DefBuilder.autoplay() puis toAutoplayMode() conserve l'autoplay", () => {
        const [def] = DefBuilder.video("https://ok.ru/video/1").autoplay().build();
        expect(toAutoplayMode(def.autoplay)).toBe(AUTOPLAY_MODES.INIT);
    });
});

describe("describe (description d'un élément pour les messages d'erreur)", () => {
    it("null et undefined sont affichés tels quels", () => {
        expect(describeElement(null)).toBe("null");
        expect(describeElement(undefined)).toBe("undefined");
    });

    it("balise seule, ou balise avec id", () => {
        expect(describeElement({localName: "iframe"})).toBe("<iframe>");
        expect(describeElement({localName: "iframe", id: "main"})).toBe("<iframe#main>");
    });

    it("sans localName, retombe sur le type JavaScript", () => {
        expect(describeElement({})).toBe("<object>");
    });
});
