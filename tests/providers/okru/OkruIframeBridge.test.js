import { describe, it, expect, vi, beforeEach } from "vitest";
import { OkruIframeBridge, OkruBridgeEvent as E } from "../../../src/providers/okru/OkruIframeBridge.js";

const SRC = "https://okru-embed.vercel.app/?videoId=17222095800962";

/** Iframe et window factices (EventTarget). `iframe.src` est modifiable pour simuler un changement de vidéo. */
function setup({ src = SRC } = {}) {
    const contentWindow = { postMessage: vi.fn() };
    const iframe = Object.assign(new EventTarget(), { src, contentWindow });
    const win = new EventTarget();
    const bridge = new OkruIframeBridge(iframe, { window: win });

    const receive = (data, source = contentWindow) => {
        const e = new Event("message");
        e.source = source;
        e.data = data;
        win.dispatchEvent(e);
    };
    const sent = () => contentWindow.postMessage.mock.calls.map(([m]) => m);
    const events = [];
    bridge.subscribe((e) => events.push(e));
    const types = () => events.map((e) => e.type);
    return { bridge, iframe, win, contentWindow, receive, sent, events, types };
}

describe("OkruBridgeEvent", () => {
    it("constantes gelées avec les noms attendus", () => {
        expect(Object.isFrozen(E)).toBe(true);
        expect(E).toMatchObject({
            Ready: "ready", StateChange: "stateChange", VideoPlay: "videoPlay", VideoPause: "videoPause",
            VideoEnded: "videoEnded", TimeUpdate: "timeUpdate", VolumeChange: "volumeChange",
            MuteChange: "muteChange", Error: "error", Message: "message"
        });
    });
});

describe("OkruIframeBridge : connexion", () => {
    it("connect() n'envoie rien (pas de handshake chez OK.ru)", () => {
        const { bridge, sent } = setup();
        bridge.connect();
        expect(sent()).toEqual([]);
    });

    it("connect() est idempotent : un message ne produit pas deux fois les événements", () => {
        const ctx = setup();
        ctx.bridge.connect();
        ctx.bridge.connect();
        ctx.receive({ event: "started" });
        expect(ctx.types().filter((t) => t === E.VideoPlay)).toHaveLength(1);
    });

    it("disconnect() : plus d'événements ; idempotent ; sans effet avant connect()", () => {
        const ctx = setup();
        expect(() => ctx.bridge.disconnect()).not.toThrow();
        ctx.bridge.connect();
        ctx.bridge.disconnect();
        ctx.bridge.disconnect();
        ctx.receive({ event: "started" });
        expect(ctx.events).toEqual([]);
    });
});

