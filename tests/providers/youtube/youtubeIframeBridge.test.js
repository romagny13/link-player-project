import { describe, it, expect, vi, beforeEach } from "vitest";
import { YouTubeIframeBridge, YouTubeBridgeEvent as E } from "../../../src/providers/youtube/YouTubeIframeBridge.js";

const SRC = "https://www.youtube.com/embed/69iUWLA0oVc?enablejsapi=1";

/** Iframe et window factices (EventTarget) : on contrôle les messages reçus et on espionne postMessage. */
function setup({ src = SRC } = {}) {
    const contentWindow = { postMessage: vi.fn() };
    const iframe = Object.assign(new EventTarget(), { src, contentWindow });
    const win = new EventTarget();
    const bridge = new YouTubeIframeBridge(iframe, { window: win });

    /** Simule un message du player (objet → JSON). `source` : par défaut la fenêtre de l'iframe. */
    const receive = (data, source = contentWindow) => {
        const e = new Event("message");
        e.source = source;
        e.data = typeof data === "string" || data === null || typeof data === "number" ? data : JSON.stringify(data);
        win.dispatchEvent(e);
    };
    const sent = () => contentWindow.postMessage.mock.calls.map(([m]) => JSON.parse(m));
    const events = [];
    bridge.subscribe((e) => events.push(e));
    const types = () => events.map((e) => e.type);
    return { bridge, iframe, win, contentWindow, receive, sent, events, types };
}

const HANDSHAKE = { event: "listening", id: 1, channel: "widget" };
const ready = (ctx) => ctx.receive({ event: "onReady" });

describe("YouTubeBridgeEvent", () => {
    it("constantes gelées avec les noms attendus", () => {
        expect(Object.isFrozen(E)).toBe(true);
        expect(E).toMatchObject({
            Ready: "ready", StateChange: "stateChange", VideoPlay: "videoPlay", VideoPause: "videoPause",
            VideoBuffering: "videoBuffering", VideoEnded: "videoEnded", TimeUpdate: "timeUpdate",
            DurationChange: "durationChange", PlaylistIndexChange: "playlistIndexChange", VideoChange: "videoChange",
            VolumeChange: "volumeChange", MuteChange: "muteChange", RateChange: "rateChange",
            QualityChange: "qualityChange", Error: "error", Message: "message"
        });
    });
});

describe("YouTubeIframeBridge : connexion", () => {
    it("connect() envoie le handshake « listening » à l'origine de l'iframe", () => {
        const { bridge, contentWindow, sent } = setup();
        bridge.connect();
        expect(sent()).toEqual([HANDSHAKE]);
        expect(contentWindow.postMessage.mock.calls[0][1]).toBe("https://www.youtube.com");
    });

    it("connect() est idempotent", () => {
        const { bridge, sent } = setup();
        bridge.connect();
        bridge.connect();
        expect(sent()).toHaveLength(1);
    });

    it("origine '*' quand le src de l'iframe n'est pas une URL valide", () => {
        const { bridge, contentWindow } = setup({ src: "" });
        bridge.connect();
        expect(contentWindow.postMessage.mock.calls[0][1]).toBe("*");
    });

    it("sans contentWindow : pas d'exception", () => {
        const ctx = setup();
        ctx.iframe.contentWindow = null;
        expect(() => ctx.bridge.connect()).not.toThrow();
    });

    it("disconnect() : plus aucun événement, plus de handshake sur load", () => {
        const ctx = setup();
        ctx.bridge.connect();
        ctx.bridge.disconnect();
        ctx.receive({ event: "onReady" });
        ctx.iframe.dispatchEvent(new Event("load"));
        expect(ctx.events).toEqual([]);
        expect(ctx.sent()).toEqual([HANDSHAKE]);   // seulement le handshake initial
    });

    it("disconnect() est idempotent et sans effet avant connect()", () => {
        const { bridge } = setup();
        expect(() => { bridge.disconnect(); bridge.disconnect(); }).not.toThrow();
    });

    it("disconnect() vide la file des commandes", () => {
        const ctx = setup();
        ctx.bridge.connect();
        ctx.bridge.command("playVideo");
        ctx.bridge.disconnect();
        ctx.bridge.connect();
        ctx.contentWindow.postMessage.mockClear();
        ctx.receive({ event: "onReady" });
        expect(ctx.sent()).toEqual([]);
    });

    it("l'événement load de l'iframe renvoie un handshake et repasse en « pas prêt »", () => {
        const ctx = setup();
        ctx.bridge.connect();
        ready(ctx);
        ctx.contentWindow.postMessage.mockClear();
        ctx.iframe.dispatchEvent(new Event("load"));
        expect(ctx.sent()).toEqual([HANDSHAKE]);
        ctx.contentWindow.postMessage.mockClear();
        ctx.bridge.command("playVideo");
        expect(ctx.sent()).toEqual([]);            // remis en file
        ready(ctx);
        expect(ctx.sent()).toEqual([{ event: "command", func: "playVideo", args: [] }]);
    });
});

