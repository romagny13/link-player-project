// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Region} from "../src/Region.js";

// Le panneau est toujours injecté : on évite de charger le vrai PanelRenderer.
vi.mock("../src/ui/PanelRenderer.js", () => ({
    PanelRenderer: class {
        render() {}
        clear() {}
        setCurrent() {}
        destroy() {}
    }
}));

// ───────── Faux player / provider / panneau ─────────
class FakePlayer {
    constructor({iframe} = {}) {
        this.kind = "fake";
        this.iframe = iframe ?? document.createElement("iframe");
        this.listeners = new Set();
        this.load = vi.fn();
        this.play = vi.fn();
        this.pause = vi.fn();
        this.next = vi.fn();
        this.previous = vi.fn();
        this.playAt = vi.fn();
        this.selectItem = vi.fn();
        this.dispose = vi.fn();
    }

    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit(event) {
        for (const listener of [...this.listeners]) listener(event);
    }
}

const makeProvider = () => {
    const players = [];
    return {
        players,
        createPlayer: vi.fn((options = {}) => {
            const player = new FakePlayer(options);
            players.push(player);
            return player;
        })
    };
};

const makePanel = () => ({
    render: vi.fn(),
    clear: vi.fn(),
    setCurrent: vi.fn(),
    destroy: vi.fn()
});