describe("OkruIframeBridge : réception", () => {
    let ctx;
    beforeEach(() => { ctx = setup(); ctx.bridge.connect(); });

    it("ignore les messages d'une autre fenêtre", () => {
        ctx.receive({ event: "started" }, { postMessage() {} });
        expect(ctx.events).toEqual([]);
    });

    it("ignore données vides, JSON invalide, ou sans « event »", () => {
        ctx.receive(null);
        ctx.receive("");
        ctx.receive("{pas du json");
        ctx.receive({ time: 1 });
        ctx.receive("42");      // JSON valide mais sans champ event
        expect(ctx.events).toEqual([]);
    });

    it("accepte un objet ou une chaîne JSON", () => {
        ctx.receive({ event: "started" });
        ctx.receive(JSON.stringify({ event: "paused" }));
        expect(ctx.types()).toEqual([E.Ready, E.VideoPlay, E.VideoPause]);
    });

    it("le premier message valide marque le player prêt (un seul « ready »)", () => {
        ctx.receive({ event: "volumechange", volume: 1 });
        ctx.receive({ event: "started" });
        expect(ctx.types().filter((t) => t === E.Ready)).toHaveLength(1);
        expect(ctx.types()[0]).toBe(E.Ready);
    });

    it.each([
        ["started", E.VideoPlay], ["resumed", E.VideoPlay], ["paused", E.VideoPause], ["ended", E.VideoEnded]
    ])("« %s » → %s", (name, type) => {
        ctx.receive({ event: name });
        expect(ctx.events.at(-1)).toEqual({ type });
    });

    it("timeupdate → timeUpdate { time, duration } (à chaque message)", () => {
        ctx.receive({ event: "timeupdate", time: 12.5, duration: 2697 });
        ctx.receive({ event: "timeupdate", time: 13.5, duration: 2697 });
        expect(ctx.events.filter((e) => e.type === E.TimeUpdate)).toEqual([
            { type: E.TimeUpdate, time: 12.5, duration: 2697 },
            { type: E.TimeUpdate, time: 13.5, duration: 2697 }
        ]);
    });

    it("error → Error { message }", () => {
        ctx.receive({ event: "error", message: "video not found" });
        expect(ctx.events.at(-1)).toEqual({ type: E.Error, message: "video not found" });
    });

    it("événement inconnu : seulement « ready » la 1re fois", () => {
        ctx.receive({ event: "quelquechose" });
        expect(ctx.types()).toEqual([E.Ready]);
    });

    describe("son", () => {
        it("volumechange { volume, muted } → volumeChange puis muteChange (premières valeurs connues)", () => {
            ctx.receive({ event: "volumechange", volume: 0.98, muted: false });
            expect(ctx.events.slice(1)).toEqual([
                { type: E.VolumeChange, volume: 0.98, muted: false },
                { type: E.MuteChange, volume: 0.98, muted: false }
            ]);
        });

        it("seules les valeurs qui changent sont notifiées", () => {
            ctx.receive({ event: "volumechange", volume: 0.5, muted: false });
            ctx.events.length = 0;
            ctx.receive({ event: "volumechange", volume: 0.5, muted: false });
            expect(ctx.events).toEqual([]);
            ctx.receive({ event: "volumechange", volume: 0.7, muted: false });
            expect(ctx.events).toEqual([{ type: E.VolumeChange, volume: 0.7, muted: false }]);
        });

        it("mute / unmute → muteChange (volume null tant qu'il est inconnu)", () => {
            ctx.receive({ event: "mute" });
            expect(ctx.events.at(-1)).toEqual({ type: E.MuteChange, volume: null, muted: true });
            ctx.receive({ event: "unmute" });
            expect(ctx.events.at(-1)).toEqual({ type: E.MuteChange, volume: null, muted: false });
        });

        it("« mute » suivi de volumechange { muted: true } = un seul muteChange", () => {
            ctx.receive({ event: "mute" });
            ctx.receive({ event: "volumechange", volume: 0.3, muted: true });
            expect(ctx.types().filter((t) => t === E.MuteChange)).toHaveLength(1);
            expect(ctx.types().filter((t) => t === E.VolumeChange)).toHaveLength(1);
        });

        it("volume 0 est une valeur (pas « absente »)", () => {
            ctx.receive({ event: "volumechange", volume: 0, muted: true });
            expect(ctx.events).toContainEqual({ type: E.VolumeChange, volume: 0, muted: true });
        });
    });
});

describe("OkruIframeBridge : commandes", () => {
    let ctx;
    beforeEach(() => { ctx = setup(); ctx.bridge.connect(); });

    it("avant « ready » : en file, envoyées dans l'ordre au premier message du player", () => {
        ctx.bridge.command("play");
        ctx.bridge.command("pause");
        expect(ctx.sent()).toEqual([]);
        ctx.receive({ event: "started" });
        expect(ctx.sent()).toEqual([JSON.stringify({ method: "play", args: null }), JSON.stringify({ method: "pause", args: null })]);
    });

    it("après « ready » : envoyées tout de suite, avec leurs arguments", () => {
        ctx.receive({ event: "started" });
        ctx.bridge.command("seek", [30]);
        expect(ctx.sent()).toEqual([JSON.stringify({ method: "seek", args: [30] })]);
    });

    it("la file n'est envoyée qu'une fois", () => {
        ctx.bridge.command("play");
        ctx.receive({ event: "started" });
        ctx.receive({ event: "paused" });
        expect(ctx.sent()).toHaveLength(1);
    });

    it("send() : une chaîne part telle quelle, un objet est sérialisé", () => {
        ctx.bridge.send("brut");
        ctx.bridge.send({ a: 1 });
        expect(ctx.sent()).toEqual(["brut", JSON.stringify({ a: 1 })]);
    });

    it("origine cible = origine du src de l'iframe ; '*' si invalide", () => {
        ctx.bridge.send("x");
        expect(ctx.contentWindow.postMessage.mock.calls[0][1]).toBe("https://okru-embed.vercel.app");
        const other = setup({ src: "" });
        other.bridge.send("x");
        expect(other.contentWindow.postMessage.mock.calls[0][1]).toBe("*");
    });

    it("sans contentWindow : pas d'exception", () => {
        ctx.iframe.contentWindow = null;
        expect(() => ctx.bridge.send("x")).not.toThrow();
    });
});

