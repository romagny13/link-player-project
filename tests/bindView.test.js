// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {bindView} from "../src/bindView.js";

/** Faux region : on capture le hook enregistré pour le déclencher à la main. */
function fakeRegion() {
    const region = {
        hook: null,
        unsubscribe: vi.fn(),
        afterNavigate: vi.fn((hook) => {
            region.hook = hook;
            return region.unsubscribe;
        })
    };
    return region;
}

const to = {reason: "navigate", index: 0};
const from = null;

afterEach(() => {
    document.body.innerHTML = "";
});

describe("bindView", () => {
    it("accepte un sélecteur et passe (élément, to, from) à update", () => {
        document.body.innerHTML = '<h2 id="title"></h2>';
        const region = fakeRegion();
        const update = vi.fn();

        bindView(region, "#title", update);
        region.hook(to, from);

        expect(update).toHaveBeenCalledWith(document.querySelector("#title"), to, from);
    });

    it("résout le sélecteur à chaque appel : un élément créé plus tard est trouvé", () => {
        const region = fakeRegion();
        const update = vi.fn();
        bindView(region, "#title", update);

        region.hook(to, from);
        expect(update).not.toHaveBeenCalled();

        document.body.innerHTML = '<h2 id="title"></h2>';
        region.hook(to, from);
        expect(update).toHaveBeenCalledTimes(1);
    });

    it("un élément remplacé n'est pas périmé : le nouveau est utilisé", () => {
        document.body.innerHTML = '<h2 id="title">ancien</h2>';
        const region = fakeRegion();
        const seen = [];
        bindView(region, "#title", (el) => seen.push(el.textContent));

        region.hook(to, from);
        document.body.innerHTML = '<h2 id="title">nouveau</h2>';
        region.hook(to, from);

        expect(seen).toEqual(["ancien", "nouveau"]);
    });

    it("accepte un élément directement", () => {
        document.body.innerHTML = '<h2 id="title"></h2>';
        const element = document.querySelector("#title");
        const region = fakeRegion();
        const update = vi.fn();

        bindView(region, element, update);
        region.hook(to, from);

        expect(update).toHaveBeenCalledWith(element, to, from);
    });

    it("ignore un élément détaché du DOM", () => {
        const element = document.createElement("h2");
        const region = fakeRegion();
        const update = vi.fn();

        bindView(region, element, update);
        region.hook(to, from);

        expect(update).not.toHaveBeenCalled();
    });

    it("accepte une fonction pour chercher dans une portée", () => {
        document.body.innerHTML = '<section id="a"><h2></h2></section><section id="b"><h2></h2></section>';
        const region = fakeRegion();
        const update = vi.fn();

        bindView(region, () => document.querySelector("#b h2"), update);
        region.hook(to, from);

        expect(update).toHaveBeenCalledWith(document.querySelector("#b h2"), to, from);
    });

    it("transmet les options à afterNavigate et renvoie le désabonnement", () => {
        const region = fakeRegion();

        const off = bindView(region, "#title", vi.fn(), {immediate: true});

        expect(region.afterNavigate).toHaveBeenCalledWith(expect.any(Function), {immediate: true});
        expect(off).toBe(region.unsubscribe);
    });
});
