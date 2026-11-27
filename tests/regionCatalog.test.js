// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RegionCatalog } from "../src/RegionCatalog.js";

/** Faux Region : seulement ce que le catalogue utilise (attach / detach / dispose / element). */
const makeRegion = (name) => ({
    name,
    element: null,
    attach: vi.fn(function (el) { this.element = el; }),
    detach: vi.fn(function () { this.element = null; }),
    dispose: vi.fn()
});

let create, catalog;
beforeEach(() => {
    create = vi.fn(makeRegion);
    catalog = new RegionCatalog({ create });
});
afterEach(() => { document.body.innerHTML = ""; });

const el = (id) => {
    const e = document.createElement("div");
    if (id) e.id = id;
    document.body.append(e);
    return e;
};

describe("RegionCatalog : get / has / regions", () => {
    it("commence vide", () => {
        expect(catalog.regions).toEqual([]);
        expect(catalog.has("a")).toBe(false);
    });

    it("get() crée la région à la première demande, avec son nom", () => {
        const r = catalog.get("a");
        expect(create).toHaveBeenCalledWith("a");
        expect(r.name).toBe("a");
        expect(catalog.has("a")).toBe(true);
    });

    it("get() renvoie toujours la même région (create appelé une fois)", () => {
        expect(catalog.get("a")).toBe(catalog.get("a"));
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("has() ne crée rien", () => {
        catalog.has("a");
        expect(create).not.toHaveBeenCalled();
    });

    it("regions : liste gelée, dans l'ordre de création, instantané", () => {
        catalog.get("a");
        catalog.get("b");
        const snapshot = catalog.regions;
        expect(snapshot.map((r) => r.name)).toEqual(["a", "b"]);
        expect(Object.isFrozen(snapshot)).toBe(true);
        catalog.get("c");
        expect(snapshot).toHaveLength(2);
        expect(catalog.regions).toHaveLength(3);
    });
});

describe("RegionCatalog : nameOf / bind", () => {
    it("nameOf : null pour un élément inconnu", () => {
        expect(catalog.nameOf(el())).toBeNull();
    });

    it("bind crée la région si besoin, lui attache l'élément et la renvoie", () => {
        const e = el("zone");
        const r = catalog.bind("a", e);
        expect(r).toBe(catalog.get("a"));
        expect(r.attach).toHaveBeenCalledWith(e);
        expect(r.element).toBe(e);
        expect(catalog.nameOf(e)).toBe("a");
    });

    it("bind est idempotent : même élément, même région → un seul attach", () => {
        const e = el();
        catalog.bind("a", e);
        const r = catalog.bind("a", e);
        expect(r.attach).toHaveBeenCalledTimes(1);
    });

    it("un élément ne peut pas être deux régions", () => {
        const e = el("zone");
        catalog.bind("a", e);
        expect(() => catalog.bind("b", e)).toThrow(/already the region 'a'.*'b'/);
        expect(catalog.has("b")).toBe(false);   // la 2e région n'est pas créée
        expect(catalog.get("a").element).toBe(e);
    });

    it("le message d'erreur décrit l'élément (balise et id)", () => {
        const e = el("zone");
        catalog.bind("a", e);
        expect(() => catalog.bind("b", e)).toThrow(/<div#zone>/);
    });

    it("une région peut changer d'élément : attach avec le nouveau", () => {
        const e1 = el(), e2 = el();
        const r = catalog.bind("a", e1);
        catalog.bind("a", e2);
        expect(r.attach).toHaveBeenCalledTimes(2);
        expect(r.element).toBe(e2);
        expect(catalog.nameOf(e2)).toBe("a");
    });

    it("un élément détaché puis lié à nouveau : la région le reprend", () => {
        const e1 = el();
        catalog.bind("a", e1);
        e1.remove();
        catalog.refresh();
        const e2 = el();
        const r = catalog.bind("a", e2);
        expect(r.element).toBe(e2);
    });

    it("lier une région déjà créée par get() (état avant élément)", () => {
        const early = catalog.get("a");
        const r = catalog.bind("a", el());
        expect(r).toBe(early);
        expect(create).toHaveBeenCalledTimes(1);
    });
});

describe("RegionCatalog : refresh", () => {
    it("détache les régions dont l'élément a quitté la page", () => {
        const e = el();
        const r = catalog.bind("a", e);
        e.remove();
        catalog.refresh();
        expect(r.detach).toHaveBeenCalledTimes(1);
        expect(r.element).toBeNull();
        expect(catalog.nameOf(e)).toBeNull();
    });

    it("la région garde son existence (son état) après le détachement", () => {
        const e = el();
        const r = catalog.bind("a", e);
        e.remove();
        catalog.refresh();
        expect(catalog.has("a")).toBe(true);
        expect(catalog.get("a")).toBe(r);
        expect(r.dispose).not.toHaveBeenCalled();
    });

    it("ne touche ni aux éléments encore dans la page ni aux régions sans élément", () => {
        const kept = el();
        const withEl = catalog.bind("a", kept);
        const without = catalog.get("b");
        catalog.refresh();
        expect(withEl.detach).not.toHaveBeenCalled();
        expect(without.detach).not.toHaveBeenCalled();
        expect(catalog.nameOf(kept)).toBe("a");
    });

    it("après refresh, l'ancien élément peut être lié à un autre nom", () => {
        const e = el();
        catalog.bind("a", e);
        e.remove();
        catalog.refresh();
        document.body.append(e);
        expect(() => catalog.bind("b", e)).not.toThrow();
    });

    it("sans région : sans effet", () => {
        expect(() => catalog.refresh()).not.toThrow();
    });
});

describe("RegionCatalog : dispose", () => {
    it("dispose chaque région puis vide le catalogue", () => {
        const a = catalog.get("a"), b = catalog.get("b");
        catalog.dispose();
        expect(a.dispose).toHaveBeenCalledTimes(1);
        expect(b.dispose).toHaveBeenCalledTimes(1);
        expect(catalog.regions).toEqual([]);
        expect(catalog.has("a")).toBe(false);
    });

    it("après dispose, get() recrée une région neuve", () => {
        const old = catalog.get("a");
        catalog.dispose();
        expect(catalog.get("a")).not.toBe(old);
        expect(create).toHaveBeenCalledTimes(2);
    });

    it("dispose sur un catalogue vide : sans effet", () => {
        expect(() => catalog.dispose()).not.toThrow();
    });
});
