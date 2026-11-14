import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("../src/ui/PanelRenderer.js", () => ({
    PanelRenderer: class {
        render = vi.fn();
        clear = vi.fn();
        setCurrent = vi.fn();
        destroy = vi.fn();
    }
}));

import {Region} from "../src/Region.js";

// ───────── helpers ─────────

const makeInfo = (key, {isPlaylist = false, videoIds, videos = []} = {}) =>
    ({key, provider: "yt", isPlaylist, videoIds, videos});
const video = (key) => makeInfo(key);
const playlist = (key, nb = 3) =>
    makeInfo(key, {isPlaylist: true, videoIds: Array.from({length: nb}, (_, i) => `v${i}`)});

function makePlayer(iframe) {
    const unsubscribe = vi.fn();
    return {
        kind: "yt",
        iframe: iframe ?? document.createElement("iframe"),
        load: vi.fn(),
        next: vi.fn(),
        previous: vi.fn(),
        playAt: vi.fn(),
        pause: vi.fn(),
        dispose: vi.fn(),
        subscribe: vi.fn(() => unsubscribe)
    };
}

/**
 * withHost: false => l'élément de la cible n'existe pas à la construction de la région.
 * discover() simule sa découverte : il arrive dans la page, puis la région l'enregistre.
 */
function createEnv({withHost = true, ...options} = {}) {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.id = "zone";
    if (withHost) document.body.append(host);

    const players = [];
    const provider = {
        id: "yt",
        createPlayer: vi.fn((opts) => {
            const player = makePlayer(opts?.iframe);
            players.push(player);
            return player;
        })
    };
    const registry = {get: vi.fn(() => provider)};
    const panel = {render: vi.fn(), clear: vi.fn(), setCurrent: vi.fn(), destroy: vi.fn()};
    const region = new Region({target: "zone", registry, panelRenderer: panel, ...options});

    return {
        region,
        host,
        provider,
        players,
        panel,
        lastPlayer: () => players.at(-1),
        discover: () => {
            if (!host.isConnected) document.body.append(host);
            region.register(host);
        }
    };
}

const listen = (region, type = "change") => {
    const handler = vi.fn();
    region.on(type, handler);
    return handler;
};

// ───────── tests ─────────

describe("Region : conteneur absent ou présent", () => {
    it("connaît son conteneur quand l'élément existe à la construction", () => {
        const {region} = createEnv();
        expect(region.hasContainer).toBe(true);
        expect(region.isVisible).toBe(true);
    });

    it("n'a pas de conteneur quand l'élément n'existe pas encore, et n'est pas visible", () => {
        const {region} = createEnv({withHost: false});
        expect(region.hasContainer).toBe(false);
        expect(region.isVisible).toBe(false);
    });

    it("a un conteneur après register()", () => {
        const {region, discover} = createEnv({withHost: false});
        discover();
        expect(region.hasContainer).toBe(true);
        expect(region.isVisible).toBe(true);
    });

    it("ne lève pas d'erreur à la construction sans conteneur", () => {
        expect(() => createEnv({withHost: false})).not.toThrow();
    });
});

describe("Region : navigate()", () => {
    describe("avec conteneur : exécuté directement", () => {
        it("crée le lecteur tout de suite, sans action en attente", () => {
            const {region, provider} = createEnv();
            region.add(video("A"));
            region.navigate("A");

            expect(provider.createPlayer).toHaveBeenCalledTimes(1);
            expect(region.current.key).toBe("A");
            expect(region.hasPending()).toBe(false);
        });

        it("émet « change » de façon synchrone", () => {
            const {region} = createEnv();
            region.add(video("A"));
            const handler = listen(region);
            region.navigate("A");
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].reason).toBe("navigate");
        });
    });

    describe("sans conteneur : différé", () => {
        let env;

        beforeEach(() => {
            env = createEnv({withHost: false});
            env.region.add(video("A"));
            env.region.add(video("B"));
            env.region.add(playlist("P", 5));
        });

        it("n'affiche rien, ne crée pas de lecteur et ne change pas l'état", () => {
            const handler = listen(env.region);
            env.region.navigate("A");

            expect(env.provider.createPlayer).not.toHaveBeenCalled();
            expect(env.region.current).toBeNull();
            expect(handler).not.toHaveBeenCalled();
        });

        it("garde l'action en attente", () => {
            env.region.navigate("A");
            expect(env.region.hasPending()).toBe(true);
        });

        it("exécute l'action quand le conteneur est découvert", () => {
            const handler = listen(env.region);
            env.region.navigate("A");
            env.discover();

            expect(env.provider.createPlayer).toHaveBeenCalledTimes(1);
            expect(env.region.current.key).toBe("A");
            expect(env.region.hasPending()).toBe(false);
            expect(handler.mock.calls[0][0].reason).toBe("navigate");
        });

        it("conserve autoplay, index et params", () => {
            const handler = listen(env.region);
            env.region.navigate("P", {autoplay: true, index: 2, params: {origine: "menu"}});
            env.discover();

            expect(env.lastPlayer().load).toHaveBeenCalledWith(env.region.get("P"), {autoplay: true, index: 2});
            expect(env.region.currentIndex).toBe(2);
            expect(handler.mock.calls[0][0].params).toEqual({origine: "menu"});
        });

        it("exécute les actions dans l'ordre où elles ont été demandées", () => {
            env.region.navigate("A");
            env.region.navigate("B");
            env.discover();

            expect(env.region.current.key).toBe("B");
            env.region.goBack();
            expect(env.region.current.key).toBe("A");
        });

        it("vide la file d'attente une seule fois (un second register() ne rejoue rien)", () => {
            env.region.navigate("A");
            env.discover();
            env.region.register(env.host);
            expect(env.provider.createPlayer).toHaveBeenCalledTimes(1);
        });

        it("lève quand même une erreur pour une clé inconnue", () => {
            expect(() => env.region.navigate("inconnue")).toThrow("No info found for key 'inconnue'");
            expect(env.region.hasPending()).toBe(false);
        });
    });
});

