import {beforeEach, describe, expect, it} from "vitest";
import {NavigationJournal} from "../src/NavigationJournal.js";

const entree = (nom, index = 0, extra = {}) => ({info: {key: nom}, index, ...extra});

describe("NavigationJournal", () => {
    let journal;

    beforeEach(() => {
        journal = new NavigationJournal();
    });

    describe("état initial", () => {
        it("n'a pas d'entrée courante", () => {
            expect(journal.current).toBeNull();
        });

        it("ne peut ni reculer ni avancer", () => {
            expect(journal.canGoBack).toBe(false);
            expect(journal.canGoForward).toBe(false);
        });

        it("expose une liste d'entrées vide", () => {
            expect(journal.entries).toEqual([]);
        });

        it("renvoie null pour back() et forward()", () => {
            expect(journal.back()).toBeNull();
            expect(journal.forward()).toBeNull();
        });
    });

    describe("push()", () => {
        it("ajoute une entrée et la rend courante", () => {
            journal.push(entree("A"));
            expect(journal.current.info.key).toBe("A");
            expect(journal.entries).toHaveLength(1);
        });

        it("ne permet pas de reculer avec une seule entrée", () => {
            journal.push(entree("A"));
            expect(journal.canGoBack).toBe(false);
            expect(journal.canGoForward).toBe(false);
        });

        it("permet de reculer à partir de la deuxième entrée", () => {
            journal.push(entree("A"));
            journal.push(entree("B"));
            expect(journal.canGoBack).toBe(true);
            expect(journal.current.info.key).toBe("B");
        });

        it("copie l'entrée : modifier l'objet d'origine n'a pas d'effet", () => {
            const original = entree("A", 2);
            journal.push(original);
            original.index = 99;
            expect(journal.current.index).toBe(2);
        });
        it("supprime l'historique « avant » quand on pousse après un retour", () => {
            journal.push(entree("A"));
            journal.push(entree("B"));
            journal.push(entree("C"));
            journal.back();
            journal.back();
            journal.push(entree("D"));

            expect(journal.entries.map((e) => e.info.key)).toEqual(["A", "D"]);
            expect(journal.canGoForward).toBe(false);
            expect(journal.current.info.key).toBe("D");
        });
    });

    describe("back() / forward()", () => {
        beforeEach(() => {
            journal.push(entree("A", 1));
            journal.push(entree("B", 2));
            journal.push(entree("C", 3));
        });

        it("recule d'une entrée et la renvoie", () => {
            const e = journal.back();
            expect(e.info.key).toBe("B");
            expect(journal.current.info.key).toBe("B");
        });

        it("avance d'une entrée et la renvoie", () => {
            journal.back();
            journal.back();
            const e = journal.forward();
            expect(e.info.key).toBe("B");
            expect(e.index).toBe(2);
        });

        it("renvoie null au début de l'historique sans bouger", () => {
            journal.back();
            journal.back();
            expect(journal.back()).toBeNull();
            expect(journal.current.info.key).toBe("A");
        });

        it("renvoie null à la fin de l'historique sans bouger", () => {
            expect(journal.forward()).toBeNull();
            expect(journal.current.info.key).toBe("C");
        });

        it("n'ajoute jamais d'entrée en naviguant", () => {
            journal.back();
            journal.forward();
            journal.back();
            expect(journal.entries).toHaveLength(3);
        });

        it("met à jour canGoBack et canGoForward selon la position", () => {
            expect(journal.canGoBack).toBe(true);
            expect(journal.canGoForward).toBe(false);
            journal.back();
            expect(journal.canGoBack).toBe(true);
            expect(journal.canGoForward).toBe(true);
            journal.back();
            expect(journal.canGoBack).toBe(false);
            expect(journal.canGoForward).toBe(true);
        });
    });

    describe("replace()", () => {
        it("se comporte comme push() quand le journal est vide", () => {
            journal.replace(entree("A"));
            expect(journal.entries).toHaveLength(1);
            expect(journal.current.info.key).toBe("A");
        });

        it("remplace l'entrée courante sans en ajouter", () => {
            journal.push(entree("A"));
            journal.push(entree("B"));
            journal.replace(entree("C", 5));

            expect(journal.entries.map((e) => e.info.key)).toEqual(["A", "C"]);
            expect(journal.current.index).toBe(5);
        });

        it("conserve l'historique « avant »", () => {
            journal.push(entree("A"));
            journal.push(entree("B"));
            journal.back();
            journal.replace(entree("X"));

            expect(journal.canGoForward).toBe(true);
            expect(journal.entries.map((e) => e.info.key)).toEqual(["X", "B"]);
        });

        it("copie l'entrée remplaçante", () => {
            journal.push(entree("A"));
            const remplacante = entree("B", 1);
            journal.replace(remplacante);
            remplacante.index = 42;
            expect(journal.current.index).toBe(1);
        });
    });

    describe("updateCurrent()", () => {
 
        it("ne modifie que l'entrée courante", () => {
            journal.push(entree("A", 1));
            journal.push(entree("B", 2));
            journal.updateCurrent({index: 9});
            journal.back();
            expect(journal.current.index).toBe(1);
        });

        it("est sans effet (et ne plante pas) quand le journal est vide", () => {
            expect(() => journal.updateCurrent({index: 3})).not.toThrow();
            expect(journal.current).toBeNull();
        });

        it("est restauré après un retour puis un avancement", () => {
            journal.push(entree("A"));
            journal.push(entree("B"));
            journal.updateCurrent({index: 4});
            journal.back();
            expect(journal.forward().index).toBe(4);
        });
    });

    describe("entries", () => {
        it("est gelé", () => {
            journal.push(entree("A"));
            expect(Object.isFrozen(journal.entries)).toBe(true);
        });

        it("est une copie : modifier la liste n'altère pas le journal", () => {
            journal.push(entree("A"));
            const liste = journal.entries;
            expect(() => liste.push(entree("Z"))).toThrow();
            expect(journal.entries).toHaveLength(1);
        });
    });
});