const video = (id) => ({key: `v:${id}`, provider: "fake", target: "zone", isPlaylist: false, videoId: id, videos: []});
const list = (id, count = 3) => ({
    key: `l:${id}`,
    provider: "fake",
    target: "zone",
    isPlaylist: true,
    videoIds: Array.from({length: count}, (_, i) => `${id}${i}`),
    videos: []
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let provider;
let registry;
let panel;
let host;

function setup({container = true, ...options} = {}) {
    document.body.innerHTML = container ? '<div id="zone"></div>' : "";
    host = document.getElementById("zone");
    provider = makeProvider();
    registry = {get: vi.fn(() => provider)};
    panel = makePanel();
    return new Region({target: "zone", registry, panelRenderer: panel, ...options});
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

describe("Region", () => {
    describe("état initial", () => {
        it("expose la cible, aucune info et aucun élément courant", () => {
            const region = setup();
            expect(region.target).toBe("zone");
            expect(region.infos).toEqual([]);
            expect(region.current).toBeNull();
            expect(region.currentIndex).toBe(0);
            expect(region.canGoBack).toBe(false);
            expect(region.canGoForward).toBe(false);
        });

        it("trouve le conteneur déjà présent dans le DOM", () => {
            const region = setup();
            expect(region.hasContainer).toBe(true);
            expect(region.isVisible).toBe(true);
        });

        it("sans conteneur : hasContainer et isVisible sont faux", () => {
            const region = setup({container: false});
            expect(region.hasContainer).toBe(false);
            expect(region.isVisible).toBe(false);
        });

        it("isVisible est faux quand le conteneur est caché", () => {
            const region = setup();
            host.hidden = true;
            expect(region.isVisible).toBe(false);
        });
    });

    describe("infos", () => {
        it("add() renvoie true puis false pour une même clé", () => {
            const region = setup();
            const info = video("a");
            expect(region.add(info)).toBe(true);
            expect(region.add(video("a"))).toBe(false);
            expect(region.get("v:a")).toBe(info);
            expect(region.has("v:a")).toBe(true);
            expect(region.has("v:zzz")).toBe(false);
        });

        it("infos est un tableau figé", () => {
            const region = setup();
            region.add(video("a"));
            expect(Object.isFrozen(region.infos)).toBe(true);
        });
    });

    describe("navigate()", () => {
        it("lève une erreur pour une clé inconnue", () => {
            const region = setup();
            expect(() => region.navigate("inconnue")).toThrow(/No info found for key 'inconnue'/);
        });

        it("crée un player, charge l'info et place l'iframe dans le conteneur", () => {
            const region = setup();
            const info = video("a");
            region.add(info);

            region.navigate(info.key, {autoplay: true, index: 0});

            const player = provider.players[0];
            expect(provider.createPlayer).toHaveBeenCalledWith();
            expect(player.load).toHaveBeenCalledWith(info, {autoplay: true, index: 0});
            expect(host.firstChild).toBe(player.iframe);
            expect(player.iframe.dataset.lp).toBe("zone");
            expect(region.current).toBe(info);
            expect(region.isCurrent(info.key)).toBe(true);
        });

        it("réaffiche un conteneur caché", () => {
            const region = setup();
            region.add(video("a"));
            host.hidden = true;
            region.navigate("v:a");
            expect(host.hidden).toBe(false);
        });

        it("émet un événement change avec la raison 'navigate'", () => {
            const region = setup();
            const onChange = vi.fn();
            region.on("change", onChange);
            const info = video("a");
            region.add(info);

            region.navigate(info.key);

            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
                region, reason: "navigate", info, index: 0, visible: true
            }));
        });

        it("vidéo seule : le panneau est vidé", () => {
            const region = setup();
            region.add(video("a"));
            region.navigate("v:a");
            expect(panel.clear).toHaveBeenCalled();
            expect(panel.render).not.toHaveBeenCalled();
        });

        it("playlist : le panneau est dessiné, et un clic sur un item lance playAt", () => {
            const region = setup();
            const info = list("l");
            region.add(info);
            region.navigate(info.key, {index: 1});

            expect(panel.render).toHaveBeenCalledWith(expect.objectContaining({
                host, info, iframe: provider.players[0].iframe, current: 1
            }));

            panel.render.mock.lastCall[0].onSelectItem(2);
            expect(provider.players[0].playAt).toHaveBeenCalledWith(2);
            expect(region.currentIndex).toBe(2);
        });

        it("autre info : l'ancien player est libéré et son iframe retirée", () => {
            const region = setup();
            region.add(video("a"));
            region.add(video("b"));
            region.navigate("v:a");
            const first = provider.players[0];

            region.navigate("v:b");

            expect(first.dispose).toHaveBeenCalled();
            expect(first.iframe.isConnected).toBe(false);
            expect(provider.players).toHaveLength(2);
            expect(host.children).toHaveLength(1);
            expect(host.firstChild).toBe(provider.players[1].iframe);
        });

        it("continue même si l'ancien player lève une erreur dans dispose()", () => {
            const region = setup();
            vi.spyOn(console, "warn").mockImplementation(() => {});
            region.add(video("a"));
            region.add(video("b"));
            region.navigate("v:a");
            provider.players[0].dispose.mockImplementation(() => {
                throw new Error("boom");
            });

            expect(() => region.navigate("v:b")).not.toThrow();
            expect(region.current.key).toBe("v:b");
        });
    });

    describe("comportement sur l'info déjà courante (currentBehavior)", () => {
        it("toggle (défaut) : cache puis réaffiche, en mettant le player en pause", () => {
            const region = setup();
            region.add(video("a"));
            region.navigate("v:a");

            region.navigate("v:a");
            expect(host.hidden).toBe(true);
            expect(provider.players[0].pause).toHaveBeenCalled();

            region.navigate("v:a");
            expect(host.hidden).toBe(false);
            expect(provider.players).toHaveLength(1);
        });

        it("skip : ne fait rien", () => {
            const region = setup({currentBehavior: "skip"});
            region.add(video("a"));
            region.navigate("v:a");

            region.navigate("v:a");

            expect(host.hidden).toBe(false);
            expect(provider.players[0].load).toHaveBeenCalledTimes(1);
            expect(region.canGoBack).toBe(false);
        });

        it("autre valeur : renavigue sans recréer l'iframe, et relance la lecture si autoplay", () => {
            const region = setup({currentBehavior: "navigate"});
            region.add(video("a"));
            region.navigate("v:a");

            region.navigate("v:a", {autoplay: true});

            expect(provider.players).toHaveLength(1);
            expect(provider.players[0].play).toHaveBeenCalled();
            expect(region.canGoBack).toBe(true);
        });

        it("même playlist, autre item : une seule commande selectItem, pas de nouvelle iframe", () => {
            const region = setup({currentBehavior: "navigate"});
            const info = list("l");
            region.add(info);
            region.navigate(info.key);

            region.navigate(info.key, {index: 2, autoplay: true});

            expect(provider.players).toHaveLength(1);
            expect(provider.players[0].selectItem).toHaveBeenCalledWith(info, 2, {autoplay: true});
            expect(panel.setCurrent).toHaveBeenCalledWith(2);
        });

        it("même playlist : repli sur playAt si le player n'a pas selectItem", () => {
            const region = setup({currentBehavior: "navigate"});
            const info = list("l");
            region.add(info);
            region.navigate(info.key);
            provider.players[0].selectItem = undefined;

            region.navigate(info.key, {index: 1});

            expect(provider.players[0].playAt).toHaveBeenCalledWith(1);
        });
    });

    describe("conteneur absent ou remplacé", () => {
        it("met la navigation en attente puis l'exécute à l'enregistrement du conteneur", () => {
            const region = setup({container: false});
            region.add(video("a"));

            region.navigate("v:a");
            expect(region.hasPending()).toBe(true);
            expect(provider.createPlayer).not.toHaveBeenCalled();

            const element = document.createElement("div");
            document.body.append(element);
            region.register(element);

            expect(region.hasPending()).toBe(false);
            expect(region.hasContainer).toBe(true);
            expect(element.firstChild).toBe(provider.players[0].iframe);
        });

        it("une action en attente qui échoue émet une erreur sans bloquer les autres", () => {
            const region = setup({container: false});
            const onError = vi.fn();
            region.on("error", onError);
            region.add(video("a"));
            region.add(video("b"));
            provider.createPlayer.mockImplementationOnce(() => {
                throw new Error("boom");
            });
            region.navigate("v:a");
            region.navigate("v:b");

            const element = document.createElement("div");
            document.body.append(element);
            region.register(element);

            expect(onError).toHaveBeenCalledTimes(1);
            expect(region.current.key).toBe("v:b");
        });

        it("un nouveau conteneur remplace l'ancien : le contenu précédent est réinitialisé", () => {
            const region = setup();
            region.add(video("a"));
            region.navigate("v:a");
            const first = provider.players[0];
            panel.clear.mockClear();

            const other = document.createElement("div");
            document.body.append(other);
            region.register(other);

            expect(first.dispose).toHaveBeenCalled();
            expect(panel.clear).toHaveBeenCalled();
        });

        it("goBack, goForward, nextInfo, previousInfo renvoient false sans conteneur", () => {
            const region = setup({container: false});
            expect(region.goBack()).toBe(false);
            expect(region.goForward()).toBe(false);
            expect(region.nextInfo()).toBe(false);
            expect(region.previousInfo()).toBe(false);
        });

        it("show, hide et toggle sont sans effet sans conteneur", () => {
            const region = setup({container: false});
            expect(() => {
                region.show();
                region.hide();
                region.toggle();
            }).not.toThrow();
        });
    });

    describe("historique", () => {
        it("goBack / goForward restaurent l'info sans démarrer la lecture", () => {
            const region = setup();
            region.add(video("a"));
            region.add(video("b"));
            region.navigate("v:a");
            region.navigate("v:b");
            expect(region.canGoBack).toBe(true);

            expect(region.goBack()).toBe(true);
            expect(region.current.key).toBe("v:a");
            expect(provider.players.at(-1).load).toHaveBeenCalledWith(region.current, {autoplay: false, index: 0});
            expect(region.canGoForward).toBe(true);

            expect(region.goForward()).toBe(true);
            expect(region.current.key).toBe("v:b");
        });

        it("renvoie false aux extrémités de l'historique", () => {
            const region = setup();
            region.add(video("a"));
            region.navigate("v:a");
            expect(region.goBack()).toBe(false);
            expect(region.goForward()).toBe(false);
        });

        it("goBack émet un change avec la raison 'back'", () => {
            const region = setup();
            const onChange = vi.fn();
            region.add(video("a"));
            region.add(video("b"));
            region.navigate("v:a");
            region.navigate("v:b");
            region.on("change", onChange);

            region.goBack();

            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({reason: "back"}));
        });

        it("replace() remplace l'entrée courante sans ajouter d'historique", () => {
            const region = setup();
            const onChange = vi.fn();
            region.add(video("a"));
            region.add(video("b"));
            region.navigate("v:a");
            region.on("change", onChange);

            region.replace("v:b", {autoplay: true});

            expect(region.current.key).toBe("v:b");
            expect(region.canGoBack).toBe(false);
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({reason: "replace"}));
        });

        it("replace() lève une erreur pour une clé inconnue", () => {
            const region = setup();
            expect(() => region.replace("inconnue")).toThrow(/No info found/);
        });
    });

    describe("restore()", () => {
        it("renvoie false pour une clé inconnue, sans lever d'erreur", () => {
            const region = setup();
            expect(region.restore("inconnue")).toBe(false);
        });

        it("navigue sans autoplay quand l'info n'est pas la courante", () => {
            const region = setup();
            region.add(video("a"));
            region.add(video("b"));
            region.navigate("v:a");

            expect(region.restore("v:b", {index: 0})).toBe(true);

            expect(region.current.key).toBe("v:b");
            expect(provider.players.at(-1).load).toHaveBeenCalledWith(region.current, {autoplay: false, index: 0});
        });

        it("info déjà courante au même index : ne fait rien (pas de toggle, pas d'évènement)", () => {
            const region = setup();
            const onChange = vi.fn();
            region.add(video("a"));
            region.navigate("v:a");
            region.on("change", onChange);

            region.restore("v:a");

            expect(host.hidden).toBe(false);
            expect(onChange).not.toHaveBeenCalled();
            expect(provider.players).toHaveLength(1);
            expect(provider.players[0].pause).not.toHaveBeenCalled();
        });

        it("info courante, autre item : une seule commande selectItem, sans nouvelle iframe ni nouvelle entrée", () => {
            const region = setup();
            const onChange = vi.fn();
            const info = list("l");
            region.add(info);
            region.navigate(info.key);
            region.on("change", onChange);

            region.restore(info.key, {index: 2});

            expect(provider.players).toHaveLength(1);
            expect(provider.players[0].selectItem).toHaveBeenCalledWith(info, 2, {autoplay: false});
            expect(region.currentIndex).toBe(2);
            expect(region.canGoBack).toBe(false);
            expect(panel.setCurrent).toHaveBeenCalledWith(2);
            expect(host.hidden).toBe(false);
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({reason: "restore", index: 2}));
        });

        it("fonctionne sur une iframe adoptée", () => {
            const region = setup();
            const iframe = document.createElement("iframe");
            host.append(iframe);
            const info = list("l");
            region.adopt(iframe, info);

            region.restore(info.key, {index: 1});

            expect(provider.players).toHaveLength(1);
            expect(provider.players[0].selectItem).toHaveBeenCalledWith(info, 1, {autoplay: false});
            expect(host.hidden).toBe(false);
        });

        it("attend le conteneur avant de s'exécuter", () => {
            const region = setup({container: false});
            region.add(video("a"));

            expect(region.restore("v:a")).toBe(true);
            expect(region.hasPending()).toBe(true);
            expect(provider.createPlayer).not.toHaveBeenCalled();

            const element = document.createElement("div");
            document.body.append(element);
            region.register(element);

            expect(region.current.key).toBe("v:a");
        });
    });

    describe("navigation entre infos", () => {
        let region;

        beforeEach(() => {
            region = setup();
            ["a", "b", "c"].forEach((id) => region.add(video(id)));
        });

        it("canGoPreviousInfo / canGoNextInfo avant toute navigation", () => {
            expect(region.canGoPreviousInfo).toBe(false);
            expect(region.canGoNextInfo).toBe(true);
        });

        it("nextInfo() et previousInfo() se déplacent avec autoplay", () => {
            region.navigate("v:a");

            expect(region.nextInfo()).toBe(true);
            expect(region.current.key).toBe("v:b");
            expect(provider.players.at(-1).load).toHaveBeenCalledWith(region.current, {autoplay: true, index: 0});

            expect(region.previousInfo()).toBe(true);
            expect(region.current.key).toBe("v:a");
        });

        it("renvoie false et ne bouge pas aux extrémités", () => {
            region.navigate("v:a");
            expect(region.previousInfo()).toBe(false);
            expect(region.canGoPreviousInfo).toBe(false);

            region.navigate("v:c");
            expect(region.nextInfo()).toBe(false);
            expect(region.canGoNextInfo).toBe(false);
            expect(region.current.key).toBe("v:c");
        });
    });

    describe("boundaryBehavior (nextInfo / previousInfo aux extrémités)", () => {
        const withInfos = (options, ids = ["a", "b", "c"]) => {
            const region = setup(options);
            ids.forEach((id) => region.add(video(id)));
            return region;
        };

        it("'stop' (défaut) : rien ne se passe après la dernière ou avant la première info", () => {
            const region = withInfos();
            region.navigate("v:c");
            expect(region.nextInfo()).toBe(false);
            expect(region.current.key).toBe("v:c");

            region.navigate("v:a");
            expect(region.previousInfo()).toBe(false);
            expect(region.current.key).toBe("v:a");
        });

        it("'loop' : nextInfo() de la dernière revient à la première, avec autoplay", () => {
            const region = withInfos({boundaryBehavior: "loop"});
            region.navigate("v:c");

            expect(region.nextInfo()).toBe(true);

            expect(region.current.key).toBe("v:a");
            expect(provider.players.at(-1).load).toHaveBeenCalledWith(region.current, {autoplay: true, index: 0});
        });

        it("'loop' : previousInfo() de la première va à la dernière", () => {
            const region = withInfos({boundaryBehavior: "loop"});
            region.navigate("v:a");

            expect(region.previousInfo()).toBe(true);

            expect(region.current.key).toBe("v:c");
        });

        it("'loop' : fait le tour complet", () => {
            const region = withInfos({boundaryBehavior: "loop"});
            region.navigate("v:a");

            const visited = [];
            for (let i = 0; i < 4; i++) {
                region.nextInfo();
                visited.push(region.current.key);
            }

            expect(visited).toEqual(["v:b", "v:c", "v:a", "v:b"]);
        });

        it("'loop' : canGoNextInfo et canGoPreviousInfo restent vrais aux extrémités", () => {
            const region = withInfos({boundaryBehavior: "loop"});

            region.navigate("v:c");
            expect(region.canGoNextInfo).toBe(true);

            region.navigate("v:a");
            expect(region.canGoPreviousInfo).toBe(true);
        });

        it("'stop' : canGoNextInfo et canGoPreviousInfo sont faux aux extrémités", () => {
            const region = withInfos();

            region.navigate("v:c");
            expect(region.canGoNextInfo).toBe(false);

            region.navigate("v:a");
            expect(region.canGoPreviousInfo).toBe(false);
        });

        it("'loop' avec une seule info : pas de bouclage, et pas de toggle", () => {
            const region = withInfos({boundaryBehavior: "loop"}, ["a"]);
            region.navigate("v:a");

            expect(region.nextInfo()).toBe(false);
            expect(region.previousInfo()).toBe(false);
            expect(region.canGoNextInfo).toBe(false);
            expect(region.canGoPreviousInfo).toBe(false);
            expect(host.hidden).toBe(false);
            expect(provider.players).toHaveLength(1);
        });

        it("'loop' sans info courante : nextInfo() va à la première, previousInfo() à la dernière", () => {
            const first = withInfos({boundaryBehavior: "loop"});
            first.nextInfo();
            expect(first.current.key).toBe("v:a");

            const second = withInfos({boundaryBehavior: "loop"});
            second.previousInfo();
            expect(second.current.key).toBe("v:c");
        });

        it("'stop' sans info courante : previousInfo() ne fait rien", () => {
            const region = withInfos();
            expect(region.previousInfo()).toBe(false);
            expect(region.current).toBeNull();
        });

        it("'loop' transmet les params", () => {
            const region = withInfos({boundaryBehavior: "loop"});
            region.navigate("v:c");

            region.nextInfo({params: {via: "bouton"}});

            expect(region.currentParams).toEqual({via: "bouton"});
        });

        it("refuse une valeur inconnue", () => {
            expect(() => setup({boundaryBehavior: "loops"})).toThrow(TypeError);
        });
    });

    describe("items d'une playlist", () => {
        it("itemCount : 0 pour une vidéo, la taille de la liste, null si inconnue", () => {
            const region = setup({currentBehavior: "navigate"});
            region.add(video("a"));
            region.add(list("l", 3));
            region.add({...list("p"), key: "p:1", videoIds: undefined, videos: []});

            region.navigate("v:a");
            expect(region.itemCount).toBe(0);
            region.navigate("l:l");
            expect(region.itemCount).toBe(3);
            region.navigate("p:1");
            expect(region.itemCount).toBeNull();
        });

        it("canGoPreviousItem / canGoNextItem suivent l'index courant", () => {
            const region = setup();
            region.add(list("l", 3));
            region.navigate("l:l");

            expect(region.canGoPreviousItem).toBe(false);
            expect(region.canGoNextItem).toBe(true);

            region.playAt(2);
            expect(region.canGoPreviousItem).toBe(true);
            expect(region.canGoNextItem).toBe(false);
        });

        it("canGoNextItem reste vrai quand la taille est inconnue", () => {
            const region = setup();
            region.add({...list("p"), key: "p:1", videoIds: undefined, videos: []});
            region.navigate("p:1");
            expect(region.canGoNextItem).toBe(true);
        });

        it("une vidéo seule n'a ni item précédent ni item suivant", () => {
            const region = setup();
            region.add(video("a"));
            region.navigate("v:a");
            expect(region.canGoPreviousItem).toBe(false);
            expect(region.canGoNextItem).toBe(false);
        });

        it("nextItem() et previousItem() délèguent au player", () => {
            const region = setup();
            region.add(list("l"));
            region.navigate("l:l");

            region.nextItem();
            region.previousItem();

            expect(provider.players[0].next).toHaveBeenCalled();
            expect(provider.players[0].previous).toHaveBeenCalled();
        });

        it("nextItem() sans player ne lève pas d'erreur", () => {
            const region = setup();
            expect(() => {
                region.nextItem();
                region.previousItem();
            }).not.toThrow();
        });

        it("playAt() met à jour l'index, le journal, le panneau et émet 'item'", () => {
            const region = setup();
            const onChange = vi.fn();
            region.add(list("l"));
            region.navigate("l:l");
            region.on("change", onChange);

            region.playAt(2);

            expect(provider.players[0].playAt).toHaveBeenCalledWith(2);
            expect(region.currentIndex).toBe(2);
            expect(panel.setCurrent).toHaveBeenCalledWith(2);
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({reason: "item", index: 2}));
        });
    });

    describe("événements du player", () => {
        let region;
        let player;

        beforeEach(() => {
            region = setup();
            region.add(list("l"));
            region.navigate("l:l");
            player = provider.players[0];
        });

        it("itemChange : met à jour l'index, le panneau, le journal et émet 'item'", () => {
            const onChange = vi.fn();
            region.on("change", onChange);

            player.emit({type: "itemChange", index: 2});

            expect(region.currentIndex).toBe(2);
            expect(panel.setCurrent).toHaveBeenCalledWith(2);
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({reason: "item", index: 2}));
        });

        it("itemChange : revenir en arrière restaure aussi l'item", () => {
            region.add(video("a"));
            player.emit({type: "itemChange", index: 2});
            region.navigate("v:a");

            region.goBack();

            expect(provider.players.at(-1).load).toHaveBeenLastCalledWith(region.current, {autoplay: false, index: 2});
        });

        it("itemChange : exécute les hooks afterNavigate avec la raison 'item'", () => {
            const hook = vi.fn();
            region.afterNavigate(hook);

            player.emit({type: "itemChange", index: 1});

            expect(hook).toHaveBeenCalledWith(
                expect.objectContaining({reason: "item", index: 1}),
                expect.objectContaining({index: 0})
            );
        });

        it("itemChange vers l'index déjà connu est ignoré (pas de double notification)", () => {
            const hook = vi.fn();
            const onChange = vi.fn();
            region.afterNavigate(hook);
            region.on("change", onChange);

            player.emit({type: "itemChange", index: 0}); // notification initiale du player
            expect(hook).not.toHaveBeenCalled();

            region.playAt(2);
            hook.mockClear();
            onChange.mockClear();
            player.emit({type: "itemChange", index: 2}); // le player confirme le playAt

            expect(hook).not.toHaveBeenCalled();
            expect(onChange).not.toHaveBeenCalled();
        });

        it("state : émet un événement 'state' avec l'index du player ou l'index courant", () => {
            const onState = vi.fn();
            region.on("state", onState);

            player.emit({type: "state", state: "playing"});
            player.emit({type: "state", state: "ended", index: 2});

            expect(onState).toHaveBeenNthCalledWith(1, expect.objectContaining({region, state: "playing", index: 0}));
            expect(onState).toHaveBeenNthCalledWith(2, expect.objectContaining({state: "ended", index: 2}));
        });

        it("error : émet un événement 'error' avec l'info courante", () => {
            const onError = vi.fn();
            region.on("error", onError);
            const error = new Error("boom");

            player.emit({type: "error", error});

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({region, error, info: region.current}));
        });

        it("error sans écouteur : l'erreur est écrite dans la console", () => {
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            player.emit({type: "error", error: new Error("boom")});
            expect(spy).toHaveBeenCalled();
        });
    });

    describe("erreurs de rendu", () => {
        it("une erreur du provider est signalée et n'émet pas de change", () => {
            const region = setup();
            const onError = vi.fn();
            const onChange = vi.fn();
            region.on("error", onError);
            region.add(video("a"));
            provider.createPlayer.mockImplementation(() => {
                throw new Error("boom");
            });
            region.on("change", onChange);

            expect(() => region.navigate("v:a")).not.toThrow();

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({info: region.get("v:a")}));
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe("visibilité", () => {
        it("hide() met en pause, cache et émet 'visibility'", () => {
            const region = setup();
            const onChange = vi.fn();
            region.add(video("a"));
            region.navigate("v:a");
            region.on("change", onChange);

            region.hide();

            expect(host.hidden).toBe(true);
            expect(provider.players[0].pause).toHaveBeenCalled();
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({reason: "visibility", visible: false}));
        });

        it("show() réaffiche, toggle() alterne", () => {
            const region = setup();
            host.hidden = true;

            region.show();
            expect(host.hidden).toBe(false);

            region.toggle();
            expect(host.hidden).toBe(true);
            region.toggle();
            expect(host.hidden).toBe(false);
        });
    });

    describe("adopt()", () => {
        it("pilote une iframe existante sans en créer une autre", () => {
            const region = setup();
            const iframe = document.createElement("iframe");
            host.append(iframe);
            const info = video("a");
            const onChange = vi.fn();
            region.on("change", onChange);

            region.adopt(iframe, info);

            expect(provider.createPlayer).toHaveBeenCalledWith({iframe});
            expect(region.current).toBe(info);
            expect(region.has(info.key)).toBe(true);
            expect(panel.clear).toHaveBeenCalled();
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({reason: "adopt"}));
        });

        it("dessine le panneau pour une playlist", () => {
            const region = setup();
            const iframe = document.createElement("iframe");
            host.append(iframe);

            region.adopt(iframe, list("l"));

            expect(panel.render).toHaveBeenCalledWith(expect.objectContaining({iframe, current: 0}));
        });

        it("utilise l'info canonique quand la clé est déjà connue", () => {
            const region = setup();
            const known = video("a");
            region.add(known);
            const iframe = document.createElement("iframe");
            host.append(iframe);

            region.adopt(iframe, video("a"));

            expect(region.current).toBe(known);
        });

        it("utilise le parent de l'iframe comme conteneur quand il n'est pas encore connu", () => {
            const region = setup({container: false});
            document.body.innerHTML = '<div id="zone"><iframe></iframe></div>';
            const iframe = document.querySelector("iframe");

            region.adopt(iframe, video("a"));

            expect(region.hasContainer).toBe(true);
            expect(region.current.key).toBe("v:a");
        });

        it("lève une erreur quand l'iframe est hors du conteneur", () => {
            const region = setup();
            const outside = document.createElement("iframe");
            document.body.append(outside);

            expect(() => region.adopt(outside, video("a"))).toThrow(/not inside #zone/);
        });
    });

    describe("enrichissement des métadonnées (resolveMeta)", () => {
        it("est appelé une seule fois par playlist et redessine le panneau si quelque chose a changé", async () => {
            const resolveMeta = vi.fn().mockResolvedValue(true);
            const region = setup({resolveMeta, currentBehavior: "navigate"});
            const info = list("l");
            region.add(info);

            region.navigate(info.key);
            await flush();
            region.navigate(info.key, {index: 1});
            await flush();

            expect(resolveMeta).toHaveBeenCalledTimes(1);
            expect(resolveMeta).toHaveBeenCalledWith(info, {force: false});
            expect(panel.render).toHaveBeenCalledTimes(2);
        });

        it("ne redessine pas quand rien n'a changé", async () => {
            const region = setup({resolveMeta: vi.fn().mockResolvedValue(false)});
            region.add(list("l"));
            region.navigate("l:l");
            await flush();
            expect(panel.render).toHaveBeenCalledTimes(1);
        });

        it("est aussi appelé pour une vidéo seule (c'est resolveMeta qui décide) et prévient les hooks", async () => {
            const resolveMeta = vi.fn().mockResolvedValue(true);
            const region = setup({resolveMeta});
            const hook = vi.fn();
            const info = video("a");
            region.add(info);
            region.afterNavigate(hook);

            region.navigate("v:a");
            await flush();

            expect(resolveMeta).toHaveBeenCalledWith(info, {force: false});
            expect(hook.mock.lastCall[0].reason).toBe("meta");
            expect(panel.render).not.toHaveBeenCalled();
        });

        it("signale une erreur quand la résolution est rejetée", async () => {
            const region = setup({resolveMeta: vi.fn().mockRejectedValue(new Error("API"))});
            const onError = vi.fn();
            region.on("error", onError);
            region.add(list("l"));

            region.navigate("l:l");
            await flush();

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({error: expect.objectContaining({message: "API"})}));
        });

        it("ne redessine pas si l'info n'est plus la courante", async () => {
            let resolve;
            const resolveMeta = vi.fn(() => new Promise((r) => (resolve = r)));
            const region = setup({resolveMeta});
            region.add(list("l"));
            region.add(video("a"));
            region.navigate("l:l");
            region.navigate("v:a");

            resolve(true);
            await flush();

            expect(panel.render).toHaveBeenCalledTimes(1);
        });
    });

    describe("paramètres de navigation (params)", () => {
        it("sont transmis aux hooks, à l'évènement change et exposés par currentParams", () => {
            const region = setup();
            const hook = vi.fn();
            const onChange = vi.fn();
            region.afterNavigate(hook);
            region.on("change", onChange);
            region.add(video("a"));

            region.navigate("v:a", {params: {origin: "menu"}});

            expect(hook.mock.lastCall[0].params).toEqual({origin: "menu"});
            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({params: {origin: "menu"}}));
            expect(region.currentParams).toEqual({origin: "menu"});
        });

        it("valent {} quand rien n'est donné", () => {
            const region = setup();
            const hook = vi.fn();
            region.afterNavigate(hook);
            region.add(video("a"));

            region.navigate("v:a");

            expect(hook.mock.lastCall[0].params).toEqual({});
            expect(region.currentParams).toEqual({});
        });

        it("sont un instantané figé : modifier l'objet de l'appelant ne change rien", () => {
            const region = setup();
            const params = {n: 1};
            region.add(video("a"));

            region.navigate("v:a", {params});
            params.n = 2;

            expect(region.currentParams.n).toBe(1);
            expect(Object.isFrozen(region.currentParams)).toBe(true);
        });

        it("goBack / goForward rejouent les params de l'entrée d'historique", () => {
            const region = setup();
            const hook = vi.fn();
            region.add(video("a"));
            region.add(video("b"));
            region.navigate("v:a", {params: {n: 1}});
            region.navigate("v:b", {params: {n: 2}});
            region.afterNavigate(hook);

            region.goBack();
            expect(hook.mock.lastCall[0]).toEqual(expect.objectContaining({reason: "back", params: {n: 1}}));

            region.goForward();
            expect(hook.mock.lastCall[0]).toEqual(expect.objectContaining({reason: "forward", params: {n: 2}}));
        });

        it("replace() les prend en compte", () => {
            const region = setup();
            region.add(video("a"));
            region.add(video("b"));
            region.navigate("v:a", {params: {n: 1}});

            region.replace("v:b", {params: {n: 9}});

            expect(region.currentParams).toEqual({n: 9});
        });

        it("adopt() les prend en compte", () => {
            const region = setup();
            const hook = vi.fn();
            region.afterNavigate(hook);
            const iframe = document.createElement("iframe");
            host.append(iframe);

            region.adopt(iframe, video("a"), {params: {x: 1}});

            expect(hook.mock.lastCall[0]).toEqual(expect.objectContaining({reason: "adopt", params: {x: 1}}));
        });

        it("restore() les transmet quand il navigue", () => {
            const region = setup();
            region.add(video("a"));

            region.restore("v:a", {params: {saved: true}});

            expect(region.currentParams).toEqual({saved: true});
        });

        it("nextInfo() / previousInfo() les transmettent", () => {
            const region = setup();
            region.add(video("a"));
            region.add(video("b"));
            region.navigate("v:a");

            region.nextInfo({params: {via: "bouton"}});

            expect(region.currentParams).toEqual({via: "bouton"});
        });

        it("sont conservés quand l'item change dans la playlist", () => {
            const region = setup();
            const hook = vi.fn();
            region.add(list("l"));
            region.navigate("l:l", {params: {n: 1}});
            region.afterNavigate(hook);

            provider.players[0].emit({type: "itemChange", index: 2});

            expect(hook.mock.lastCall[0]).toEqual(expect.objectContaining({reason: "item", index: 2, params: {n: 1}}));
        });
    });

    describe("afterNavigate()", () => {
        it("est appelé après navigate avec (to, from), from valant null la première fois", () => {
            const region = setup();
            const hook = vi.fn();
            const a = video("a");
            const b = video("b");
            region.add(a);
            region.add(b);
            region.afterNavigate(hook);

            region.navigate("v:a");
            region.navigate("v:b");

            expect(hook).toHaveBeenNthCalledWith(1, expect.objectContaining({info: a, index: 0, item: a, reason: "navigate"}), null);
            expect(hook).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({info: b, item: b}),
                expect.objectContaining({info: a})
            );
        });

        it("to.item est la vidéo courante d'une playlist, null tant que les items sont inconnus", () => {
            const region = setup();
            const hook = vi.fn();
            const withItems = {...list("l"), videos: [{videoId: "l0", title: "A"}, {videoId: "l1", title: "B"}]};
            region.add(withItems);
            region.add({...list("m"), key: "m:m"});
            region.afterNavigate(hook);

            region.navigate(withItems.key, {index: 1});
            expect(hook.mock.lastCall[0].item.title).toBe("B");

            region.navigate("m:m");
            expect(hook.mock.lastCall[0].item).toBeNull();
        });

        it("reçoit la raison de chaque type de navigation", () => {
            const region = setup();
            const reasons = [];
            region.add(video("a"));
            region.add(video("b"));
            region.afterNavigate((to) => reasons.push(to.reason));

            region.navigate("v:a");
            region.navigate("v:b");
            region.goBack();
            region.goForward();
            region.replace("v:a");
            region.restore("v:b");

            expect(reasons).toEqual(["navigate", "navigate", "back", "forward", "replace", "restore"]);
        });

        it("n'est pas appelé pour show / hide / toggle", () => {
            const region = setup();
            const hook = vi.fn();
            region.add(video("a"));
            region.navigate("v:a");
            region.afterNavigate(hook);

            region.hide();
            region.show();
            region.toggle();

            expect(hook).not.toHaveBeenCalled();
        });

        it("n'est pas appelé quand la navigation échoue", () => {
            const region = setup();
            const hook = vi.fn();
            region.on("error", () => {});
            region.add(video("a"));
            region.afterNavigate(hook);
            provider.createPlayer.mockImplementation(() => {
                throw new Error("boom");
            });

            region.navigate("v:a");

            expect(hook).not.toHaveBeenCalled();
        });

        it("est appelé quand la vidéo est déjà affichée dans le conteneur", () => {
            const region = setup();
            let iframeInHost = null;
            region.add(video("a"));
            region.afterNavigate(() => {
                iframeInHost = host.querySelector("iframe") !== null;
            });

            region.navigate("v:a");

            expect(iframeInHost).toBe(true);
        });

        it("renvoie une fonction qui retire le hook", () => {
            const region = setup();
            const hook = vi.fn();
            region.add(video("a"));
            region.add(video("b"));
            const off = region.afterNavigate(hook);

            region.navigate("v:a");
            off();
            region.navigate("v:b");

            expect(hook).toHaveBeenCalledTimes(1);
        });

        it("refuse autre chose qu'une fonction", () => {
            const region = setup();
            expect(() => region.afterNavigate("oups")).toThrow(TypeError);
        });

        it("la même fonction enregistrée deux fois ne s'exécute qu'une fois", () => {
            const region = setup();
            const hook = vi.fn();
            region.add(video("a"));
            region.afterNavigate(hook);
            region.afterNavigate(hook);

            region.navigate("v:a");

            expect(hook).toHaveBeenCalledTimes(1);
        });

        it("immediate : s'exécute tout de suite quand quelque chose est affiché", () => {
            const region = setup();
            const hook = vi.fn();
            region.add(video("a"));
            region.navigate("v:a", {params: {n: 1}});

            region.afterNavigate(hook, {immediate: true});

            expect(hook).toHaveBeenCalledWith(
                expect.objectContaining({reason: "immediate", info: region.current, params: {n: 1}}),
                null
            );
        });

        it("immediate : ne fait rien quand rien n'est affiché", () => {
            const region = setup();
            const hook = vi.fn();

            region.afterNavigate(hook, {immediate: true});

            expect(hook).not.toHaveBeenCalled();
        });

        it("un hook qui lève n'empêche pas les suivants", () => {
            const region = setup();
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            const second = vi.fn();
            region.add(video("a"));
            region.afterNavigate(() => {
                throw new Error("boom");
            });
            region.afterNavigate(second);

            region.navigate("v:a");

            expect(second).toHaveBeenCalled();
            expect(spy).toHaveBeenCalled();
        });

        it("un hook asynchrone rejeté est signalé dans la console", async () => {
            const region = setup();
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            region.add(video("a"));
            region.afterNavigate(async () => {
                throw new Error("boom");
            });

            region.navigate("v:a");
            await flush();

            expect(spy).toHaveBeenCalled();
        });

        it("un hook peut se retirer pendant l'exécution sans casser la boucle", () => {
            const region = setup();
            const second = vi.fn();
            region.add(video("a"));
            const off = region.afterNavigate(() => off());
            region.afterNavigate(second);

            expect(() => region.navigate("v:a")).not.toThrow();
            expect(second).toHaveBeenCalled();
        });

        it("est rappelé avec la raison 'meta' quand les items de la playlist sont complétés", async () => {
            const region = setup({resolveMeta: vi.fn().mockResolvedValue(true)});
            const hook = vi.fn();
            region.add(list("l"));
            region.afterNavigate(hook);

            region.navigate("l:l");
            await flush();

            expect(hook).toHaveBeenCalledTimes(2);
            expect(hook.mock.lastCall[0].reason).toBe("meta");
        });

        it("est vidé par dispose()", () => {
            const region = setup();
            const hook = vi.fn();
            region.add(video("a"));
            region.afterNavigate(hook);

            region.dispose();
            region.show();

            expect(hook).not.toHaveBeenCalled();
        });
    });

    describe("refreshMeta()", () => {
        it("résout l'info courante avec force, même une vidéo seule déjà résolue, et prévient les hooks", async () => {
            const resolveMeta = vi.fn().mockResolvedValue(true);
            const region = setup({resolveMeta});
            const hook = vi.fn();
            region.add(video("a"));
            region.navigate("v:a");
            await flush();
            resolveMeta.mockClear();
            region.afterNavigate(hook);

            const changed = await region.refreshMeta();

            expect(changed).toBe(true);
            expect(resolveMeta).toHaveBeenCalledWith(region.get("v:a"), {force: true});
            expect(hook.mock.lastCall[0].reason).toBe("meta");
        });

        it("accepte une clé et force: false", async () => {
            const resolveMeta = vi.fn().mockResolvedValue(false);
            const region = setup({resolveMeta});
            region.add(video("a"));
            region.add(video("b"));

            await region.refreshMeta("v:b", {force: false});

            expect(resolveMeta).toHaveBeenCalledWith(region.get("v:b"), {force: false});
        });

        it("ne prévient pas les hooks quand rien n'a changé", async () => {
            const region = setup({resolveMeta: vi.fn().mockResolvedValue(false)});
            const hook = vi.fn();
            region.add(video("a"));
            region.navigate("v:a");
            await flush();
            region.afterNavigate(hook);

            expect(await region.refreshMeta()).toBe(false);
            expect(hook).not.toHaveBeenCalled();
        });

        it("renvoie false sans resolveMeta, sans info courante ou pour une clé inconnue", async () => {
            const without = setup();
            without.add(video("a"));
            without.navigate("v:a");
            expect(await without.refreshMeta()).toBe(false);

            const region = setup({resolveMeta: vi.fn().mockResolvedValue(true)});
            expect(await region.refreshMeta()).toBe(false);
            expect(await region.refreshMeta("inconnue")).toBe(false);
        });

        it("signale l'erreur par l'évènement 'error' et renvoie false", async () => {
            const region = setup({resolveMeta: vi.fn().mockRejectedValue(new Error("API"))});
            const onError = vi.fn();
            region.on("error", onError);
            region.add(video("a"));
            region.navigate("v:a");
            await flush();
            onError.mockClear();

            expect(await region.refreshMeta()).toBe(false);
            expect(onError).toHaveBeenCalledTimes(1);
        });
    });

    describe("dispose()", () => {
        it("libère le player, détruit le panneau, vide les actions en attente et les écouteurs", () => {
            const region = setup({container: false});
            region.add(video("a"));
            region.navigate("v:a");
            expect(region.hasPending()).toBe(true);

            region.dispose();

            expect(region.hasPending()).toBe(false);
            expect(panel.destroy).toHaveBeenCalled();
        });

        it("dispose le player courant", () => {
            const region = setup();
            region.add(video("a"));
            region.navigate("v:a");

            region.dispose();

            expect(provider.players[0].dispose).toHaveBeenCalled();
        });

        it("les écouteurs ne sont plus appelés après dispose()", () => {
            const region = setup();
            const onChange = vi.fn();
            region.on("change", onChange);

            region.dispose();
            region.show();

            expect(onChange).not.toHaveBeenCalled();
        });
    });
});