describe("Region : replace()", () => {
    it("avec conteneur : remplace l'entrée courante tout de suite", () => {
        const {region} = createEnv();
        region.add(video("A"));
        region.add(video("B"));
        region.navigate("A");
        region.replace("B");

        expect(region.current.key).toBe("B");
        expect(region.canGoBack).toBe(false);
    });

    it("sans conteneur : différé, et remplace à la découverte", () => {
        const {region, provider, discover} = createEnv({withHost: false});
        region.add(video("A"));
        region.add(video("B"));
        region.navigate("A");
        region.replace("B", {index: 0});

        expect(provider.createPlayer).not.toHaveBeenCalled();
        discover();

        expect(region.current.key).toBe("B");
        expect(region.canGoBack).toBe(false); // A a été remplacée, pas empilée
    });

    it("lève une erreur pour une clé inconnue, même différé", () => {
        const {region} = createEnv({withHost: false});
        expect(() => region.replace("inconnue")).toThrow("No info found for key 'inconnue'");
    });
});

describe("Region : restore()", () => {
    it("renvoie false pour une clé inconnue, sans rien mettre en attente", () => {
        const {region} = createEnv({withHost: false});
        expect(region.restore("inconnue")).toBe(false);
        expect(region.hasPending()).toBe(false);
    });

    it("avec conteneur : restaure tout de suite avec la raison « restore »", () => {
        const {region} = createEnv();
        region.add(playlist("P", 5));
        const handler = listen(region);

        expect(region.restore("P", {index: 3})).toBe(true);
        expect(region.currentIndex).toBe(3);
        expect(handler.mock.calls[0][0].reason).toBe("restore");
    });

    it("sans conteneur : renvoie true mais restaure à la découverte", () => {
        const {region, provider, discover} = createEnv({withHost: false});
        region.add(playlist("P", 5));

        expect(region.restore("P", {index: 3})).toBe(true);
        expect(provider.createPlayer).not.toHaveBeenCalled();

        discover();
        expect(region.current.key).toBe("P");
        expect(region.currentIndex).toBe(3);
    });
});

describe("Region : goBack() / goForward()", () => {
    it("avec conteneur : renvoie true quand un historique existe, false sinon", () => {
        const {region} = createEnv();
        region.add(video("A"));
        region.add(video("B"));
        expect(region.goBack()).toBe(false);

        region.navigate("A");
        region.navigate("B");
        expect(region.goBack()).toBe(true);
        expect(region.goForward()).toBe(true);
        expect(region.goForward()).toBe(false);
    });

    it("sans conteneur : renvoie false tout de suite et agit à la découverte", () => {
        const {region, discover} = createEnv({withHost: false});
        region.add(video("A"));
        region.add(video("B"));
        region.navigate("A");
        region.navigate("B");

        expect(region.goBack()).toBe(false); // différé : le résultat n'est pas connu
        discover();

        expect(region.current.key).toBe("A");
        expect(region.canGoForward).toBe(true);
    });

    it("sans conteneur ni historique : ne lève pas d'erreur", () => {
        const {region, discover} = createEnv({withHost: false});
        region.goBack();
        region.goForward();
        expect(() => discover()).not.toThrow();
        expect(region.current).toBeNull();
    });
});

