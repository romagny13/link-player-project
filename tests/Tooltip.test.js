// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../utils/dom.js", () => ({injectStyles: vi.fn()}));

import {injectStyles} from "../src/utils/dom.js";
import {Tooltip} from "../src/ui/Tooltip.js";

// ───────── faux navigateur ─────────

let probes; // images de sondage créées par le composant (new Image())
let rafQueue;

class FakeImage {
    naturalWidth = 0;
    onload = null;
    onerror = null;
    #src = "";

    constructor() {
        probes.push(this);
    }

    get src() {
        return this.#src;
    }

    set src(value) {
        this.#src = value;
    }
}

const flushRaf = () => rafQueue.splice(0).forEach((cb) => cb());

// ───────── helpers ─────────

const lien = () => document.getElementById("lien");
const autre = () => document.getElementById("autre");
const tip = () => document.querySelector(".lp-tip");
const tipLoader = () => tip().querySelector(".lp-tip-loader");
const tipImg = () => tip().querySelector("img");
const tipTitre = () => tip().querySelector(".lp-tip-title");

const souris = (type, x = 100, y = 100) =>
    new MouseEvent(type, {clientX: x, clientY: y});
const entrer = (el, x, y) => el.dispatchEvent(souris("mouseenter", x, y));
const bouger = (el, x, y) => el.dispatchEvent(souris("mousemove", x, y));
const quitter = (el) => el.dispatchEvent(souris("mouseleave"));
const pointerDown = () =>
    document.body.dispatchEvent(new Event("pointerdown", {bubbles: true}));

const avancer = (ms) => vi.advanceTimersByTimeAsync(ms);

