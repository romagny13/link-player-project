import {beforeEach, describe, expect, it, vi} from "vitest";

import {YouTubePlayer} from "../../../src/providers/youtube/YouTubePlayer.js";
import {VideoInfo} from "../../../src/models/VideoInfo.js";
import {VideoListInfo} from "../../../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../../../src/models/PlaylistInfo.js";

/* -------------------------------------------------------------------------- */
/* Faux YouTubeIframeBridge                                                    */
/* -------------------------------------------------------------------------- */

const h = vi.hoisted(() => {
    const instances = [];

    class FakeBridge {
        constructor(iframe) {
            this.iframe = iframe;
            this.handler = null;
            this.options = null;
            this.command = vi.fn();
            this.connect = vi.fn();
            this.disconnect = vi.fn();
            this.resetState = vi.fn();
            instances.push(this);
        }

        subscribe(handler, options) {
            this.handler = handler;
            this.options = options;
        }

        emit(event) {
            this.handler(event);
        }
    }

    const Event = {
        PlaylistIndexChange: "playlist_index",
        VideoEnded: "video_ended",
        VideoPlay: "video_play",
        VideoPause: "video_pause",
        Error: "error"
    };
    return {instances, FakeBridge, Event};
});

vi.mock("../../../src/providers/youtube/YouTubeIframeBridge.js", () => ({
    YouTubeIframeBridge: h.FakeBridge,
    YouTubeBridgeEvent: h.Event
}));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const fakeIframe = (src = "") => ({src, remove: vi.fn()});

const makeBuilder = (origin) => ({
    origin,
    buildVideoSrc: vi.fn((id) => `video-src:${id}`),
    buildVideoListSrc: vi.fn((ids) => `list-src:${ids.join(",")}`),
    buildPlaylistSrc: vi.fn((id) => `playlist-src:${id}`)
});

const video = (videoId, startSeconds) =>
    new VideoInfo({provider: "youtube", target: "player", videoId, startSeconds});
const videoList = (ids) => new VideoListInfo("youtube", "player", ids, 0, false);
/** playlist avec vidéos de secours (data-videos) */
const playlist = (playlistId, videoId = null, fallbackIds = []) => {
    const p = new PlaylistInfo("youtube", "player", playlistId, videoId, false);
    fallbackIds.forEach((id) => p.addVideo(video(id)));
    return p;
};

const lastBridge = () => h.instances.at(-1);

/** Player créé via createIframe, avec collecte des évènements. */
const setup = ({origin, ...ctorOptions} = {}) => {
    const builder = makeBuilder(origin);
    const createIframe = vi.fn((src) => fakeIframe(src));
    const player = new YouTubePlayer({builder, createIframe, ...ctorOptions});
    const events = [];
    player.subscribe((e) => events.push(e));
    return {player, builder, createIframe, events};
};

/** Player déjà chargé (iframe + bridge existent), compteurs du bridge remis à zéro. */
const loaded = () => {
    const ctx = setup();
    ctx.player.load(video("first"));
    const bridge = lastBridge();
    bridge.command.mockClear();
    bridge.resetState.mockClear();
    return {...ctx, bridge};
};

beforeEach(() => {
    h.instances.length = 0;
});

/* -------------------------------------------------------------------------- */
/* YouTubePlayer                                                               */
/* -------------------------------------------------------------------------- */