describe("Region : nextInfo() / previousInfo()", () => {
    describe("avec conteneur", () => {
        it("navigue en lecture automatique et renvoie true", () => {
            const {region, lastPlayer} = createEnv();
            region.add(video("A"));
            region.add(video("B"));
            region.navigate("A");

            expect(region.nextInfo()).toBe(true);
            expect(region.current.key).toBe("B");
            expect(lastPlayer().load).toHaveBeenLastCalledWith(region.get("B"), {autoplay: true, index: 0});
        });

        it("renvoie false aux extrémités", () => {
            const {region} = createEnv();
            region.add(video("A"));
            region.add(video("B"));
            region.navigate("A");
            expect(region.previousInfo()).toBe(false);
            region.navigate("B");
            expect(region.nextInfo()).toBe(false);
        });
    });

    describe("sans conteneur", () => {
        it("renvoie false tout de suite", () => {
            const {region} = createEnv({withHost: false});
            region.add(video("A"));
            expect(region.nextInfo()).toBe(false);
            expect(region.previousInfo()).toBe(false);
        });

        it("calcule la cible à l'exécution : plusieurs nextInfo() avancent chacun d'un cran", () => {
            const {region, discover} = createEnv({withHost: false});
            region.add(video("A"));
            region.add(video("B"));
            region.add(video("C"));
            region.navigate("A");
            region.nextInfo();
            region.nextInfo();
            discover();

            expect(region.current.key).toBe("C");
        });

        it("nextInfo() puis previousInfo() reviennent à la même info", () => {
            const {region, discover} = createEnv({withHost: false});
            region.add(video("A"));
            region.add(video("B"));
            region.navigate("A");
            region.nextInfo();
            region.previousInfo();
            discover();

            expect(region.current.key).toBe("A");
        });

        it("nextInfo() sans info courante va à la première", () => {
            const {region, discover} = createEnv({withHost: false});
            region.add(video("A"));
            region.add(video("B"));
            region.nextInfo();
            discover();
            expect(region.current.key).toBe("A");
        });
    });
});