describe("OkruIframeBridge : changement de src (resetState / load)", () => {
    let ctx;
    beforeEach(() => { ctx = setup(); ctx.bridge.connect(); });

    it("resetState() : les messages sont ignorés jusqu'au « load » de l'iframe", () => {
        ctx.receive({ event: "started" });
        ctx.events.length = 0;
        ctx.bridge.resetState();
        ctx.receive({ event: "paused" });          // l'ancienne vidéo parle encore
        expect(ctx.events).toEqual([]);
        ctx.iframe.src = "https://okru-embed.vercel.app/?videoId=2";
        ctx.iframe.dispatchEvent(new Event("load"));
        ctx.receive({ event: "paused" });
        expect(ctx.types()).toEqual([E.Ready, E.VideoPause]);   // nouveau « ready »
    });

    it("resetState() vide la file de commandes", () => {
        ctx.bridge.command("play");
        ctx.bridge.resetState();
        ctx.iframe.dispatchEvent(new Event("load"));
        ctx.receive({ event: "started" });
        expect(ctx.sent()).toEqual([]);
    });

    it("resetState() oublie le son connu : mêmes valeurs notifiées de nouveau", () => {
        ctx.receive({ event: "volumechange", volume: 0.5, muted: false });
        ctx.events.length = 0;
        ctx.bridge.resetState();
        ctx.iframe.dispatchEvent(new Event("load"));
        ctx.receive({ event: "volumechange", volume: 0.5, muted: false });
        expect(ctx.types()).toEqual([E.Ready, E.VolumeChange, E.MuteChange]);
    });

    it("après resetState + load, les commandes repartent en file jusqu'au nouveau « ready »", () => {
        ctx.receive({ event: "started" });
        ctx.bridge.resetState();
        ctx.iframe.dispatchEvent(new Event("load"));
        ctx.bridge.command("play");
        expect(ctx.sent()).toEqual([]);
        ctx.receive({ event: "started" });
        expect(ctx.sent()).toEqual([JSON.stringify({ method: "play", args: null })]);
    });

    it("« load » sans changement de src (même page déjà prête) : l'état est conservé", () => {
        ctx.receive({ event: "volumechange", volume: 0.5, muted: false });
        ctx.iframe.dispatchEvent(new Event("load"));
        ctx.bridge.command("pause");
        expect(ctx.sent()).toEqual([JSON.stringify({ method: "pause", args: null })]);   // toujours prêt
        ctx.events.length = 0;
        ctx.receive({ event: "volumechange", volume: 0.5, muted: false });
        expect(ctx.events).toEqual([]);                                                   // son toujours connu
    });

    it("« load » avec un src différent de celui du « ready » : repart de zéro", () => {
        ctx.receive({ event: "started" });
        ctx.iframe.src = "https://okru-embed.vercel.app/?videoId=autre";
        ctx.iframe.dispatchEvent(new Event("load"));
        ctx.bridge.command("play");
        expect(ctx.sent()).toEqual([]);
    });
});

describe("OkruIframeBridge : abonnés", () => {
    it("par défaut : événements typés, pas « message »", () => {
        const ctx = setup();
        ctx.bridge.connect();
        ctx.receive({ event: "started" });
        expect(ctx.types()).not.toContain(E.Message);
    });

    it("« message » doit être demandé : reçoit chaque message brut avant les événements typés", () => {
        const ctx = setup();
        ctx.bridge.connect();
        const raw = [];
        ctx.bridge.subscribe((e) => raw.push(e), { types: [E.Message] });
        const msg = { event: "timeupdate", time: 1, duration: 2 };
        ctx.receive(msg);
        expect(raw).toEqual([{ type: E.Message, name: "timeupdate", info: msg }]);
    });

    it("types : filtre ; types vide = pas de filtre", () => {
        const ctx = setup();
        ctx.bridge.connect();
        const only = [], all = [];
        ctx.bridge.subscribe((e) => only.push(e.type), { types: [E.VideoEnded] });
        ctx.bridge.subscribe((e) => all.push(e.type), { types: [] });
        ctx.receive({ event: "ended" });
        expect(only).toEqual([E.VideoEnded]);
        expect(all).toEqual([E.Ready, E.VideoEnded]);
    });

    it("même fonction abonnée deux fois : le filtre est remplacé", () => {
        const ctx = setup();
        ctx.bridge.connect();
        const fn = vi.fn();
        ctx.bridge.subscribe(fn, { types: [E.VideoPlay] });
        ctx.bridge.subscribe(fn, { types: [E.VideoPause] });
        ctx.receive({ event: "started" });
        expect(fn).not.toHaveBeenCalled();
        ctx.receive({ event: "paused" });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("désabonnement", () => {
        const ctx = setup();
        ctx.bridge.connect();
        const fn = vi.fn();
        ctx.bridge.subscribe(fn)();
        ctx.receive({ event: "started" });
        expect(fn).not.toHaveBeenCalled();
    });

    it("un abonné qui plante n'empêche pas les autres", () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => {});
        const ctx = setup();
        ctx.bridge.connect();
        const ok = vi.fn();
        ctx.bridge.subscribe(() => { throw new Error("boom"); });
        ctx.bridge.subscribe(ok);
        ctx.receive({ event: "started" });
        expect(ok).toHaveBeenCalled();
        expect(err).toHaveBeenCalled();
        err.mockRestore();
    });
});
