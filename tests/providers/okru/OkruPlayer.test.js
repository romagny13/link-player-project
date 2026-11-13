// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {OkruPlayer} from "../../../src/providers/okru/OkruPlayer.js";
import {OkruBridgeEvent} from "../../../src/providers/okru/OkruIframeBridge.js";
import {VideoInfo} from "../../../src/models/VideoInfo.js";
import {VideoListInfo} from "../../../src/models/VideoListInfo.js";

// ───────── Faux bridge ─────────
const bridges = vi.hoisted(() => []);

vi.mock("../../../src/providers/okru/OkruIframeBridge.js", () => {
    const OkruBridgeEvent = {
        VideoPlay: "videoPlay",
        VideoPause: "videoPause",
        VideoEnded: "videoEnded",
        Error: "error"
    };

    class OkruIframeBridge {
        constructor(iframe) {
            this.iframe = iframe;
            this.handler = null;
            this.options = null;
            this.command = vi.fn();
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

    return {OkruBridgeEvent, OkruIframeBridge};
});

// ───────── Helpers ─────────
const lastBridge = () => bridges.at(-1);

const video = (videoId = "111", extra = {}) =>
    new VideoInfo({provider: "okru", target: "zone", videoId, ...extra});

const list = (ids = ["111", "222", "333"], videos = []) => {
    const info = new VideoListInfo({provider: "okru", target: "zone", videoIds: ids});
    videos.forEach((v) => info.addVideo(v));
    return info;
};

const makeCreateIframe = () =>
    vi.fn((src) => {
        const iframe = document.createElement("iframe");
        iframe.src = src;
        return iframe;
    });

function makePlayer(options = {}) {
    const urlBuilder = {
        build: vi.fn(({videoId, autoplay, startSeconds}) =>
            `https://ok.ru/videoembed/${videoId}?autoplay=${autoplay ? 1 : 0}${startSeconds ? `&fromTime=${startSeconds}` : ""}`)
    };
    const createIframe = makeCreateIframe();
    const player = new OkruPlayer({createIframe, urlBuilder, ...options});
    return {player, urlBuilder, createIframe};
}

beforeEach(() => {
    bridges.length = 0;
    document.body.innerHTML = "";
});

describe("OkruPlayer", () => {
    describe("construction", () => {
        it("expose le type 'okru' et n'a pas d'iframe avant le premier chargement", () => {
            const {player} = makePlayer();
            expect(player.kind).toBe("okru");
            expect(player.iframe).toBeNull();
        });

        it("peut être construit sans aucune option", () => {
            expect(() => new OkruPlayer()).not.toThrow();
        });

        it("adopte une iframe existante et connecte le bridge", () => {
            const iframe = document.createElement("iframe");
            const {player} = makePlayer({iframe, createIframe: null});

            expect(player.iframe).toBe(iframe);
            expect(lastBridge().connect).toHaveBeenCalledTimes(1);
        });

        it("s'abonne aux événements play, pause, ended et error", () => {
            makePlayer({iframe: document.createElement("iframe")});
            expect(lastBridge().options.types).toEqual(expect.arrayContaining([
                OkruBridgeEvent.VideoPlay,
                OkruBridgeEvent.VideoPause,
                OkruBridgeEvent.VideoEnded,
                OkruBridgeEvent.Error
            ]));
        });
    });

    describe("load() : vidéo seule", () => {
        it("crée l'iframe avec le src du builder", () => {
            const {player, urlBuilder, createIframe} = makePlayer();

            player.load(video("111", {startSeconds: 90}), {autoplay: true});

            expect(urlBuilder.build).toHaveBeenCalledWith({videoId: "111", autoplay: true, startSeconds: 90});
            expect(createIframe).toHaveBeenCalledTimes(1);
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/111?autoplay=1&fromTime=90");
        });

        it("autoplay désactivé par défaut", () => {
            const {player, urlBuilder} = makePlayer();
            player.load(video("111"));
            expect(urlBuilder.build).toHaveBeenCalledWith(expect.objectContaining({autoplay: false}));
        });

        it("n'émet pas itemChange pour une vidéo seule", () => {
            const {player} = makePlayer();
            const onEvent = vi.fn();
            player.subscribe(onEvent);

            player.load(video("111"));

            expect(onEvent).not.toHaveBeenCalled();
        });

        it("recharge en changeant le src de l'iframe existante, sans en créer une autre", () => {
            const {player, createIframe} = makePlayer();
            player.load(video("111"));
            const iframe = player.iframe;

            player.load(video("222"));

            expect(createIframe).toHaveBeenCalledTimes(1);
            expect(player.iframe).toBe(iframe);
            expect(iframe.src).toBe("https://ok.ru/videoembed/222?autoplay=0");
        });

        it("lève une erreur sans createIframe quand aucune iframe n'est adoptée", () => {
            const player = new OkruPlayer({urlBuilder: {build: () => "https://ok.ru/videoembed/1"}});
            expect(() => player.load(video("111"))).toThrow(/createIframe is required/);
        });

        it("pilote une iframe adoptée en changeant son src", () => {
            const iframe = document.createElement("iframe");
            const {player, createIframe} = makePlayer({iframe});

            player.load(video("333"), {autoplay: true});

            expect(createIframe).not.toHaveBeenCalled();
            expect(iframe.src).toBe("https://ok.ru/videoembed/333?autoplay=1");
        });
    });

    describe("load() : liste de vidéos (émulée)", () => {
        it("charge la première vidéo par défaut et émet itemChange", () => {
            const {player, urlBuilder} = makePlayer();
            const onEvent = vi.fn();
            player.subscribe(onEvent);

            player.load(list(["111", "222"]));

            expect(urlBuilder.build).toHaveBeenCalledWith(expect.objectContaining({videoId: "111"}));
            expect(onEvent).toHaveBeenCalledWith({type: "itemChange", index: 0});
        });

        it("démarre à l'index demandé", () => {
            const {player, urlBuilder} = makePlayer();
            player.load(list(["111", "222", "333"]), {index: 2, autoplay: true});
            expect(urlBuilder.build).toHaveBeenCalledWith({videoId: "333", autoplay: true, startSeconds: undefined});
        });

        it("transmet le startSeconds de chaque vidéo déclarée", () => {
            const videos = [video("111"), video("222", {startSeconds: 42})];
            const {player, urlBuilder} = makePlayer();

            player.load(list(["111", "222"], videos), {index: 1});

            expect(urlBuilder.build).toHaveBeenCalledWith(expect.objectContaining({videoId: "222", startSeconds: 42}));
        });

        it("fonctionne quand aucune vidéo n'est déclarée (info null)", () => {
            const {player, urlBuilder} = makePlayer();
            player.load(list(["111", "222"]), {index: 1});
            expect(urlBuilder.build).toHaveBeenCalledWith(expect.objectContaining({videoId: "222", startSeconds: undefined}));
        });
    });

    describe("navigation dans la liste", () => {
        let player;
        let urlBuilder;
        let onEvent;

        beforeEach(() => {
            ({player, urlBuilder} = makePlayer());
            player.load(list(["111", "222", "333"]));
            onEvent = vi.fn();
            player.subscribe(onEvent);
            urlBuilder.build.mockClear();
        });

        it("next() passe à la vidéo suivante avec autoplay", () => {
            player.next();
            expect(urlBuilder.build).toHaveBeenCalledWith(expect.objectContaining({videoId: "222", autoplay: true}));
            expect(onEvent).toHaveBeenCalledWith({type: "itemChange", index: 1});
        });

        it("previous() revient en arrière", () => {
            player.playAt(2);
            urlBuilder.build.mockClear();
            player.previous();
            expect(urlBuilder.build).toHaveBeenCalledWith(expect.objectContaining({videoId: "222", autoplay: true}));
        });

        it("playAt() saute à l'index demandé", () => {
            player.playAt(2);
            expect(urlBuilder.build).toHaveBeenCalledWith(expect.objectContaining({videoId: "333", autoplay: true}));
            expect(onEvent).toHaveBeenCalledWith({type: "itemChange", index: 2});
        });

        it("ignore un index hors limites (pas de chargement, pas d'événement)", () => {
            player.playAt(10);
            player.playAt(-1);
            player.previous(); // index 0 → -1

            expect(urlBuilder.build).not.toHaveBeenCalled();
            expect(onEvent).not.toHaveBeenCalled();
        });

        it("next() sur la dernière vidéo ne fait rien", () => {
            player.playAt(2);
            urlBuilder.build.mockClear();
            onEvent.mockClear();

            player.next();

            expect(urlBuilder.build).not.toHaveBeenCalled();
            expect(onEvent).not.toHaveBeenCalled();
        });
    });

    describe("play() / pause()", () => {
        it("envoie les commandes au bridge", () => {
            const {player} = makePlayer();
            player.load(video());
            const bridge = lastBridge();

            player.play();
            player.pause();

            expect(bridge.command.mock.calls).toEqual([["play"], ["pause"]]);
        });

        it("ne fait rien sans bridge", () => {
            const {player} = makePlayer();
            expect(() => {
                player.play();
                player.pause();
            }).not.toThrow();
        });
    });

    describe("événements du bridge", () => {
        let player;
        let bridge;
        let onEvent;

        beforeEach(() => {
            ({player} = makePlayer());
            player.load(list(["111", "222"]));
            bridge = lastBridge();
            onEvent = vi.fn();
            player.subscribe(onEvent);
        });

        it("videoPlay → state playing avec l'index courant", () => {
            bridge.handler({type: OkruBridgeEvent.VideoPlay});
            expect(onEvent).toHaveBeenCalledWith({type: "state", state: "playing", index: 0});
        });

        it("videoPause → state paused avec l'index courant", () => {
            player.playAt(1);
            onEvent.mockClear();
            bridge.handler({type: OkruBridgeEvent.VideoPause});
            expect(onEvent).toHaveBeenCalledWith({type: "state", state: "paused", index: 1});
        });

        it("videoEnded au milieu de la liste → state ended puis passage à la suivante", () => {
            bridge.handler({type: OkruBridgeEvent.VideoEnded});

            expect(onEvent.mock.calls.map(([e]) => e)).toEqual([
                {type: "state", state: "ended", index: 0},
                {type: "itemChange", index: 1}
            ]);
            expect(player.iframe.src).toContain("/videoembed/222");
            expect(player.iframe.src).toContain("autoplay=1");
        });

        it("videoEnded sur la dernière vidéo → state ended seulement", () => {
            player.playAt(1);
            onEvent.mockClear();

            bridge.handler({type: OkruBridgeEvent.VideoEnded});

            expect(onEvent.mock.calls.map(([e]) => e)).toEqual([
                {type: "state", state: "ended", index: 1}
            ]);
        });

        it("videoEnded sur une vidéo seule → pas d'enchaînement", () => {
            const {player: single} = makePlayer();
            single.load(video("111"));
            const singleBridge = lastBridge();
            const listener = vi.fn();
            single.subscribe(listener);

            singleBridge.handler({type: OkruBridgeEvent.VideoEnded});

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith({type: "state", state: "ended", index: 0});
        });

        it("error → Error avec le message du bridge", () => {
            bridge.handler({type: OkruBridgeEvent.Error, message: "Vidéo supprimée"});
            const event = onEvent.mock.lastCall[0];
            expect(event.type).toBe("error");
            expect(event.error.message).toBe("Vidéo supprimée");
        });

        it("error sans message → message par défaut", () => {
            bridge.handler({type: OkruBridgeEvent.Error});
            expect(onEvent.mock.lastCall[0].error.message).toBe("Ok.ru player error");
        });

        it("subscribe() renvoie une fonction de désabonnement", () => {
            const other = vi.fn();
            const stop = player.subscribe(other);
            stop();
            bridge.handler({type: OkruBridgeEvent.VideoPlay});
            expect(other).not.toHaveBeenCalled();
        });

        it("prévient tous les abonnés, même si l'un se désabonne pendant l'émission", () => {
            const second = vi.fn();
            const stop = player.subscribe(() => stop());
            player.subscribe(second);
            bridge.handler({type: OkruBridgeEvent.VideoPlay});
            expect(second).toHaveBeenCalled();
        });
    });

    describe("builder par défaut", () => {
        it("mode direct : utilise ok.ru/videoembed", () => {
            const createIframe = makeCreateIframe();
            const player = new OkruPlayer({createIframe});

            player.load(video("123456"), {autoplay: true});

            expect(player.iframe.src).toBe("https://ok.ru/videoembed/123456?autoplay=1");
        });

        it("mode relais : utilise la page relais avec le videoId en paramètre", () => {
            const createIframe = makeCreateIframe();
            const player = new OkruPlayer({createIframe, embedBaseUrl: "https://relay.test/okru.html"});

            player.load(video("123456"));

            const url = new URL(player.iframe.src);
            expect(url.origin + url.pathname).toBe("https://relay.test/okru.html");
            expect(url.searchParams.get("videoId")).toBe("123456");
        });
    });

    describe("dispose()", () => {
        it("déconnecte le bridge, vide l'iframe et les abonnés", () => {
            const {player} = makePlayer();
            player.load(video());
            const bridge = lastBridge();

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
            const iframe = document.createElement("iframe");
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
