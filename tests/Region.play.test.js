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
    const player = {
        kind: "yt",
        iframe: document.createElement("iframe"),
        load: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        next: vi.fn(),
        previous: vi.fn(),
        playAt: vi.fn(),
        dispose: vi.fn(),
        listener: null,
        subscribe: vi.fn((cb) => {
            player.listener = cb;
            return vi.fn();
        }),
        /** Le lecteur annonce son état, comme YouTubePlayer et OkruPlayer le font. */
        emit: (state) => player.listener({type: "state", state})
    };
    return player;
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
        currentBehavior: "playPause",
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

/** Une info affichée, dont le lecteur annonce l'état donné (null : aucun état connu). */
function shown(state = null, options = {}) {
    const env = createEnv(options);
    env.region.add(video("A"));
    env.region.navigate("A");
    if (state) env.lastPlayer().emit(state);
    return env;
}

// ───────── tests ─────────

describe("Region : currentBehavior « playPause »", () => {
    describe("selon l'état du lecteur", () => {
        it("met en pause quand la vidéo joue", () => {
            const {region, lastPlayer} = shown("playing");
            region.navigate("A");

            expect(lastPlayer().pause).toHaveBeenCalledTimes(1);
            expect(lastPlayer().play).not.toHaveBeenCalled();
        });

        it("lance la lecture quand la vidéo est en pause", () => {
            const {region, lastPlayer} = shown("paused");
            region.navigate("A");

            expect(lastPlayer().play).toHaveBeenCalledTimes(1);
            expect(lastPlayer().pause).not.toHaveBeenCalled();
        });

        it("lance la lecture quand la vidéo est terminée", () => {
            const {region, lastPlayer} = shown("ended");
            region.navigate("A");

            expect(lastPlayer().play).toHaveBeenCalledTimes(1);
        });

        it("lance la lecture quand l'état est encore inconnu (vidéo affichée à l'arrêt)", () => {
            const {region, lastPlayer} = shown();
            region.navigate("A");

            expect(lastPlayer().play).toHaveBeenCalledTimes(1);
            expect(lastPlayer().pause).not.toHaveBeenCalled();
        });
    });

    describe("clics successifs", () => {
        it("alterne lecture et pause sans attendre la confirmation du lecteur", () => {
            const {region, lastPlayer} = shown();
            region.navigate("A"); // lecture
            region.navigate("A"); // pause
            region.navigate("A"); // lecture

            expect(lastPlayer().play).toHaveBeenCalledTimes(2);
            expect(lastPlayer().pause).toHaveBeenCalledTimes(1);
        });

        it("se recale sur l'état réel quand le lecteur le corrige (pause faite avec les contrôles YouTube)", () => {
            const {region, lastPlayer} = shown();
            region.navigate("A");        // lecture demandée : l'état supposé est « playing »
            lastPlayer().emit("paused"); // l'utilisateur met en pause depuis le lecteur
            region.navigate("A");

            expect(lastPlayer().play).toHaveBeenCalledTimes(2);
            expect(lastPlayer().pause).not.toHaveBeenCalled();
        });

        it("oublie l'état quand le lecteur est recréé pour une autre info", () => {
            const {region, players} = shown("playing");
            region.add(video("B"));
            region.navigate("B");
            region.navigate("B"); // le nouveau lecteur n'a encore rien annoncé : lecture, pas pause

            expect(players[1].play).toHaveBeenCalledTimes(1);
            expect(players[1].pause).not.toHaveBeenCalled();
        });
    });

    describe("ce qui ne change pas", () => {
        it("ne recrée ni le lecteur ni l'iframe, et n'ajoute pas d'entrée de journal", () => {
            const {region, provider, lastPlayer} = shown("playing");
            region.navigate("A");
            region.navigate("A");

            expect(provider.createPlayer).toHaveBeenCalledTimes(1);
            expect(lastPlayer().load).toHaveBeenCalledTimes(1);
            expect(lastPlayer().dispose).not.toHaveBeenCalled();
            expect(region.canGoBack).toBe(false);
        });

        it("n'émet ni « change » ni hook quand le conteneur est visible", () => {
            const {region} = shown("playing");
            const onChange = listen(region);
            const hook = vi.fn();
            region.afterNavigate(hook);
            region.navigate("A");

            expect(onChange).not.toHaveBeenCalled();
            expect(hook).not.toHaveBeenCalled();
        });

        it("ne change pas l'item courant d'une playlist", () => {
            const {region, lastPlayer} = createEnv();
            region.add(playlist("P"));
            region.navigate("P", {index: 3});
            region.navigate("P", {index: 0});

            expect(region.currentIndex).toBe(3);
            expect(lastPlayer().playAt).not.toHaveBeenCalled();
            expect(lastPlayer().play).toHaveBeenCalledTimes(1);
        });
    });

    describe("conteneur masqué", () => {
        it("le réaffiche et lance la lecture, même si le dernier état connu est « playing »", () => {
            const {region, host, lastPlayer} = shown("playing");
            region.hide();
            region.navigate("A");

            expect(host.hidden).toBe(false);
            expect(lastPlayer().play).toHaveBeenCalledTimes(1);
            expect(lastPlayer().pause).toHaveBeenCalledTimes(1); // celui de hide(), pas un second
        });

        it("émet « change » avec la raison « visibility »", () => {
            const {region} = shown("playing");
            region.hide();
            const handler = listen(region);
            region.navigate("A");

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0]).toMatchObject({reason: "visibility", visible: true});
        });
    });

    describe("rien n'est dessiné pour cette info", () => {
        it("redessine l'info en lecture automatique (conteneur remplacé)", () => {
            const {region, provider, players} = shown("playing");
            const autre = document.createElement("div");
            document.body.append(autre);
            region.register(autre);
            const handler = listen(region);
            region.navigate("A");

            expect(provider.createPlayer).toHaveBeenCalledTimes(2);
            expect(players[1].load).toHaveBeenCalledWith(region.get("A"), {autoplay: true, index: 0});
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
        it("tolère un lecteur sans play() ni pause()", () => {
            const {region, lastPlayer} = shown();
            delete lastPlayer().play;
            delete lastPlayer().pause;

            expect(() => {
                region.navigate("A");
                region.navigate("A");
            }).not.toThrow();
        });

        it("signale l'erreur d'un lecteur dont pause() échoue, sans la propager", () => {
            const {region, lastPlayer} = shown("playing");
            const erreur = new Error("pause impossible");
            lastPlayer().pause.mockImplementation(() => {
                throw erreur;
            });
            const onError = listen(region, "error");

            expect(() => region.navigate("A")).not.toThrow();
            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError.mock.calls[0][0]).toMatchObject({error: erreur, info: region.get("A")});
        });
    });

    describe("les autres comportements ne changent pas", () => {
        it("« toggle » masque la vidéo au lieu de la mettre en pause ou en lecture", () => {
            const {region, host, lastPlayer} = shown("playing", {currentBehavior: "toggle"});
            region.navigate("A");

            expect(host.hidden).toBe(true);
            expect(lastPlayer().play).not.toHaveBeenCalled();
        });

        it("« skip » ne fait rien", () => {
            const {region, host, lastPlayer} = shown("playing", {currentBehavior: "skip"});
            region.navigate("A");

            expect(host.hidden).toBe(false);
            expect(lastPlayer().pause).not.toHaveBeenCalled();
            expect(lastPlayer().play).not.toHaveBeenCalled();
        });
    });
});