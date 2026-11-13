// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {YouTubePlayer} from "../../../src/providers/youtube/YouTubePlayer.js";
import {YouTubeBridgeEvent} from "../../../src/providers/youtube/YouTubeIframeBridge.js";
import {VideoInfo} from "../../../src/models/VideoInfo.js";
import {VideoListInfo} from "../../../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../../../src/models/PlaylistInfo.js";

// ───────── Faux bridge : on ne teste pas la communication avec l'iframe ici ─────────
const bridges = vi.hoisted(() => []);

vi.mock("../../../src/providers/youtube/YouTubeIframeBridge.js", () => {
    const YouTubeBridgeEvent = {
        PlaylistIndexChange: "playlistIndexChange",
        VideoEnded: "videoEnded",
        VideoPlay: "videoPlay",
        VideoPause: "videoPause",
        Error: "error"
    };

    class YouTubeIframeBridge {
        constructor(iframe) {
            this.iframe = iframe;
            this.handler = null;
            this.options = null;
            this.command = vi.fn();
            this.resetState = vi.fn();
            this.connect = vi.fn();
            this.disconnect = vi.fn();
            this.subscribe = vi.fn((fn, options) => {
                this.handler = fn;
                this.options = options;
                return () => {
                };
            });
            bridges.push(this);
        }
    }

    return {YouTubeBridgeEvent, YouTubeIframeBridge};
});

// ───────── Helpers ─────────
const lastBridge = () => bridges.at(-1);

const iframeWith = (src) => {
    const iframe = document.createElement("iframe");
    if (src) iframe.src = src;
    return iframe;
};

const video = (videoId = "vid1", extra = {}) =>
    new VideoInfo({provider: "youtube", target: "zone", videoId, ...extra});

const list = (videoIds = ["vid1", "vid2", "vid3"]) =>
    new VideoListInfo({provider: "youtube", target: "zone", videoIds});

const playlist = ({playlistId = "PL1", videoId, videoIds = []} = {}) => {
    const p = new PlaylistInfo({provider: "youtube", target: "zone", playlistId, videoId});
    videoIds.forEach((id) => p.addVideo(video(id)));
    return p;
};

function makePlayer({origin = "https://site.test", iframe = null} = {}) {
    const builder = {
        origin,
        buildVideoSrc: vi.fn((id) => `src:video:${id}`),
        buildVideoListSrc: vi.fn((ids) => `src:list:${ids.join(",")}`),
        buildPlaylistSrc: vi.fn((id) => `src:playlist:${id}`)
    };
    const createIframe = vi.fn((src) => {
        const el = document.createElement("iframe");
        el.dataset.created = src;
        return el;
    });
    const player = new YouTubePlayer({builder, createIframe, iframe});
    return {player, builder, createIframe};
}

beforeEach(() => {
    bridges.length = 0;
    document.body.innerHTML = "";
});