describe("Region : nextItem() / previousItem() / playAt()", () => {
    describe("avec conteneur", () => {
        it("délèguent au lecteur tout de suite", () => {
            const {region, lastPlayer} = createEnv();
            region.add(playlist("P"));
            region.navigate("P");
            region.nextItem();
            region.previousItem();

            expect(lastPlayer().next).toHaveBeenCalledTimes(1);
            expect(lastPlayer().previous).toHaveBeenCalledTimes(1);
        });

        it("playAt() commande le lecteur, met à jour l'index et émet « change » (item)", () => {
            const {region, lastPlayer, panel} = createEnv();
            region.add(playlist("P", 5));
            region.navigate("P");
            const handler = listen(region);
            region.playAt(3);

            expect(lastPlayer().playAt).toHaveBeenCalledWith(3);
            expect(region.currentIndex).toBe(3);
            expect(panel.setCurrent).toHaveBeenCalledWith(3);
            expect(handler.mock.calls[0][0]).toMatchObject({reason: "item", index: 3});
        });

        it("ne font rien (ni erreur, ni « change » fantôme) tant que rien n'est affiché", () => {
            const {region} = createEnv();
            const handler = listen(region);
            expect(() => {
                region.nextItem();
                region.previousItem();
                region.playAt(2);
            }).not.toThrow();
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe("sans conteneur", () => {
        it("sont différés jusqu'à la découverte, après la navigation qui les précède", () => {
            const {region, players, discover} = createEnv({withHost: false});
            region.add(playlist("P", 5));
            region.navigate("P");
            region.nextItem();
            region.previousItem();
            region.playAt(2);

            expect(players).toHaveLength(0);
            discover();

            expect(players).toHaveLength(1);
            expect(players[0].next).toHaveBeenCalledTimes(1);
            expect(players[0].previous).toHaveBeenCalledTimes(1);
            expect(players[0].playAt).toHaveBeenCalledWith(2);
            expect(region.currentIndex).toBe(2);
        });

        it("émet « navigate » puis « item » dans l'ordre", () => {
            const {region, discover} = createEnv({withHost: false});
            region.add(playlist("P", 5));
            const handler = listen(region);
            region.navigate("P");
            region.playAt(1);
            discover();

            expect(handler.mock.calls.map(([e]) => e.reason)).toEqual(["navigate", "item"]);
        });

        it("playAt() sans navigation préalable n'émet rien à la découverte", () => {
            const {region, discover} = createEnv({withHost: false});
            const handler = listen(region);
            region.playAt(1);
            discover();
            expect(handler).not.toHaveBeenCalled();
        });
    });
});

describe("Region : show() / hide() / toggle()", () => {
    describe("avec conteneur", () => {
        it("hide() cache tout de suite et met le lecteur en pause", () => {
            const {region, host, lastPlayer} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            const handler = listen(region);
            region.hide();

            expect(host.hidden).toBe(true);
            expect(lastPlayer().pause).toHaveBeenCalled();
            expect(handler.mock.calls[0][0]).toMatchObject({reason: "visibility", visible: false});
        });

        it("show() affiche tout de suite", () => {
            const {region, host} = createEnv();
            host.hidden = true;
            region.show();
            expect(host.hidden).toBe(false);
        });

        it("toggle() alterne", () => {
            const {region} = createEnv();
            region.toggle();
            expect(region.isVisible).toBe(false);
            region.toggle();
            expect(region.isVisible).toBe(true);
        });
    });

    describe("sans conteneur", () => {
        it("hide() est différé : le conteneur est caché à la découverte", () => {
            const {region, host, discover} = createEnv({withHost: false});
            const handler = listen(region);
            region.hide();
            expect(handler).not.toHaveBeenCalled();

            discover();
            expect(host.hidden).toBe(true);
            expect(handler.mock.calls[0][0]).toMatchObject({reason: "visibility", visible: false});
        });

        it("show() est différé", () => {
            const {region, host, discover} = createEnv({withHost: false});
            host.hidden = true;
            region.show();
            discover();
            expect(host.hidden).toBe(false);
        });

        it("toggle() est différé", () => {
            const {region, host, discover} = createEnv({withHost: false});
            region.toggle();
            discover();
            expect(host.hidden).toBe(true);
        });

        it("hide() puis show() se compensent", () => {
            const {region, host, discover} = createEnv({withHost: false});
            region.hide();
            region.show();
            discover();
            expect(host.hidden).toBe(false);
        });

        it("navigate() puis hide() : la vidéo est chargée puis le conteneur caché", () => {
            const {region, host, lastPlayer, discover} = createEnv({withHost: false});
            region.add(video("A"));
            region.navigate("A");
            region.hide();
            discover();

            expect(region.current.key).toBe("A");
            expect(lastPlayer().pause).toHaveBeenCalled();
            expect(host.hidden).toBe(true);
        });
    });
});

describe("Region : register()", () => {
    it("sans action en attente : ne fait rien de particulier", () => {
        const {region, provider, discover} = createEnv({withHost: false});
        expect(() => discover()).not.toThrow();
        expect(provider.createPlayer).not.toHaveBeenCalled();
        expect(region.hasPending()).toBe(false);
    });

    it("un autre élément remplace le conteneur : le contenu précédent est réinitialisé", () => {
        const {region, players, panel} = createEnv();
        region.add(video("A"));
        region.navigate("A");
        const autre = document.createElement("div");
        autre.id = "autre";
        document.body.append(autre);

        region.register(autre);

        expect(players[0].dispose).toHaveBeenCalled();
        expect(panel.clear).toHaveBeenCalled();
        expect(region.isVisible).toBe(true);
        autre.hidden = true;
        expect(region.isVisible).toBe(false);
    });

    it("exécute les actions en attente sur le nouvel élément", () => {
        const {region, host, discover} = createEnv({withHost: false});
        region.add(video("A"));
        region.navigate("A");
        discover();
        expect(host.querySelector("iframe")).not.toBeNull();
    });
});

describe("Region : adopt() sans conteneur connu", () => {
    it("enregistre le parent de l'iframe comme conteneur", () => {
        const {region, players} = createEnv({withHost: false});
        const parent = document.createElement("div");
        parent.id = "autre";
        document.body.append(parent);
        const iframe = document.createElement("iframe");
        parent.append(iframe);
        const a = video("A");
        const handler = listen(region);

        region.adopt(iframe, a);

        expect(region.hasContainer).toBe(true);
        expect(region.current).toBe(a);
        expect(players[0].iframe).toBe(iframe);
        expect(handler.mock.calls[0][0].reason).toBe("adopt");
    });
});

describe("Region : erreurs et nettoyage", () => {
    it("une action différée qui échoue est signalée et n'empêche pas les suivantes", () => {
        const {region, provider, players, discover} = createEnv({withHost: false});
        const erreur = new Error("création impossible");
        provider.createPlayer.mockImplementationOnce(() => {
            throw erreur;
        });
        region.add(video("A"));
        region.add(video("B"));
        const onError = listen(region, "error");

        region.navigate("A");
        region.navigate("B");
        discover();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toMatchObject({error: erreur, info: region.get("A")});
        expect(region.current.key).toBe("B");
        expect(players).toHaveLength(1);
    });

    it("dispose() abandonne les actions en attente", () => {
        const {region, provider, panel, discover} = createEnv({withHost: false});
        region.add(video("A"));
        region.navigate("A");
        region.dispose();

        expect(region.hasPending()).toBe(false);
        expect(panel.destroy).toHaveBeenCalled();
        discover();
        expect(provider.createPlayer).not.toHaveBeenCalled();
    });
});
