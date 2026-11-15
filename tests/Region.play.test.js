import {describe, expect, it, vi} from "vitest";

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

const makeInfo = (key, {isPlaylist = false, videoIds} = {}) =>
    ({key, provider: "yt", isPlaylist, videoIds, videos: []});
const video = (key) => makeInfo(key);
const playlist = (key, nb = 5) =>
    makeInfo(key, {isPlaylist: true, videoIds: Array.from({length: nb}, (_, i) => `v${i}`)});

function makePlayer() {
    return {
        kind: "yt",
        iframe: document.createElement("iframe"),
        load: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        next: vi.fn(),
        previous: vi.fn(),
        playAt: vi.fn(),
        dispose: vi.fn(),
        subscribe: vi.fn(() => vi.fn())
    };
}

function createEnv({withHost = true, ...options} = {}) {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.id = "zone";
    if (withHost) document.body.append(host);

    const players = [];
    const provider = {
        id: "yt",
        createPlayer: vi.fn(() => {
            const player = makePlayer();
            players.push(player);
            return player;
        })
    };
    const panel = {render: vi.fn(), clear: vi.fn(), setCurrent: vi.fn(), destroy: vi.fn()};
    const region = new Region({
        target: "zone",
        registry: {get: vi.fn(() => provider)},
        panelRenderer: panel,
        currentBehavior: "play",
        ...options
    });

    return {
        region,
        host,
        provider,
        players,
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

describe("Region : currentBehavior « play »", () => {
    describe("navigation vers l'info déjà affichée", () => {
        it("lance la lecture du lecteur existant", () => {
            const {region, lastPlayer} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            region.navigate("A");

            expect(lastPlayer().play).toHaveBeenCalledTimes(1);
        });

        it("relance la lecture à chaque clic", () => {
            const {region, lastPlayer} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            region.navigate("A");
            region.navigate("A");

            expect(lastPlayer().play).toHaveBeenCalledTimes(2);
        });

        it("ne recrée pas le lecteur ni l'iframe", () => {
            const {region, provider, lastPlayer, host} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            const iframe = lastPlayer().iframe;
            region.navigate("A");

            expect(provider.createPlayer).toHaveBeenCalledTimes(1);
            expect(lastPlayer().dispose).not.toHaveBeenCalled();
            expect(lastPlayer().load).toHaveBeenCalledTimes(1);
            expect(host.contains(iframe)).toBe(true);
        });

        it("n'ajoute pas d'entrée au journal", () => {
            const {region} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            region.navigate("A");

            expect(region.canGoBack).toBe(false);
        });

        it("n'émet ni « change » ni hook quand le conteneur est déjà visible", () => {
            const {region} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            const onChange = listen(region);
            const hook = vi.fn();
            region.afterNavigate(hook);
            region.navigate("A");

            expect(onChange).not.toHaveBeenCalled();
            expect(hook).not.toHaveBeenCalled();
        });

        it("ne met pas le lecteur en pause (contrairement au mode « toggle »)", () => {
            const {region, lastPlayer} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            region.navigate("A");

            expect(lastPlayer().pause).not.toHaveBeenCalled();
        });
    });

    describe("conteneur masqué", () => {
        it("le réaffiche puis lance la lecture", () => {
            const {region, host, lastPlayer} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            region.hide();
            region.navigate("A");

            expect(host.hidden).toBe(false);
            expect(lastPlayer().play).toHaveBeenCalledTimes(1);
        });

        it("émet « change » avec la raison « visibility »", () => {
            const {region} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            region.hide();
            const handler = listen(region);
            region.navigate("A");

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0]).toMatchObject({reason: "visibility", visible: true});
        });

        it("ne recrée pas le lecteur pour autant", () => {
            const {region, provider} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            region.hide();
            region.navigate("A");

            expect(provider.createPlayer).toHaveBeenCalledTimes(1);
        });
    });

    describe("autre info", () => {
        it("navigue normalement : nouvelle entrée de journal et chargement", () => {
            const {region, lastPlayer} = createEnv();
            region.add(video("A"));
            region.add(video("B"));
            region.navigate("A");
            region.navigate("B");

            expect(region.current.key).toBe("B");
            expect(region.canGoBack).toBe(true);
            expect(lastPlayer().load).toHaveBeenCalledWith(region.get("B"), {autoplay: false, index: 0});
            expect(lastPlayer().play).not.toHaveBeenCalled();
        });
    });

    describe("playlist", () => {
        it("ne change pas l'item courant", () => {
            const {region, lastPlayer} = createEnv();
            region.add(playlist("P"));
            region.navigate("P", {index: 3});
            region.navigate("P", {index: 0});

            expect(region.currentIndex).toBe(3);
            expect(lastPlayer().playAt).not.toHaveBeenCalled();
            expect(lastPlayer().play).toHaveBeenCalledTimes(1);
        });
    });

    describe("rien n'est dessiné pour cette info", () => {
        it("redessine l'info en lecture automatique (conteneur remplacé)", () => {
            const {region, provider, players} = createEnv();
            const a = video("A");
            region.add(a);
            region.navigate("A");

            const autre = document.createElement("div");
            document.body.append(autre);
            region.register(autre); // l'ancien contenu est réinitialisé
            const handler = listen(region);
            region.navigate("A");

            expect(players[0].dispose).toHaveBeenCalled();
            expect(provider.createPlayer).toHaveBeenCalledTimes(2);
            expect(players[1].load).toHaveBeenCalledWith(a, {autoplay: true, index: 0});
            expect(handler.mock.calls[0][0].reason).toBe("restore");
        });
    });

    describe("sans conteneur : différé", () => {
        it("charge l'info puis lance la lecture à la découverte du conteneur", () => {
            const {region, provider, lastPlayer, discover} = createEnv({withHost: false});
            region.add(video("A"));
            region.navigate("A");
            region.navigate("A");

            expect(provider.createPlayer).not.toHaveBeenCalled();
            discover();

            expect(provider.createPlayer).toHaveBeenCalledTimes(1);
            expect(lastPlayer().play).toHaveBeenCalledTimes(1);
            expect(region.canGoBack).toBe(false);
        });
    });

    describe("erreurs et cas limites", () => {
        it("tolère un lecteur sans méthode play()", () => {
            const {region, lastPlayer} = createEnv();
            region.add(video("A"));
            region.navigate("A");
            delete lastPlayer().play;

            expect(() => region.navigate("A")).not.toThrow();
        });

        it("signale l'erreur d'un lecteur dont play() échoue, sans la propager", () => {
            const {region, lastPlayer} = createEnv();
            const erreur = new Error("lecture impossible");
            region.add(video("A"));
            region.navigate("A");
            lastPlayer().play.mockImplementation(() => {
                throw erreur;
            });
            const onError = listen(region, "error");

            expect(() => region.navigate("A")).not.toThrow();
            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError.mock.calls[0][0]).toMatchObject({error: erreur, info: region.get("A")});
        });
    });

    describe("les autres comportements ne changent pas", () => {
        it("« toggle » (défaut) masque la vidéo au lieu de la relancer", () => {
            const {region, host, lastPlayer} = createEnv({currentBehavior: "toggle"});
            region.add(video("A"));
            region.navigate("A");
            region.navigate("A");

            expect(host.hidden).toBe(true);
            expect(lastPlayer().play).not.toHaveBeenCalled();
        });

        it("« skip » ne fait rien", () => {
            const {region, host, lastPlayer} = createEnv({currentBehavior: "skip"});
            region.add(video("A"));
            region.navigate("A");
            region.navigate("A");

            expect(host.hidden).toBe(false);
            expect(lastPlayer().play).not.toHaveBeenCalled();
        });
    });
});