describe("YouTubePlayer", () => {
    it("kind = youtube", () => {
        expect(setup().player.kind).toBe("youtube");
    });

    describe("premier load (création de l'iframe)", () => {
        it("vidéo : demande la src au builder, crée l'iframe, connecte le bridge, aucune commande", () => {
            const {player, builder, createIframe} = setup();
            player.load(video("abc", 30), {autoplay: true});

            expect(builder.buildVideoSrc).toHaveBeenCalledWith("abc", {autoplay: true, startSeconds: 30});
            expect(createIframe).toHaveBeenCalledWith("video-src:abc");
            expect(player.iframe.src).toBe("video-src:abc");
            expect(h.instances).toHaveLength(1);
            expect(lastBridge().iframe).toBe(player.iframe);
            expect(lastBridge().connect).toHaveBeenCalledTimes(1);
            expect(lastBridge().command).not.toHaveBeenCalled();
            expect(lastBridge().resetState).not.toHaveBeenCalled();
        });

        it("vidéo : autoplay=false par défaut, startSeconds undefined transmis tel quel", () => {
            const {player, builder} = setup();
            player.load(video("abc"));
            expect(builder.buildVideoSrc).toHaveBeenCalledWith("abc", {autoplay: false, startSeconds: undefined});
        });

        it("liste : ids + autoplay + index", () => {
            const {player, builder, createIframe} = setup();
            player.load(videoList(["a", "b", "c"]), {autoplay: true, index: 2});
            expect(builder.buildVideoListSrc).toHaveBeenCalledWith(["a", "b", "c"], {autoplay: true, index: 2});
            expect(createIframe).toHaveBeenCalledWith("list-src:a,b,c");
        });

        it("playlist : id + autoplay + videoId", () => {
            const {player, builder, createIframe} = setup();
            player.load(playlist("PL1", "abc"), {autoplay: true});
            expect(builder.buildPlaylistSrc).toHaveBeenCalledWith("PL1", {autoplay: true, videoId: "abc"});
            expect(createIframe).toHaveBeenCalledWith("playlist-src:PL1");
        });

        // Le player n'envoie pas `index` au builder pour une playlist au premier load,
        // alors qu'il l'utilise aux loads suivants (cf. "load suivant : playlist").
        it.todo("playlist : l'option index est transmise au builder au premier load");

        it("info invalide : lève et ne crée rien", () => {
            const {player, createIframe} = setup();
            expect(() => player.load({})).toThrow(/Invalid operation/);
            expect(createIframe).not.toHaveBeenCalled();
            expect(player.iframe).toBeNull();
        });

        it("sans createIframe ni iframe adoptée : lève", () => {
            const player = new YouTubePlayer({builder: makeBuilder()});
            expect(() => player.load(video("abc"))).toThrow();
        });
    });

    describe("load suivant (iframe existante, commandes API)", () => {
        it("ne recrée ni iframe ni bridge, et réinitialise l'état du bridge", () => {
            const {player, createIframe, bridge} = loaded();
            const iframe = player.iframe;
            player.load(video("second"));

            expect(createIframe).toHaveBeenCalledTimes(1);
            expect(h.instances).toHaveLength(1);
            expect(player.iframe).toBe(iframe);
            expect(bridge.resetState).toHaveBeenCalledTimes(1);
        });

        describe("vidéo", () => {
            it("autoplay -> loadVideoById, startSeconds 0 par défaut", () => {
                const {player, bridge} = loaded();
                player.load(video("abc"), {autoplay: true});
                expect(bridge.command).toHaveBeenCalledWith("loadVideoById", ["abc", 0]);
            });

            it("sans autoplay -> cueVideoById avec startSeconds", () => {
                const {player, bridge} = loaded();
                player.load(video("abc", 45));
                expect(bridge.command).toHaveBeenCalledWith("cueVideoById", ["abc", 45]);
            });
        });

        describe("liste de vidéos", () => {
            it("loadPlaylist avec tableau d'ids, index, 0", () => {
                const {player, bridge} = loaded();
                player.load(videoList(["a", "b"]), {autoplay: true, index: 1});
                expect(bridge.command).toHaveBeenCalledWith("loadPlaylist", [["a", "b"], 1, 0]);
            });

            it("cuePlaylist et index 0 par défaut", () => {
                const {player, bridge} = loaded();
                player.load(videoList(["a", "b"]));
                expect(bridge.command).toHaveBeenCalledWith("cuePlaylist", [["a", "b"], 0, 0]);
            });
        });

        describe("playlist", () => {
            const payload = (index) => [{list: "PL1", listType: "playlist", index, startSeconds: 0}];

            it("index explicite", () => {
                const {player, bridge} = loaded();
                player.load(playlist("PL1"), {autoplay: true, index: 2});
                expect(bridge.command).toHaveBeenCalledWith("loadPlaylist", payload(2));
            });

            it("sans autoplay -> cuePlaylist", () => {
                const {player, bridge} = loaded();
                player.load(playlist("PL1"), {index: 2});
                expect(bridge.command).toHaveBeenCalledWith("cuePlaylist", payload(2));
            });

            it("sans index : position de la vidéo de départ parmi les vidéos de secours", () => {
                const {player, bridge} = loaded();
                player.load(playlist("PL1", "b", ["a", "b", "c"]));
                expect(bridge.command).toHaveBeenCalledWith("cuePlaylist", payload(1));
            });

            it("vidéo de départ introuvable -> 0", () => {
                const {player, bridge} = loaded();
                player.load(playlist("PL1", "zzz", ["a", "b"]));
                expect(bridge.command).toHaveBeenCalledWith("cuePlaylist", payload(0));
            });

            it("sans vidéos de secours ni videoId -> 0", () => {
                const {player, bridge} = loaded();
                player.load(playlist("PL1"));
                expect(bridge.command).toHaveBeenCalledWith("cuePlaylist", payload(0));
            });

            it("index explicite 0 ne l'emporte PAS sur la vidéo de départ (|| et non ??)", () => {
                const {player, bridge} = loaded();
                player.load(playlist("PL1", "b", ["a", "b"]), {index: 0});
                expect(bridge.command).toHaveBeenCalledWith("cuePlaylist", payload(1));
            });
        });

        it("info invalide : lève", () => {
            const {player} = loaded();
            expect(() => player.load(null)).toThrow(/Invalid operation/);
            expect(() => player.load({videoId: "x"})).toThrow(/Invalid operation/);
        });
    });

    describe("commandes de lecture", () => {
        it("envoient la bonne commande au bridge", () => {
            const {player, bridge} = loaded();
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

        it("sans bridge : ne plantent pas", () => {
            const {player} = setup();
            expect(() => {
                player.play();
                player.pause();
                player.next();
                player.previous();
                player.playAt(0);
            }).not.toThrow();
        });
    });

    describe("évènements du bridge", () => {
        it("souscrit aux 5 types d'évènements", () => {
            const {player} = setup();
            player.load(video("a"));
            expect(lastBridge().options.types).toEqual([
                h.Event.PlaylistIndexChange,
                h.Event.VideoEnded,
                h.Event.VideoPlay,
                h.Event.VideoPause,
                h.Event.Error
            ]);
        });

        it("PlaylistIndexChange -> itemChange", () => {
            const {player, events} = setup();
            player.load(video("a"));
            lastBridge().emit({type: h.Event.PlaylistIndexChange, index: 4});
            expect(events).toEqual([{type: "itemChange", index: 4}]);
        });

        it("play / pause -> state (sans index)", () => {
            const {player, events} = setup();
            player.load(video("a"));
            lastBridge().emit({type: h.Event.VideoPlay});
            lastBridge().emit({type: h.Event.VideoPause});
            expect(events).toEqual([
                {type: "state", state: "playing"},
                {type: "state", state: "paused"}
            ]);
        });

        it("ended -> state ended avec l'index du bridge", () => {
            const {player, events} = setup();
            player.load(video("a"));
            lastBridge().emit({type: h.Event.VideoEnded, index: 2});
            expect(events).toEqual([{type: "state", state: "ended", index: 2}]);
        });

        it("error -> Error avec le code", () => {
            const {player, events} = setup();
            player.load(video("a"));
            lastBridge().emit({type: h.Event.Error, code: 150});
            expect(events[0].type).toBe("error");
            expect(events[0].error).toBeInstanceOf(Error);
            expect(events[0].error.message).toBe("YouTube player error 150");
        });

        it("type inconnu ignoré", () => {
            const {player, events} = setup();
            player.load(video("a"));
            lastBridge().emit({type: "whatever"});
            expect(events).toEqual([]);
        });
    });

    describe("subscribe", () => {
        it("plusieurs listeners + désabonnement", () => {
            const {player} = setup();
            const a = vi.fn();
            const b = vi.fn();
            player.subscribe(a);
            const unsubscribeB = player.subscribe(b);
            player.load(video("x"));
            unsubscribeB();
            lastBridge().emit({type: h.Event.VideoPlay});
            expect(a).toHaveBeenCalledTimes(1);
            expect(b).not.toHaveBeenCalled();
        });

        it("se désabonner pendant l'émission ne casse pas l'itération", () => {
            const {player} = setup();
            const second = vi.fn();
            const unsubscribe = player.subscribe(() => unsubscribe());
            player.subscribe(second);
            player.load(video("x"));
            lastBridge().emit({type: h.Event.VideoPlay});
            expect(second).toHaveBeenCalledTimes(1);
        });
    });

    describe("dispose", () => {
        it("déconnecte le bridge, retire l'iframe créée, vide l'état et les listeners", () => {
            const {player, events} = setup();
            player.load(video("a"));
            const iframe = player.iframe;
            const bridge = lastBridge();

            player.dispose();
            expect(bridge.disconnect).toHaveBeenCalledTimes(1);
            expect(iframe.remove).toHaveBeenCalledTimes(1);
            expect(player.iframe).toBeNull();

            bridge.emit({type: h.Event.VideoPlay});
            expect(events).toEqual([]);
        });

        it("sûr sans load et appelé deux fois", () => {
            const {player} = setup();
            expect(() => {
                player.dispose();
                player.dispose();
            }).not.toThrow();
        });

        it("on peut recharger après dispose (nouvelle iframe, nouveau bridge)", () => {
            const {player, createIframe} = setup();
            player.load(video("a"));
            player.dispose();
            player.load(video("b"));
            expect(createIframe).toHaveBeenCalledTimes(2);
            expect(h.instances).toHaveLength(2);
            expect(player.iframe.src).toBe("video-src:b");
        });

        it("play/pause après dispose ne plantent pas", () => {
            const {player} = setup();
            player.load(video("a"));
            player.dispose();
            expect(() => {
                player.play();
                player.pause();
            }).not.toThrow();
        });
    });

    describe("iframe adoptée", () => {
        const adopt = (src, origin) => {
            const builder = makeBuilder(origin);
            const iframe = fakeIframe(src);
            const player = new YouTubePlayer({builder, iframe});
            return {player, builder, iframe};
        };
        const params = (iframe) => new URL(iframe.src).searchParams;

        it("attache le bridge dès le constructeur et pilote par commandes (pas de createIframe)", () => {
            const {player, iframe} = adopt("https://www.youtube.com/embed/abc?enablejsapi=1");
            expect(player.iframe).toBe(iframe);
            expect(h.instances).toHaveLength(1);
            expect(lastBridge().connect).toHaveBeenCalled();

            player.load(video("xyz"), {autoplay: true});
            expect(lastBridge().command).toHaveBeenCalledWith("loadVideoById", ["xyz", 0]);
        });

        it("ajoute enablejsapi=1 et origin quand ils manquent", () => {
            const {iframe} = adopt("https://www.youtube.com/embed/abc", "https://site.test");
            expect(params(iframe).get("enablejsapi")).toBe("1");
            expect(params(iframe).get("origin")).toBe("https://site.test");
        });

        it("corrige enablejsapi=0", () => {
            const {iframe} = adopt("https://www.youtube.com/embed/abc?enablejsapi=0");
            expect(params(iframe).get("enablejsapi")).toBe("1");
        });

        it("corrige un origin différent", () => {
            const {iframe} = adopt(
                "https://www.youtube.com/embed/abc?enablejsapi=1&origin=https%3A%2F%2Fother.test",
                "https://site.test"
            );
            expect(params(iframe).get("origin")).toBe("https://site.test");
        });

        it("ne touche pas à la src si tout est déjà bon (pas de rechargement inutile)", () => {
            const src = "https://www.youtube.com/embed/abc?enablejsapi=1&origin=https%3A%2F%2Fsite.test";
            const {iframe} = adopt(src, "https://site.test");
            expect(iframe.src).toBe(src);
        });

        it("sans origin du builder : seul enablejsapi est géré", () => {
            const src = "https://www.youtube.com/embed/abc?enablejsapi=1";
            expect(adopt(src).iframe.src).toBe(src);
            expect(params(adopt("https://www.youtube.com/embed/abc").iframe).has("origin")).toBe(false);
        });

        it("conserve les autres paramètres", () => {
            const {iframe} = adopt("https://www.youtube.com/embed/abc?rel=0&start=10");
            expect(params(iframe).get("rel")).toBe("0");
            expect(params(iframe).get("start")).toBe("10");
        });

        it("src invalide : laissée telle quelle, sans exception", () => {
            const {iframe} = adopt("pas une url");
            expect(iframe.src).toBe("pas une url");
            expect(h.instances).toHaveLength(1);
        });

        it("dispose ne retire pas l'iframe adoptée", () => {
            const {player, iframe} = adopt("https://www.youtube.com/embed/abc?enablejsapi=1");
            player.dispose();
            expect(iframe.remove).not.toHaveBeenCalled();
            expect(lastBridge().disconnect).toHaveBeenCalled();
        });
    });
});