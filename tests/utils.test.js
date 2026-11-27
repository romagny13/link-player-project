// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
    toInt, toNumber, toBool01, toBoolean, timeToSeconds, isEmpty, isTouch,
    AUTOPLAY_MODES, toAutoplayMode, describe as describeEl, SOURCE_KINDS, toFormat
} from "../src/utils/helpers.js";
import { Emitter } from "../src/utils/Emitter.js";
import { claim, release, isClaimed } from "../src/utils/ownership.js";
import { itemCountOf, toIndex } from "../src/utils/items.js";
import { ValueChecks } from "../src/utils/ValueChecks.js";
import { resolveScope, injectStyles, makeIframe } from "../src/utils/dom.js";

afterEach(() => {
    document.body.innerHTML = "";
    document.head.querySelectorAll("style").forEach((s) => s.remove());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// ───────────────────────── helpers.js ─────────────────────────
describe("toInt", () => {
    it.each([[null, null], [undefined, null], ["", null], ["12", 12], ["-3", -3], ["abc", null], ["12px", 12], [7, 7]])(
        "toInt(%j) = %j", (input, expected) => expect(toInt(input)).toBe(expected));
});

describe("toNumber", () => {
    it.each([[undefined, undefined], [null, undefined], ["", undefined], ["   ", undefined], ["abc", undefined],
        ["1.5", 1.5], ["0", 0], [3, 3]])("toNumber(%j) = %j", (input, expected) => expect(toNumber(input)).toBe(expected));
});

describe("toBool01", () => {
    it.each([["1", true], [1, true], [true, true], ["0", false], [0, false], [false, false],
        [null, null], [undefined, null], ["yes", null], ["", null], [2, null]])(
        "toBool01(%j) = %j", (input, expected) => expect(toBool01(input)).toBe(expected));
});

describe("toBoolean (attributs data-*)", () => {
    it.each([[undefined, false], [null, false], ["", true], ["true", true], ["anything", true],
        ["false", false], ["0", false], ["no", false], [" NO ", false], [" False ", false]])(
        "toBoolean(%j) = %j", (input, expected) => expect(toBoolean(input)).toBe(expected));
});

describe("timeToSeconds", () => {
    it.each([
        [null, null], [undefined, null], ["", null],
        ["90", 90], [90, 90], ["0", 0],
        ["30s", 30], ["1m", 60], ["2h", 7200], ["1h2m3s", 3723], ["1h20m3s", 4803], ["45m12s", 2712],
        ["6h6m46s", 22006], ["2H", 7200], ["1M30S", 90],
        ["abc", null], ["1x", null], ["1:30", null], ["h", null]
    ])("timeToSeconds(%j) = %j", (input, expected) => expect(timeToSeconds(input)).toBe(expected));
});

describe("isEmpty", () => {
    it.each([["", true], [null, true], [undefined, true], [0, false], [false, false], ["a", false], [[], false]])(
        "isEmpty(%j) = %j", (input, expected) => expect(isEmpty(input)).toBe(expected));
});

describe("isTouch", () => {
    it("faux quand matchMedia n'existe pas", () => {
        vi.stubGlobal("matchMedia", undefined);
        expect(isTouch()).toBe(false);
    });
    it("reflète le media query (hover: none) and (pointer: coarse)", () => {
        const mm = vi.fn(() => ({ matches: true }));
        vi.stubGlobal("matchMedia", mm);
        expect(isTouch()).toBe(true);
        expect(mm).toHaveBeenCalledWith("(hover: none) and (pointer: coarse)");
        vi.stubGlobal("matchMedia", () => ({ matches: false }));
        expect(isTouch()).toBe(false);
    });
});

describe("AUTOPLAY_MODES / toAutoplayMode", () => {
    it("constantes gelées", () => {
        expect(AUTOPLAY_MODES).toEqual({ NONE: "none", INIT: "init", CLICK: "click" });
        expect(Object.isFrozen(AUTOPLAY_MODES)).toBe(true);
    });
    it.each([[undefined, "none"], [null, "none"], ["", "init"], ["true", "init"], [true, "init"], ["init", "init"],
        ["click", "click"], [" CLICK ", "click"], ["false", "none"], ["xyz", "none"]])(
        "toAutoplayMode(%j) = %j", (input, expected) => expect(toAutoplayMode(input)).toBe(expected));
});

describe("SOURCE_KINDS", () => {
    it("valeurs attendues", () => {
        expect(SOURCE_KINDS).toEqual({ LINK: "link", FRAME: "frame", DEFINITION: "definition" });
        expect(Object.isFrozen(SOURCE_KINDS)).toBe(true);
    });
});

describe("toFormat", () => {
    it.each([
        [null, null], [undefined, null], ["", null], ["foo", null],
        ["portrait", "portrait"], ["Vertical", "portrait"], ["shorts", "portrait"], ["reel", "portrait"], ["9/16", "portrait"], ["9:16", "portrait"],
        ["landscape", "landscape"], ["wide", "landscape"], ["16:9", "landscape"], [" 16 / 9 ", "landscape"],
        ["square", "square"], ["1/1", "square"], ["1:1", "square"]
    ])("toFormat(%j) = %j", (input, expected) => expect(toFormat(input)).toBe(expected));
});

describe("describe (helpers.js)", () => {
    it("décrit un élément avec ou sans id", () => {
        const a = document.createElement("div");
        expect(describeEl(a)).toBe("<div>");
        a.id = "player";
        expect(describeEl(a)).toBe("<div#player>");
    });
    it("gère null, undefined et objets quelconques", () => {
        expect(describeEl(null)).toBe("null");
        expect(describeEl(undefined)).toBe("undefined");
        expect(describeEl({})).toBe("<object>");
    });
});

// ───────────────────────── Emitter ─────────────────────────
describe("Emitter", () => {
    it("appelle les handlers avec { ...data, type } et renvoie leur nombre", () => {
        const e = new Emitter();
        const h = vi.fn();
        e.on("change", h);
        expect(e.emit("change", { a: 1 })).toBe(1);
        expect(h).toHaveBeenCalledWith({ a: 1, type: "change" });
    });

    it("emit sans handler renvoie 0, sans data fonctionne", () => {
        const e = new Emitter();
        expect(e.emit("nobody")).toBe(0);
        const h = vi.fn();
        e.on("x", h);
        e.emit("x");
        expect(h).toHaveBeenCalledWith({ type: "x" });
    });

    it("le type de l'événement prime sur un champ `type` des données", () => {
        const e = new Emitter();
        const h = vi.fn();
        e.on("real", h);
        e.emit("real", { type: "fake" });
        expect(h.mock.calls[0][0].type).toBe("real");
    });

    it("on() renvoie une fonction de désinscription", () => {
        const e = new Emitter();
        const h = vi.fn();
        const off = e.on("x", h);
        off();
        e.emit("x");
        expect(h).not.toHaveBeenCalled();
    });

    it("off() retire un handler, sans erreur si inconnu", () => {
        const e = new Emitter();
        const h = vi.fn();
        e.on("x", h);
        e.off("x", h);
        e.off("x", () => {});
        e.off("jamais-vu", h);
        expect(e.emit("x")).toBe(0);
    });

    it("le même handler n'est enregistré qu'une fois (Set)", () => {
        const e = new Emitter();
        const h = vi.fn();
        e.on("x", h);
        e.on("x", h);
        e.emit("x");
        expect(h).toHaveBeenCalledTimes(1);
    });

    it('"*" reçoit tous les événements', () => {
        const e = new Emitter();
        const all = vi.fn();
        e.on("*", all);
        e.emit("a", { n: 1 });
        e.emit("b");
        expect(all).toHaveBeenCalledTimes(2);
        expect(all.mock.calls.map((c) => c[0].type)).toEqual(["a", "b"]);
    });

    it("compte handlers spécifiques + joker", () => {
        const e = new Emitter();
        e.on("a", () => {});
        e.on("*", () => {});
        expect(e.emit("a")).toBe(2);
        expect(e.emit("b")).toBe(1);
    });

    it("un handler qui échoue n'empêche pas les autres", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const e = new Emitter();
        const after = vi.fn();
        e.on("x", () => { throw new Error("boom"); });
        e.on("x", after);
        expect(() => e.emit("x")).not.toThrow();
        expect(after).toHaveBeenCalled();
        expect(err).toHaveBeenCalled();
    });

    it("un handler peut se désinscrire pendant l'émission", () => {
        const e = new Emitter();
        const second = vi.fn();
        const off = e.on("x", () => off());
        e.on("x", second);
        e.emit("x");
        expect(second).toHaveBeenCalledTimes(1);
    });

    it("clear() supprime tout", () => {
        const e = new Emitter();
        const h = vi.fn();
        e.on("a", h);
        e.on("*", h);
        e.clear();
        expect(e.emit("a")).toBe(0);
        expect(h).not.toHaveBeenCalled();
    });
});

// ───────────────────────── ownership ─────────────────────────
describe("ownership", () => {
    const el = () => document.createElement("a");

    it("claim : le premier propriétaire gagne, les autres sont refusés", () => {
        const a = el(), o1 = { name: "binder" }, o2 = { name: "region" };
        expect(isClaimed(a)).toBe(false);
        expect(claim(a, o1)).toBe(true);
        expect(isClaimed(a)).toBe(true);
        expect(claim(a, o1)).toBe(true);   // idempotent pour le même propriétaire
        expect(claim(a, o2)).toBe(false);
    });

    it("data-lp reflète le propriétaire (name, puis id, puis 'lp')", () => {
        const a = el(), b = el(), c = el();
        claim(a, { name: "binder" });
        claim(b, { id: "lp-global" });
        claim(c, {});
        expect(a.dataset.lp).toBe("binder");
        expect(b.dataset.lp).toBe("lp-global");
        expect(c.dataset.lp).toBe("lp");
    });

    it("release : seul le propriétaire peut libérer", () => {
        const a = el(), o1 = {}, o2 = {};
        claim(a, o1);
        release(a, o2);
        expect(isClaimed(a)).toBe(true);
        expect(a.dataset.lp).toBeDefined();
        release(a, o1);
        expect(isClaimed(a)).toBe(false);
        expect(a.dataset.lp).toBeUndefined();
        expect(claim(a, o2)).toBe(true);   // libre pour un autre
    });

    it("release d'un élément jamais revendiqué ne fait rien", () => {
        expect(() => release(el(), {})).not.toThrow();
    });

    it("un cloneNode copie data-lp mais pas la propriété : c'est un nouvel élément", () => {
        const a = el();
        claim(a, { name: "binder" });
        const clone = a.cloneNode(true);
        expect(clone.dataset.lp).toBe("binder");
        expect(isClaimed(clone)).toBe(false);
        expect(claim(clone, { name: "autre" })).toBe(true);
    });

    it("fonctionne sur des objets sans dataset", () => {
        const plain = {};
        expect(claim(plain, { name: "x" })).toBe(true);
        expect(isClaimed(plain)).toBe(true);
        release(plain, null);
    });
});

// ───────────────────────── items.js ─────────────────────────
describe("itemCountOf", () => {
    it("0 pour rien ou une vidéo seule", () => {
        expect(itemCountOf(null)).toBe(0);
        expect(itemCountOf(undefined)).toBe(0);
        expect(itemCountOf({ isPlaylist: false })).toBe(0);
    });
    it("longueur de videoIds pour une liste", () => {
        expect(itemCountOf({ isPlaylist: true, videoIds: ["a", "b", "c"], videos: [] })).toBe(3);
    });
    it("longueur de videos pour une playlist sans videoIds", () => {
        expect(itemCountOf({ isPlaylist: true, videos: [1, 2] })).toBe(2);
    });
    it("null quand on ne sait pas (playlist sans items connus)", () => {
        expect(itemCountOf({ isPlaylist: true, videos: [] })).toBeNull();
    });
});

describe("toIndex", () => {
    it.each([[0, 0], [3, 3], [-1, 0], [1.5, 0], ["2", 0], [null, 0], [undefined, 0], [NaN, 0], [Infinity, 0]])(
        "toIndex(%j) = %j", (input, expected) => expect(toIndex(input)).toBe(expected));
});

// ───────────────────────── ValueChecks ─────────────────────────
describe("ValueChecks.requireNotNull", () => {
    it("refuse null et undefined, avec le nom dans le message", () => {
        expect(() => ValueChecks.requireNotNull(null, "provider")).toThrow(/provider/);
        expect(() => ValueChecks.requireNotNull(undefined)).toThrow(/value/);
    });
    it("accepte les valeurs « falsy » qui ne sont pas null", () => {
        for (const v of [0, "", false, NaN]) expect(() => ValueChecks.requireNotNull(v)).not.toThrow();
    });
});

describe("ValueChecks.requireNotNullOrEmpty", () => {
    it("refuse null / undefined", () => {
        expect(() => ValueChecks.requireNotNullOrEmpty(null, "x")).toThrow(/x/);
        expect(() => ValueChecks.requireNotNullOrEmpty(undefined, "x")).toThrow(/x/);
    });
    it("refuse chaîne vide ou blanche, tableau, Map, Set et objet vides", () => {
        for (const v of ["", "   ", [], new Map(), new Set(), {}]) {
            expect(() => ValueChecks.requireNotNullOrEmpty(v, "champ")).toThrow(/champ.*empty/);
        }
    });
    it("accepte les valeurs renseignées", () => {
        const ok = ["a", [1], new Map([[1, 2]]), new Set([1]), { a: 1 }, 0, false];
        for (const v of ok) expect(() => ValueChecks.requireNotNullOrEmpty(v)).not.toThrow();
    });
});

// ───────────────────────── dom.js ─────────────────────────
describe("resolveScope", () => {
    it("null / undefined → null (portée globale)", () => {
        expect(resolveScope(null)).toBeNull();
        expect(resolveScope(undefined)).toBeNull();
    });
    it("trouve par id, puis par sélecteur CSS", () => {
        document.body.innerHTML = `<div id="zone"></div><section class="sel"></section>`;
        expect(resolveScope("zone")).toBe(document.getElementById("zone"));
        expect(resolveScope(".sel")).toBe(document.querySelector(".sel"));
    });
    it("l'id prime sur le sélecteur", () => {
        document.body.innerHTML = `<div id="zone"></div>`;
        expect(resolveScope("zone").id).toBe("zone");
    });
    it("accepte directement un Element", () => {
        const el = document.createElement("div");
        expect(resolveScope(el)).toBe(el);
    });
    it("lève une erreur si introuvable ou invalide", () => {
        expect(() => resolveScope("nope")).toThrow(/Scope not found/);
        expect(() => resolveScope("###")).toThrow(/Scope not found/);
        expect(() => resolveScope(42)).toThrow(/Scope not found/);
        expect(() => resolveScope({})).toThrow(/Scope not found/);
    });
});

describe("injectStyles", () => {
    it("ajoute une balise <style> avec l'id et le CSS", () => {
        injectStyles("my-styles", ".a{color:red}");
        const s = document.getElementById("my-styles");
        expect(s.tagName).toBe("STYLE");
        expect(s.textContent).toBe(".a{color:red}");
        expect(s.parentNode).toBe(document.head);
    });
    it("n'injecte qu'une fois par id", () => {
        injectStyles("once", ".a{}");
        injectStyles("once", ".b{}");
        expect(document.querySelectorAll("#once")).toHaveLength(1);
        expect(document.getElementById("once").textContent).toBe(".a{}");
    });
});

describe("makeIframe", () => {
    const SRC = "https://example.com/embed/x";

    it("exige src", () => {
        expect(() => makeIframe({})).toThrow(TypeError);
        expect(() => makeIframe({ src: "" })).toThrow(/src is required/);
    });
    it("crée une iframe avec les attributs donnés", () => {
        const f = makeIframe({
            src: SRC, width: "560", height: "315", title: "Lecteur", allow: "autoplay", referrerPolicy: "no-referrer"
        });
        expect(f.tagName).toBe("IFRAME");
        expect(f.src).toBe(SRC);
        expect(f.width).toBe("560");
        expect(f.height).toBe("315");
        expect(f.title).toBe("Lecteur");
        expect(f.allow).toBe("autoplay");
        expect(f.referrerPolicy).toBe("no-referrer");
        expect(f.frameBorder).toBe("0");
    });
    it("plein écran activé par défaut, désactivable", () => {
        expect(makeIframe({ src: SRC }).allowFullscreen).toBe(true);
        expect(makeIframe({ src: SRC, allowFullscreen: false }).allowFullscreen).toBeFalsy();
    });
    it("n'ajoute pas width/height/title absents", () => {
        const f = makeIframe({ src: SRC });
        expect(f.hasAttribute("width")).toBe(false);
        expect(f.hasAttribute("height")).toBe(false);
        expect(f.hasAttribute("title")).toBe(false);
    });
    it("extraAttrs : attributs supplémentaires", () => {
        const f = makeIframe({ src: SRC, extraAttrs: { "data-x": "1", loading: "lazy" } });
        expect(f.getAttribute("data-x")).toBe("1");
        expect(f.getAttribute("loading")).toBe("lazy");
    });
});
