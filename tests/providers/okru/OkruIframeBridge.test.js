import {OkruBridgeEvent,OkruIframeBridge} from "../../../src/providers/okru/OkruIframeBridge.js";

describe("OkruIframeBridge", () => {
    let iframe;
    let win;
    let bridge;
    let posted;
    let messageHandler;

    function createFakeIframe(src = "https://ok.ru/videoembed/123") {
        posted = [];
        const loadListeners = new Set();

        return {
            src,
            contentWindow: {
                postMessage(data, origin) {
                    posted.push({ data, origin });
                }
            },
            addEventListener(type, fn) {
                if (type === "load") loadListeners.add(fn);
            },
            removeEventListener(type, fn) {
                if (type === "load") loadListeners.delete(fn);
            },
            triggerLoad() {
                loadListeners.forEach(fn => fn());
            }
        };
    }

    function createFakeWindow() {
        const listeners = new Set();
        return {
            addEventListener(type, fn) {
                if (type === "message") {
                    listeners.add(fn);
                    messageHandler = fn;
                }
            },
            removeEventListener(type, fn) {
                if (type === "message") listeners.delete(fn);
            },
            receive(data, source) {
                const event = {
                    data,
                    source: source ?? iframe.contentWindow
                };
                listeners.forEach(fn => fn(event));
            }
        };
    }

    beforeEach(() => {
        iframe = createFakeIframe();
        win = createFakeWindow();
        bridge = new OkruIframeBridge(iframe, { window: win });
    });

    // ───────── subscribe ─────────

    it("notifie les abonnés des événements demandés", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type), {
            types: [OkruBridgeEvent.Ready, OkruBridgeEvent.VideoPlay]
        });

        bridge.connect();
        win.receive({ event: "started" });

        expect(received).toEqual([
            OkruBridgeEvent.Ready,
            OkruBridgeEvent.VideoPlay
        ]);
    });

    it("unsubscribe fonctionne", () => {
        const received = [];
        const unsub = bridge.subscribe(e => received.push(e.type));

        bridge.connect();
        unsub();
        win.receive({ event: "started" });

        expect(received).toHaveLength(0);
    });

    // ───────── ready + queue ─────────

    it("met les commandes en file d'attente tant que le player n'est pas ready", () => {
        bridge.connect();
        bridge.command("play");
        bridge.command("setVolume", [0.8]);

        expect(posted).toHaveLength(0);

        // N'importe quel message rend le bridge ready
        win.receive({ event: "timeupdate", time: 0, duration: 100 });

        const methods = posted.map(p => JSON.parse(p.data).method);
        expect(methods).toContain("play");
        expect(methods).toContain("setVolume");
    });

    it("émet Ready une seule fois", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type), { types: [OkruBridgeEvent.Ready] });

        bridge.connect();
        win.receive({ event: "started" });
        win.receive({ event: "paused" });
        win.receive({ event: "timeupdate", time: 1, duration: 60 });

        expect(received).toEqual([OkruBridgeEvent.Ready]);
    });

    // ───────── états ─────────

    it("traduit correctement les événements du player", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type));

        bridge.connect();

        win.receive({ event: "started" });
        win.receive({ event: "resumed" });
        win.receive({ event: "paused" });
        win.receive({ event: "ended" });

        expect(received).toEqual(expect.arrayContaining([
            OkruBridgeEvent.Ready,
            OkruBridgeEvent.VideoPlay,
            OkruBridgeEvent.VideoPlay,   // resumed
            OkruBridgeEvent.VideoPause,
            OkruBridgeEvent.VideoEnded
        ]));
    });

    // ───────── timeupdate ─────────

    it("émet TimeUpdate", () => {
        const received = [];
        bridge.subscribe(e => received.push(e), { types: [OkruBridgeEvent.TimeUpdate] });

        bridge.connect();
        win.receive({ event: "timeupdate", time: 12.5, duration: 180 });

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual({
            type: OkruBridgeEvent.TimeUpdate,
            time: 12.5,
            duration: 180
        });
    });

    // ───────── volume / mute ─────────

    it("n'émet VolumeChange / MuteChange que lorsque la valeur change", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type), {
            types: [OkruBridgeEvent.VolumeChange, OkruBridgeEvent.MuteChange]
        });

        bridge.connect();

        // première fois
        win.receive({ event: "volumechange", volume: 0.5, muted: false });
        // mêmes valeurs → rien
        win.receive({ event: "volumechange", volume: 0.5, muted: false });
        // changement
        win.receive({ event: "volumechange", volume: 0.8, muted: true });

        expect(received).toEqual([
            OkruBridgeEvent.VolumeChange,
            OkruBridgeEvent.MuteChange,
            OkruBridgeEvent.VolumeChange,
            OkruBridgeEvent.MuteChange
        ]);
    });

    it("mute / unmute produisent MuteChange sans doublon avec volumechange", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type), {
            types: [OkruBridgeEvent.MuteChange]
        });

        bridge.connect();

        win.receive({ event: "mute" });
        // volumechange qui répète muted: true → pas de nouvel événement
        win.receive({ event: "volumechange", volume: 0.5, muted: true });
        win.receive({ event: "unmute" });

        expect(received).toEqual([
            OkruBridgeEvent.MuteChange,
            OkruBridgeEvent.MuteChange
        ]);
    });

    // ───────── error ─────────

    it("émet Error", () => {
        const received = [];
        bridge.subscribe(e => received.push(e), { types: [OkruBridgeEvent.Error] });

        bridge.connect();
        win.receive({ event: "error", message: "Video not found" });

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual({
            type: OkruBridgeEvent.Error,
            message: "Video not found"
        });
    });

    // ───────── sécurité ─────────

    it("ignore les messages qui ne viennent pas de l'iframe", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type));

        bridge.connect();
        win.receive({ event: "started" }, {}); // mauvaise source

        expect(received).toHaveLength(0);
    });

    // ───────── load + src ─────────

    it("ne reset pas ready si le src n'a pas changé au load", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type), { types: [OkruBridgeEvent.Ready] });

        bridge.connect();
        win.receive({ event: "started" }); // → ready
        expect(received).toHaveLength(1);

        iframe.triggerLoad(); // même src
        win.receive({ event: "paused" });

        // Ready n'est pas ré-émis
        expect(received).toHaveLength(1);
    });

    it("reset ready si le src a changé au load", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type), { types: [OkruBridgeEvent.Ready] });

        bridge.connect();
        win.receive({ event: "started" });
        expect(received).toHaveLength(1);

        iframe.src = "https://ok.ru/videoembed/999"; // nouveau src
        iframe.triggerLoad();

        win.receive({ event: "started" });
        expect(received).toHaveLength(2);
    });

    // ───────── disconnect ─────────

    it("disconnect empêche toute nouvelle notification", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type));

        bridge.connect();
        bridge.disconnect();
        win.receive({ event: "started" });

        expect(received).toHaveLength(0);
    });
});