describe("YouTubeIframeBridge : commandes", () => {
    let ctx;
    beforeEach(() => { ctx = setup(); ctx.bridge.connect(); ctx.contentWindow.postMessage.mockClear(); });

    it("avant « ready » : mises en file, envoyées dans l'ordre au moment du ready", () => {
        ctx.bridge.command("loadVideoById", ["abc", 0]);
        ctx.bridge.command("playVideo");
        expect(ctx.sent()).toEqual([]);
        ready(ctx);
        expect(ctx.sent()).toEqual([
            { event: "command", func: "loadVideoById", args: ["abc", 0] },
            { event: "command", func: "playVideo", args: [] }
        ]);
    });

    it("après « ready » : envoyées tout de suite", () => {
        ready(ctx);
        ctx.bridge.command("pauseVideo");
        expect(ctx.sent()).toEqual([{ event: "command", func: "pauseVideo", args: [] }]);
    });

    it("la file n'est envoyée qu'une fois", () => {
        ctx.bridge.command("playVideo");
        ready(ctx);
        ready(ctx);
        ctx.receive({ event: "initialDelivery", info: {} });
        expect(ctx.sent()).toHaveLength(1);
    });

    it("send() poste du JSON", () => {
        ctx.bridge.send({ event: "x", a: 1 });
        expect(ctx.contentWindow.postMessage.mock.calls[0][0]).toBe(JSON.stringify({ event: "x", a: 1 }));
    });
});