describe("Tooltip", () => {
    let tooltip;

    /** Attache le lien, survole et attend l'ouverture de l'infobulle. */
    async function afficher({
                                getThumb = vi.fn().mockResolvedValue(null),
                                title = "Titre",
                                provider,
                                cible = lien(),
                                x,
                                y
                            } = {}) {
        const detach = tooltip.attach(cible, getThumb, title, provider);
        entrer(cible, x, y);
        await avancer(120);
        await avancer(0);
        return {detach, getThumb};
    }

    /** Résout la sonde d'image la plus récente. */
    const chargerSonde = (naturalWidth = 640) => {
        const probe = probes.at(-1);
        probe.naturalWidth = naturalWidth;
        probe.onload();
        return probe;
    };

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = `<a id="lien">lien</a><a id="autre">autre</a>`;
        probes = [];
        rafQueue = [];
        vi.stubGlobal("Image", FakeImage);
        vi.stubGlobal("requestAnimationFrame", (cb) => rafQueue.push(cb));
        vi.stubGlobal("innerWidth", 1000);
        vi.stubGlobal("innerHeight", 600);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(280);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(158);
        // injectStyles.mockClear();
        tooltip = new Tooltip();
    });

    afterEach(() => {
        tooltip.dispose();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    describe("attach()", () => {
        it("renvoie une fonction de détachement", () => {
            const detach = tooltip.attach(lien(), vi.fn(), "t");
            expect(detach).toBeTypeOf("function");
        });

        it("n'affiche rien avant le délai de 120 ms", async () => {
            tooltip.attach(lien(), vi.fn().mockResolvedValue(null), "t");
            entrer(lien());
            await avancer(119);
            expect(tip()).toBeNull();
        });

        it("affiche l'infobulle après 120 ms de survol", async () => {
            await afficher();
            expect(tip()).not.toBeNull();
            expect(tip().style.display).toBe("block");
        });

        it("annule l'ouverture quand la souris quitte le lien avant le délai", async () => {
            const getThumb = vi.fn().mockResolvedValue(null);
            tooltip.attach(lien(), getThumb, "t");
            entrer(lien());
            await avancer(50);
            quitter(lien());
            await avancer(300);
            expect(tip()).toBeNull();
            expect(getThumb).not.toHaveBeenCalled();
        });

        it("ne déclenche qu'une ouverture quand on entre plusieurs fois rapidement", async () => {
            const getThumb = vi.fn().mockResolvedValue(null);
            tooltip.attach(lien(), getThumb, "t");
            entrer(lien());
            await avancer(60);
            entrer(lien());
            await avancer(200);
            expect(getThumb).toHaveBeenCalledTimes(1);
        });

        it("partage un seul élément entre plusieurs liens", async () => {
            await afficher({cible: lien()});
            quitter(lien());
            await afficher({cible: autre()});
            expect(document.querySelectorAll(".lp-tip")).toHaveLength(1);
        });

        // it("injecte les styles à l'ouverture", async () => {
        //     await afficher();
        //     expect(injectStyles).toHaveBeenCalledWith("lp-tooltip-styles", expect.stringContaining(".lp-tip"));
        // });
    });

    describe("détachement", () => {
        it("retire les écouteurs : le survol n'ouvre plus rien", async () => {
            const detach = tooltip.attach(lien(), vi.fn().mockResolvedValue(null), "t");
            detach();
            entrer(lien());
            await avancer(300);
            expect(tip()).toBeNull();
        });

        it("annule une ouverture en attente", async () => {
            const detach = tooltip.attach(lien(), vi.fn().mockResolvedValue(null), "t");
            entrer(lien());
            await avancer(50);
            detach();
            await avancer(300);
            expect(tip()).toBeNull();
        });

        it("ferme l'infobulle ouverte", async () => {
            const {detach} = await afficher();
            flushRaf();
            detach();
            expect(tip().classList.contains("lp-show")).toBe(false);
            await avancer(150);
            expect(tip().style.display).toBe("none");
        });
    });

    describe("contenu", () => {
        it("affiche le titre fourni sous forme de texte", async () => {
            await afficher({title: "Ma vidéo"});
            expect(tipTitre().textContent).toBe("Ma vidéo");
        });

        it("évalue le titre au moment de l'ouverture quand c'est une fonction", async () => {
            let titre = "avant";
            const getTitle = vi.fn(() => titre);
            tooltip.attach(lien(), vi.fn().mockResolvedValue(null), getTitle);
            titre = "après";
            entrer(lien());
            await avancer(120);
            expect(tipTitre().textContent).toBe("après");
        });

        it("renseigne le fournisseur dans les attributs data", async () => {
            await afficher({provider: {id: "youtube", name: "YouTube"}});
            expect(tip().dataset.provider).toBe("youtube");
            expect(tip().dataset.name).toBe("YouTube");
        });

        it("utilise des valeurs vides sans fournisseur", async () => {
            await afficher();
            expect(tip().dataset.provider).toBe("");
            expect(tip().dataset.name).toBe("");
        });

        it("affiche le chargeur et cache l'image pendant l'attente de la miniature", async () => {
            await afficher({getThumb: () => new Promise(() => {})});
            expect(tipLoader().hidden).toBe(false);
            expect(tipImg().hidden).toBe(true);
            expect(tipImg().hasAttribute("src")).toBe(false);
        });

        it("ajoute la classe lp-show à la frame suivante", async () => {
            await afficher();
            expect(tip().classList.contains("lp-show")).toBe(false);
            flushRaf();
            expect(tip().classList.contains("lp-show")).toBe(true);
        });

        it("n'ajoute pas lp-show si l'infobulle est fermée avant la frame", async () => {
            await afficher();
            quitter(lien());
            flushRaf();
            expect(tip().classList.contains("lp-show")).toBe(false);
        });
    });

    describe("miniature", () => {
        it("affiche l'image une fois la sonde chargée", async () => {
            await afficher({getThumb: vi.fn().mockResolvedValue("https://img/a.jpg")});
            expect(probes.at(-1).src).toBe("https://img/a.jpg");
            chargerSonde();

            expect(tipImg().src).toBe("https://img/a.jpg");
            expect(tipImg().hidden).toBe(false);
            expect(tipLoader().hidden).toBe(true);
            expect(tip().classList.contains("lp-nothumb")).toBe(false);
        });

        it("bascule sur l'apparence de secours quand il n'y a pas d'url", async () => {
            await afficher({getThumb: vi.fn().mockResolvedValue(null)});
            expect(tip().classList.contains("lp-nothumb")).toBe(true);
            expect(tipLoader().hidden).toBe(true);
            expect(probes).toHaveLength(0);
        });

        it("bascule sur l'apparence de secours quand la sonde échoue", async () => {
            await afficher({getThumb: vi.fn().mockResolvedValue("https://img/a.jpg")});
            probes.at(-1).onerror();
            expect(tip().classList.contains("lp-nothumb")).toBe(true);
            expect(tipImg().hidden).toBe(true);
        });

        it("bascule sur l'apparence de secours quand getThumb rejette", async () => {
            await afficher({getThumb: vi.fn().mockRejectedValue(new Error("api"))});
            expect(tip().classList.contains("lp-nothumb")).toBe(true);
        });

        it("bascule sur l'apparence de secours quand getThumb lève une erreur synchrone", async () => {
            await afficher({
                getThumb: () => {
                    throw new Error("sync");
                }
            });
            expect(tip().classList.contains("lp-nothumb")).toBe(true);
        });

        it("bascule sur l'apparence de secours après 3 s sans réponse", async () => {
            await afficher({getThumb: () => new Promise(() => {})});
            await avancer(2799); // 120 + 2799 = 2919 ms au total depuis l'entrée
            expect(tip().classList.contains("lp-nothumb")).toBe(false);
            await avancer(300);
            expect(tip().classList.contains("lp-nothumb")).toBe(true);
        });

        describe("images YouTube de vidéos supprimées", () => {
            it("considère une image de 120 px de large comme absente", async () => {
                await afficher({
                    getThumb: vi.fn().mockResolvedValue("https://img/a.jpg"),
                    provider: {id: "youtube", name: "YouTube"}
                });
                chargerSonde(120);
                expect(tip().classList.contains("lp-nothumb")).toBe(true);
                expect(tipImg().hidden).toBe(true);
            });

            it("accepte une image YouTube plus large", async () => {
                await afficher({
                    getThumb: vi.fn().mockResolvedValue("https://img/a.jpg"),
                    provider: {id: "youtube", name: "YouTube"}
                });
                chargerSonde(480);
                expect(tip().classList.contains("lp-nothumb")).toBe(false);
                expect(tipImg().hidden).toBe(false);
            });

            it("n'applique pas cette règle aux autres fournisseurs", async () => {
                await afficher({
                    getThumb: vi.fn().mockResolvedValue("https://img/a.jpg"),
                    provider: {id: "dailymotion", name: "Dailymotion"}
                });
                chargerSonde(120);
                expect(tip().classList.contains("lp-nothumb")).toBe(false);
                expect(tipImg().hidden).toBe(false);
            });
        });

        describe("réponses obsolètes", () => {
            it("ignore une miniature qui arrive après la fermeture", async () => {
                let resoudre;
                await afficher({getThumb: () => new Promise((r) => (resoudre = r))});
                quitter(lien());
                resoudre("https://img/a.jpg");
                await avancer(0);
                expect(probes).toHaveLength(0);
                expect(tip().classList.contains("lp-nothumb")).toBe(false);
            });

            it("ignore une sonde qui charge après la fermeture", async () => {
                await afficher({getThumb: vi.fn().mockResolvedValue("https://img/a.jpg")});
                quitter(lien());
                chargerSonde();
                expect(tipImg().hidden).toBe(true);
            });

            it("ignore une erreur de sonde après la fermeture", async () => {
                await afficher({getThumb: vi.fn().mockResolvedValue("https://img/a.jpg")});
                quitter(lien());
                probes.at(-1).onerror();
                expect(tip().classList.contains("lp-nothumb")).toBe(false);
            });

            it("ignore la miniature du premier lien quand un second a pris le relais", async () => {
                let resoudrePremier;
                tooltip.attach(lien(), () => new Promise((r) => (resoudrePremier = r)), "un");
                tooltip.attach(autre(), vi.fn().mockResolvedValue("https://img/b.jpg"), "deux");

                entrer(lien());
                await avancer(120);
                entrer(autre());
                await avancer(120);
                await avancer(0);

                resoudrePremier("https://img/a.jpg");
                await avancer(0);

                expect(probes.map((p) => p.src)).toEqual(["https://img/b.jpg"]);
                expect(tipTitre().textContent).toBe("deux");
            });
        });

        it("réinitialise l'infobulle à la réouverture", async () => {
            const getThumb = vi.fn()
                .mockResolvedValueOnce(null)
                .mockReturnValueOnce(new Promise(() => {}));
            tooltip.attach(lien(), getThumb, "t");

            entrer(lien());
            await avancer(120);
            await avancer(0);
            expect(tip().classList.contains("lp-nothumb")).toBe(true);

            quitter(lien());
            await avancer(200);
            entrer(lien());
            await avancer(120);

            expect(tip().classList.contains("lp-nothumb")).toBe(false);
            expect(tipLoader().hidden).toBe(false);
            expect(tipImg().hasAttribute("src")).toBe(false);
        });
    });

    describe("positionnement", () => {
        it("place l'infobulle à droite et sous le curseur par défaut", async () => {
            await afficher({x: 100, y: 100});
            expect(tip().style.left).toBe("114px");
            expect(tip().style.top).toBe("114px");
        });

        it("se place à gauche du curseur près du bord droit", async () => {
            await afficher({x: 900, y: 100});
            expect(tip().style.left).toBe("606px"); // 900 - 280 - 14
        });

        it("se place au-dessus du curseur près du bord bas", async () => {
            await afficher({x: 100, y: 500});
            expect(tip().style.top).toBe("328px"); // 500 - 158 - 14
        });

        it("suit la souris pendant le déplacement", async () => {
            await afficher({x: 100, y: 100});
            bouger(lien(), 200, 250);
            expect(tip().style.left).toBe("214px");
            expect(tip().style.top).toBe("264px");
        });

        it("ignore les mouvements quand l'infobulle n'existe pas encore", () => {
            tooltip.attach(lien(), vi.fn(), "t");
            expect(() => bouger(lien(), 10, 10)).not.toThrow();
            expect(tip()).toBeNull();
        });

        it("utilise la dernière position connue à l'ouverture", async () => {
            tooltip.attach(lien(), vi.fn().mockResolvedValue(null), "t");
            entrer(lien(), 100, 100);
            bouger(lien(), 300, 300);
            await avancer(120);
            expect(tip().style.left).toBe("314px");
            expect(tip().style.top).toBe("314px");
        });
    });

    describe("fermeture", () => {
        it("retire lp-show immédiatement puis masque après 150 ms", async () => {
            await afficher();
            flushRaf();
            quitter(lien());

            expect(tip().classList.contains("lp-show")).toBe(false);
            expect(tip().style.display).toBe("block");
            await avancer(149);
            expect(tip().style.display).toBe("block");
            await avancer(1);
            expect(tip().style.display).toBe("none");
        });

        it("ne masque pas l'infobulle si elle est rouverte pendant le délai", async () => {
            const getThumb = vi.fn().mockResolvedValue(null);
            tooltip.attach(lien(), getThumb, "t");
            entrer(lien());
            await avancer(120);
            quitter(lien());
            await avancer(10);
            entrer(lien());
            await avancer(120); // rouverte avant la fin des 150 ms
            await avancer(200);
            expect(tip().style.display).toBe("block");
        });

        it("se ferme sur un clic ou un toucher n'importe où dans la page", async () => {
            await afficher();
            flushRaf();
            pointerDown();
            expect(tip().classList.contains("lp-show")).toBe(false);
            await avancer(150);
            expect(tip().style.display).toBe("none");
        });

        it("annule une ouverture en attente sur un clic", async () => {
            tooltip.attach(lien(), vi.fn().mockResolvedValue(null), "t");
            entrer(lien());
            await avancer(50);
            pointerDown();
            await avancer(300);
            expect(tip()).toBeNull();
        });

        it("ne plante pas quand aucune infobulle n'a été créée", () => {
            expect(() => pointerDown()).not.toThrow();
        });
    });

    describe("dispose()", () => {
        it("retire l'élément du DOM", async () => {
            await afficher();
            tooltip.dispose();
            expect(tip()).toBeNull();
        });

        it("peut être appelé sans infobulle ni deux fois de suite", () => {
            expect(() => {
                tooltip.dispose();
                tooltip.dispose();
            }).not.toThrow();
        });

        it("retire l'écouteur pointerdown du document", () => {
            const spy = vi.spyOn(document, "removeEventListener");
            tooltip.dispose();
            expect(spy).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
        });

        it("annule une ouverture en attente", async () => {
            tooltip.attach(lien(), vi.fn().mockResolvedValue(null), "t");
            entrer(lien());
            await avancer(50);
            tooltip.dispose();
            await avancer(300);
            expect(tip()).toBeNull();
        });

        it("ignore une miniature qui arrive après la destruction", async () => {
            let resoudre;
            await afficher({getThumb: () => new Promise((r) => (resoudre = r))});
            tooltip.dispose();
            resoudre("https://img/a.jpg");
            await avancer(0);
            expect(probes).toHaveLength(0);
        });

        it("annule le masquage différé sans erreur", async () => {
            await afficher();
            quitter(lien());
            tooltip.dispose();
            await expect(avancer(300)).resolves.not.toThrow();
        });

        it("permet de recréer l'infobulle après une destruction", async () => {
            await afficher();
            tooltip.dispose();
            quitter(lien());
            await afficher();
            expect(document.querySelectorAll(".lp-tip")).toHaveLength(1);
        });
    });
});