describe("YouTubePlayer", () => {
    describe("construction", () => {
        it("expose le type 'youtube' et n'a pas d'iframe tant que rien n'est chargé", () => {
            const {player} = makePlayer();
            expect(player.kind).toBe("youtube");
            expect(player.iframe).toBeNull();
            expect(bridges).toHaveLength(0);
        });

        it("adopte une iframe existante et connecte le bridge sans la créer", () => {
            const iframe = iframeWith("https://www.youtube.com/embed/vid1?enablejsapi=1&origin=https%3A%2F%2Fsite.test");
            const {player, createIframe} = makePlayer({iframe});

            expect(player.iframe).toBe(iframe);
            expect(createIframe).not.toHaveBeenCalled();
            expect(lastBridge().connect).toHaveBeenCalledTimes(1);
        });

        it("s'abonne uniquement aux événements utiles du bridge", () => {
            makePlayer({iframe: iframeWith("https://www.youtube.com/embed/vid1?enablejsapi=1")});
            expect(lastBridge().options.types).toEqual(expect.arrayContaining([
                YouTubeBridgeEvent.PlaylistIndexChange,
                YouTubeBridgeEvent.VideoEnded,
                YouTubeBridgeEvent.VideoPlay,
                YouTubeBridgeEvent.VideoPause,
                YouTubeBridgeEvent.Error
            ]));
        });
    });

    describe("adoption d'une iframe (enablejsapi / origin)", () => {
        it("ajoute enablejsapi=1 et origin quand ils manquent", () => {
            const iframe = iframeWith("https://www.youtube.com/embed/vid1");
            makePlayer({iframe});

            const url = new URL(iframe.src);
            expect(url.searchParams.get("enablejsapi")).toBe("1");
            expect(url.searchParams.get("origin")).toBe("https://site.test");
        });

        it("ne touche pas au src quand il est déjà conforme", () => {
            const src = "https://www.youtube.com/embed/vid1?enablejsapi=1&origin=https%3A%2F%2Fsite.test";
            const iframe = iframeWith(src);
            makePlayer({iframe});
            expect(iframe.src).toBe(src);
        });

        it("corrige un origin différent", () => {
            const iframe = iframeWith("https://www.youtube.com/embed/vid1?enablejsapi=1&origin=https%3A%2F%2Fautre.test");
            makePlayer({iframe});
            expect(new URL(iframe.src).searchParams.get("origin")).toBe("https://site.test");
        });

        it("n'ajoute pas origin quand le builder n'en a pas (page file://)", () => {
            const iframe = iframeWith("https://www.youtube.com/embed/vid1");
            makePlayer({iframe, origin: null});

            const url = new URL(iframe.src);
            expect(url.searchParams.get("enablejsapi")).toBe("1");
            expect(url.searchParams.has("origin")).toBe(false);
        });

        it("laisse un src invalide tel quel, sans lever d'erreur", () => {
            const iframe = iframeWith(null); // src vide : new URL("") lève
            expect(() => makePlayer({iframe})).not.toThrow();
            expect(iframe.getAttribute("src")).toBeNull();
        });
    });

    describe("load() : première iframe", () => {
        it("crée l'iframe avec le src du builder (vidéo seule)", () => {
            const {player, builder, createIframe} = makePlayer();
            const info = video("vid1", {startSeconds: 30});

            player.load(info, {autoplay: true});

            expect(builder.buildVideoSrc).toHaveBeenCalledWith("vid1", {autoplay: true, startSeconds: 30});
            expect(createIframe).toHaveBeenCalledWith("src:video:vid1");
            expect(player.iframe.dataset.created).toBe("src:video:vid1");
            expect(lastBridge().connect).toHaveBeenCalled();
        });

        it("crée l'iframe pour une liste de vidéos, sans commande à l'index 0", () => {
            const {player, builder} = makePlayer();
            const info = list(["a", "b"]);

            player.load(info);

            expect(builder.buildVideoListSrc).toHaveBeenCalledWith(["a", "b"], {autoplay: false, index: 0});
            expect(lastBridge().command).not.toHaveBeenCalled();
        });

        it("crée l'iframe pour une playlist", () => {
            const {player, builder} = makePlayer();
            player.load(playlist({playlistId: "PL9", videoId: "vid2"}));

            expect(builder.buildPlaylistSrc).toHaveBeenCalledWith("PL9", {autoplay: false, videoId: "vid2"});
            expect(lastBridge().command).not.toHaveBeenCalled();
        });

        it("liste de vidéos avec index > 0 : envoie cuePlaylist (sans autoplay)", () => {
            const {player} = makePlayer();
            player.load(list(["a", "b", "c"]), {index: 2});
            expect(lastBridge().command).toHaveBeenCalledWith("cuePlaylist", [["a", "b", "c"], 2, 0]);
        });

        it("liste de vidéos avec index > 0 et autoplay : envoie loadPlaylist", () => {
            const {player} = makePlayer();
            player.load(list(["a", "b", "c"]), {index: 1, autoplay: true});
            expect(lastBridge().command).toHaveBeenCalledWith("loadPlaylist", [["a", "b", "c"], 1, 0]);
        });

        it("playlist avec index > 0 : envoie la forme objet de loadPlaylist", () => {
            const {player} = makePlayer();
            player.load(playlist({playlistId: "PL1"}), {index: 3, autoplay: true});
            expect(lastBridge().command).toHaveBeenCalledWith("loadPlaylist", [{
                list: "PL1",
                listType: "playlist",
                index: 3,
                startSeconds: 0
            }]);
        });

        it("lève une erreur pour un type d'info inconnu", () => {
            const {player} = makePlayer();
            expect(() => player.load({})).toThrow(/Invalid operation/);
        });
    });

    describe("load() : iframe déjà existante", () => {
        let player;
        let bridge;

        beforeEach(() => {
            ({player} = makePlayer());
            player.load(video("first"));
            bridge = lastBridge();
            bridge.command.mockClear();
        });

        it("ne crée pas d'autre iframe : elle est pilotée par commandes", () => {
            const iframe = player.iframe;
            player.load(video("second"));
            expect(player.iframe).toBe(iframe);
            expect(bridges).toHaveLength(1);
        });

        it("réinitialise l'état du bridge avant chaque chargement", () => {
            player.load(video("second"));
            expect(bridge.resetState).toHaveBeenCalledTimes(1);
        });

        it("vidéo : cueVideoById par défaut, avec startSeconds à 0", () => {
            player.load(video("second"));
            expect(bridge.command).toHaveBeenCalledWith("cueVideoById", ["second", 0]);
        });

        it("vidéo avec autoplay et startSeconds : loadVideoById", () => {
            player.load(video("second", {startSeconds: 45}), {autoplay: true});
            expect(bridge.command).toHaveBeenCalledWith("loadVideoById", ["second", 45]);
        });

        it("liste de vidéos : cuePlaylist / loadPlaylist avec l'index", () => {
            player.load(list(["a", "b"]), {index: 1});
            expect(bridge.command).toHaveBeenLastCalledWith("cuePlaylist", [["a", "b"], 1, 0]);

            player.load(list(["a", "b"]), {index: 1, autoplay: true});
            expect(bridge.command).toHaveBeenLastCalledWith("loadPlaylist", [["a", "b"], 1, 0]);
        });

        it("playlist : utilise l'index donné", () => {
            player.load(playlist({playlistId: "PL1"}), {index: 4});
            expect(bridge.command).toHaveBeenLastCalledWith("cuePlaylist", [{
                list: "PL1", listType: "playlist", index: 4, startSeconds: 0
            }]);
        });

        it("playlist sans index : démarre sur la vidéo de départ trouvée dans data-videos", () => {
            const info = playlist({playlistId: "PL1", videoId: "b", videoIds: ["a", "b", "c"]});
            player.load(info, {autoplay: true});
            expect(bridge.command).toHaveBeenLastCalledWith("loadPlaylist", [{
                list: "PL1", listType: "playlist", index: 1, startSeconds: 0
            }]);
        });

        it("playlist dont la vidéo de départ est inconnue : index 0", () => {
            const info = playlist({playlistId: "PL1", videoId: "zzz", videoIds: ["a", "b"]});
            player.load(info);
            expect(bridge.command.mock.lastCall[1][0].index).toBe(0);
        });

        it("type d'info inconnu : lève une erreur", () => {
            expect(() => player.load({})).toThrow(/Invalid operation/);
        });
    });

    describe("commandes de lecture", () => {
        it("ne fait rien (et ne lève pas) tant qu'aucun bridge n'existe", () => {
            const {player} = makePlayer();
            expect(() => {
                player.play();
                player.pause();
                player.next();
                player.previous();
                player.playAt(2);
                player.selectItem(list(), 1);
            }).not.toThrow();
        });

        it("traduit chaque méthode en commande YouTube", () => {
            const {player} = makePlayer();
            player.load(video());
            const bridge = lastBridge();
            bridge.command.mockClear();

            player.play();
            player.pause();
            player.next();
            player.previous();
            player.playAt(3);

            expect(bridge.command.mock.calls).toEqual([
                ["playVideo"],
                ["pauseVideo"],
                ["nextVideo"],
                ["previousVideo"],
                ["playVideoAt", [3]]
            ]);
        });
    });

    describe("selectItem()", () => {
        let player;
        let bridge;

        beforeEach(() => {
            ({player} = makePlayer());
            player.load(video());
            bridge = lastBridge();
            bridge.command.mockClear();
        });

        it("avec autoplay (défaut) : playVideoAt", () => {
            player.selectItem(list(), 2);
            expect(bridge.command).toHaveBeenCalledWith("playVideoAt", [2]);
        });

        it("sans autoplay, liste de vidéos : cuePlaylist", () => {
            player.selectItem(list(["a", "b", "c"]), 2, {autoplay: false});
            expect(bridge.command).toHaveBeenCalledWith("cuePlaylist", [["a", "b", "c"], 2, 0]);
        });

        it("sans autoplay, playlist : cuePlaylist en forme objet", () => {
            player.selectItem(playlist({playlistId: "PL1"}), 5, {autoplay: false});
            expect(bridge.command).toHaveBeenCalledWith("cuePlaylist", [{
                list: "PL1", listType: "playlist", index: 5, startSeconds: 0
            }]);
        });

        it("sans autoplay et info d'un autre type : aucune commande", () => {
            player.selectItem(video(), 1, {autoplay: false});
            expect(bridge.command).not.toHaveBeenCalled();
        });
    });

    describe("événements", () => {
        let player;
        let bridge;
        let onEvent;

        beforeEach(() => {
            ({player} = makePlayer());
            player.load(video());
            bridge = lastBridge();
            onEvent = vi.fn();
            player.subscribe(onEvent);
        });

        it("playlistIndexChange → itemChange", () => {
            bridge.handler({type: YouTubeBridgeEvent.PlaylistIndexChange, index: 2});
            expect(onEvent).toHaveBeenCalledWith({type: "itemChange", index: 2});
        });

        it("videoPlay → state playing", () => {
            bridge.handler({type: YouTubeBridgeEvent.VideoPlay});
            expect(onEvent).toHaveBeenCalledWith({type: "state", state: "playing"});
        });

        it("videoPause → state paused", () => {
            bridge.handler({type: YouTubeBridgeEvent.VideoPause});
            expect(onEvent).toHaveBeenCalledWith({type: "state", state: "paused"});
        });

        it("videoEnded → state ended", () => {
            bridge.handler({type: YouTubeBridgeEvent.VideoEnded, index: 1});
            expect(onEvent).toHaveBeenCalledWith({type: "state", state: "ended", index: 1});
        });

        it("error → Error avec le code YouTube", () => {
            bridge.handler({type: YouTubeBridgeEvent.Error, code: 150});
            const event = onEvent.mock.lastCall[0];
            expect(event.type).toBe("error");
            expect(event.error).toBeInstanceOf(Error);
            expect(event.error.message).toBe("YouTube player error 150");
        });

        it("ignore un événement inconnu", () => {
            bridge.handler({type: "autre"});
            expect(onEvent).not.toHaveBeenCalled();
        });

        it("prévient tous les abonnés", () => {
            const second = vi.fn();
            player.subscribe(second);
            bridge.handler({type: YouTubeBridgeEvent.VideoPlay});
            expect(onEvent).toHaveBeenCalledTimes(1);
            expect(second).toHaveBeenCalledTimes(1);
        });

        it("subscribe() renvoie une fonction de désabonnement", () => {
            const unsubscribe = player.subscribe(vi.fn());
            const other = vi.fn();
            const stop = player.subscribe(other);
            stop();
            bridge.handler({type: YouTubeBridgeEvent.VideoPlay});
            expect(other).not.toHaveBeenCalled();
            expect(typeof unsubscribe).toBe("function");
        });

        it("un abonné qui se désabonne pendant l'émission ne casse pas la boucle", () => {
            const second = vi.fn();
            const stop = player.subscribe(() => stop());
            player.subscribe(second);
            expect(() => bridge.handler({type: YouTubeBridgeEvent.VideoPlay})).not.toThrow();
            expect(second).toHaveBeenCalled();
        });

        it("ignore les événements émis pendant un chargement", () => {
            // le bridge notifierait de façon synchrone pendant la commande de chargement
            bridge.command.mockImplementation(() => bridge.handler({type: YouTubeBridgeEvent.VideoPlay}));
            player.load(video("second"), {autoplay: true});
            expect(onEvent).not.toHaveBeenCalled();
        });

        it("reprend les événements après un chargement terminé", () => {
            player.load(video("second"));
            bridge.handler({type: YouTubeBridgeEvent.VideoPlay});
            expect(onEvent).toHaveBeenCalledTimes(1);
        });

        it("reprend les événements même quand le chargement a échoué", () => {
            expect(() => player.load({})).toThrow();
            bridge.handler({type: YouTubeBridgeEvent.VideoPlay});
            expect(onEvent).toHaveBeenCalledTimes(1);
        });
    });

    describe("dispose()", () => {
        it("déconnecte le bridge et vide les abonnés", () => {
            const {player} = makePlayer();
            player.load(video());
            const bridge = lastBridge();
            const onEvent = vi.fn();
            player.subscribe(onEvent);

            player.dispose();

            expect(bridge.disconnect).toHaveBeenCalledTimes(1);
            expect(player.iframe).toBeNull();
            expect(() => player.play()).not.toThrow();
        });

        it("retire du DOM l'iframe qu'il a créée", () => {
            const {player} = makePlayer();
            player.load(video());
            document.body.append(player.iframe);
            const iframe = player.iframe;

            player.dispose();

            expect(iframe.isConnected).toBe(false);
        });

        it("laisse en place une iframe adoptée", () => {
            const iframe = iframeWith("https://www.youtube.com/embed/vid1?enablejsapi=1&origin=https%3A%2F%2Fsite.test");
            document.body.append(iframe);
            const {player} = makePlayer({iframe});

            player.dispose();

            expect(iframe.isConnected).toBe(true);
        });

        it("peut être appelé sans rien avoir chargé", () => {
            const {player} = makePlayer();
            expect(() => player.dispose()).not.toThrow();
        });
    });
});