describe("YouTubeIframeBridge : réception", () => {
    let ctx;
    beforeEach(() => { ctx = setup(); ctx.bridge.connect(); });

    it("ignore les messages d'une autre fenêtre", () => {
        ctx.receive({ event: "onReady" }, { postMessage() {} });
        expect(ctx.events).toEqual([]);
    });

    it("ignore données non texte, JSON invalide ou sans « event »", () => {
        ctx.receive(42);
        ctx.receive("{pas du json");
        ctx.receive({ info: {} });
        ctx.receive(null);
        expect(ctx.events).toEqual([]);
    });

    it("onReady et initialDelivery marquent le player prêt (un seul « ready »)", () => {
        ctx.receive({ event: "onReady" });
        ctx.receive({ event: "initialDelivery", info: {} });
        expect(ctx.types().filter((t) => t === E.Ready)).toHaveLength(1);
    });

    it("onError → Error { code }", () => {
        ctx.receive({ event: "onError", info: 150 });
        expect(ctx.events).toEqual([{ type: E.Error, code: 150 }]);
    });

    describe("états", () => {
        it.each([
            [1, E.VideoPlay], [2, E.VideoPause], [3, E.VideoBuffering], [0, E.VideoEnded]
        ])("onStateChange %i → stateChange puis %s", (state, specific) => {
            ctx.receive({ event: "onStateChange", info: state });
            expect(ctx.events).toEqual([{ type: E.StateChange, state }, { type: specific }]);
        });

        it("un état non géré (5 : en attente) → stateChange seul", () => {
            ctx.receive({ event: "onStateChange", info: 5 });
            expect(ctx.types()).toEqual([E.StateChange]);
        });

        it("le même état deux fois de suite n'est notifié qu'une fois", () => {
            ctx.receive({ event: "onStateChange", info: 1 });
            ctx.receive({ event: "onStateChange", info: 1 });
            expect(ctx.types()).toEqual([E.StateChange, E.VideoPlay]);
            ctx.receive({ event: "onStateChange", info: 2 });
            ctx.receive({ event: "onStateChange", info: 1 });
            expect(ctx.types().filter((t) => t === E.VideoPlay)).toHaveLength(2);
        });

        it("playerState d'une infoDelivery est traité comme un changement d'état", () => {
            ctx.receive({ event: "infoDelivery", info: { playerState: 1 } });
            expect(ctx.types()).toEqual([E.StateChange, E.VideoPlay]);
        });
    });

    describe("infoDelivery", () => {
        it("currentTime → timeUpdate à chaque fois (avec duration) ; duration → durationChange", () => {
            ctx.receive({ event: "infoDelivery", info: { currentTime: 5, duration: 100 } });
            ctx.receive({ event: "infoDelivery", info: { currentTime: 6, duration: 100 } });
            expect(ctx.events).toEqual([
                { type: E.TimeUpdate, time: 5, duration: 100 }, { type: E.DurationChange, duration: 100 },
                { type: E.TimeUpdate, time: 6, duration: 100 }, { type: E.DurationChange, duration: 100 }
            ]);
        });

        it("playlistIndex : notifié au changement seulement, y compris l'index 0", () => {
            ctx.receive({ event: "infoDelivery", info: { playlistIndex: 0 } });
            ctx.receive({ event: "infoDelivery", info: { playlistIndex: 0 } });
            ctx.receive({ event: "infoDelivery", info: { playlistIndex: 1 } });
            expect(ctx.events).toEqual([
                { type: E.PlaylistIndexChange, index: 0 },
                { type: E.PlaylistIndexChange, index: 1 }
            ]);
        });

        it("videoData : videoChange une fois par id", () => {
            const info = { videoData: { video_id: "abc", title: "T", author: "A" } };
            ctx.receive({ event: "infoDelivery", info });
            ctx.receive({ event: "infoDelivery", info });
            expect(ctx.events).toEqual([{ type: E.VideoChange, videoId: "abc", title: "T", author: "A" }]);
            ctx.receive({ event: "infoDelivery", info: { videoData: { video_id: "def" } } });
            expect(ctx.events).toHaveLength(2);
        });

        it("volume et muted : chaque valeur est notifiée à son propre changement, avec l'état du son", () => {
            ctx.receive({ event: "infoDelivery", info: { volume: 50, muted: false } });
            expect(ctx.events).toEqual([
                { type: E.VolumeChange, volume: 50, muted: false },
                { type: E.MuteChange, volume: 50, muted: false }
            ]);
            ctx.events.length = 0;
            ctx.receive({ event: "infoDelivery", info: { volume: 50, muted: false } });
            expect(ctx.events).toEqual([]);
            ctx.receive({ event: "infoDelivery", info: { muted: true } });
            expect(ctx.events).toEqual([{ type: E.MuteChange, volume: 50, muted: true }]);
            ctx.events.length = 0;
            ctx.receive({ event: "infoDelivery", info: { volume: 20 } });
            expect(ctx.events).toEqual([{ type: E.VolumeChange, volume: 20, muted: true }]);
        });

        it("un son partiellement connu donne null pour l'autre valeur", () => {
            ctx.receive({ event: "infoDelivery", info: { muted: true } });
            expect(ctx.events).toEqual([{ type: E.MuteChange, volume: null, muted: true }]);
        });

        it("playbackRate et playbackQuality : au changement seulement", () => {
            ctx.receive({ event: "infoDelivery", info: { playbackRate: 1.5, playbackQuality: "hd720" } });
            ctx.receive({ event: "infoDelivery", info: { playbackRate: 1.5, playbackQuality: "hd720" } });
            expect(ctx.events).toEqual([
                { type: E.RateChange, rate: 1.5 },
                { type: E.QualityChange, quality: "hd720" }
            ]);
        });

        it("infoDelivery sans info : sans effet", () => {
            ctx.receive({ event: "infoDelivery" });
            expect(ctx.events).toEqual([]);
        });
    });

    it("initialDelivery : ready d'abord, puis tout le contenu dans l'ordre", () => {
        ctx.receive({
            event: "initialDelivery",
            info: {
                playerState: 2, currentTime: 5, duration: 100, playlistIndex: 1,
                videoData: { video_id: "abc", title: "T", author: "A" },
                volume: 80, muted: false, playbackRate: 1, playbackQuality: "hd720"
            }
        });
        expect(ctx.types()).toEqual([
            E.Ready, E.StateChange, E.VideoPause, E.TimeUpdate, E.DurationChange, E.PlaylistIndexChange,
            E.VideoChange, E.VolumeChange, E.MuteChange, E.RateChange, E.QualityChange
        ]);
    });

    it("resetState() : les mêmes valeurs sont notifiées de nouveau", () => {
        ctx.receive({ event: "infoDelivery", info: { playerState: 1, playlistIndex: 2, videoData: { video_id: "abc" }, volume: 10 } });
        ctx.events.length = 0;
        ctx.bridge.resetState();
        ctx.receive({ event: "infoDelivery", info: { playerState: 1, playlistIndex: 2, videoData: { video_id: "abc" }, volume: 10 } });
        expect(ctx.types()).toEqual([E.StateChange, E.VideoPlay, E.PlaylistIndexChange, E.VideoChange, E.VolumeChange]);
    });
});

describe("YouTubeIframeBridge : abonnés", () => {
    it("par défaut : tous les événements typés, mais pas « message »", () => {
        const ctx = setup();
        ctx.bridge.connect();
        ctx.receive({ event: "onReady" });
        expect(ctx.types()).toEqual([E.Ready]);
    });

    it("types : ne reçoit que ceux demandés ; « message » doit être demandé explicitement", () => {
        const ctx = setup();
        ctx.bridge.connect();
        const only = [], raw = [];
        ctx.bridge.subscribe((e) => only.push(e.type), { types: [E.VideoPlay] });
        ctx.bridge.subscribe((e) => raw.push(e), { types: [E.Message] });
        ctx.receive({ event: "onStateChange", info: 1 });
        expect(only).toEqual([E.VideoPlay]);
        expect(raw).toEqual([{ type: E.Message, name: "onStateChange", info: 1 }]);
    });

    it("types vide = comme pas de filtre", () => {
        const ctx = setup();
        ctx.bridge.connect();
        const got = [];
        ctx.bridge.subscribe((e) => got.push(e.type), { types: [] });
        ctx.receive({ event: "onReady" });
        expect(got).toEqual([E.Ready]);
    });

    it("s'abonner deux fois avec la même fonction remplace le filtre", () => {
        const ctx = setup();
        ctx.bridge.connect();
        const fn = vi.fn();
        ctx.bridge.subscribe(fn, { types: [E.Ready] });
        ctx.bridge.subscribe(fn, { types: [E.VideoPlay] });
        ctx.receive({ event: "onReady" });
        expect(fn).not.toHaveBeenCalled();
        ctx.receive({ event: "onStateChange", info: 1 });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("subscribe() renvoie une fonction de désabonnement", () => {
        const ctx = setup();
        ctx.bridge.connect();
        const fn = vi.fn();
        const off = ctx.bridge.subscribe(fn);
        off();
        ctx.receive({ event: "onReady" });
        expect(fn).not.toHaveBeenCalled();
    });

    it("un abonné qui plante n'empêche pas les autres", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const ctx = setup();
        ctx.bridge.connect();
        const ok = vi.fn();
        ctx.bridge.subscribe(() => { throw new Error("boom"); });
        ctx.bridge.subscribe(ok);
        ctx.receive({ event: "onReady" });
        expect(ok).toHaveBeenCalled();
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
});
