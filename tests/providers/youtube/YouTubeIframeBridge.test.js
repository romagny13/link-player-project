import {YouTubeBridgeEvent, YouTubeIframeBridge} from "../../../src/providers/youtube/YouTubeIframeBridge.js";

describe("YouTubeIframeBridge", () => {
    let iframe;
    let win;
    let bridge;
    let posted;          // messages envoyés via postMessage
    let messageHandler;  // le listener "message" enregistré

    function createFakeIframe(src = "https://www.youtube.com/embed/abc123") {
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
            // helper pour les tests
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
            // helper pour simuler un message venant de l'iframe
            receive(data, source) {
                const event = {
                    data: typeof data === "string" ? data : JSON.stringify(data),
                    source: source ?? iframe.contentWindow
                };
                listeners.forEach(fn => fn(event));
            }
        };
    }

    beforeEach(() => {
        iframe = createFakeIframe();
        win = createFakeWindow();
        bridge = new YouTubeIframeBridge(iframe, { window: win });
    });

    // ───────── subscribe ─────────

    it("notifie les abonnés des événements demandés", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type), {
            types: [YouTubeBridgeEvent.Ready, YouTubeBridgeEvent.VideoPlay]
        });

        bridge.connect();
        win.receive({ event: "onReady" });
        win.receive({ event: "onStateChange", info: 1 }); // playing

        expect(received).toEqual([
            YouTubeBridgeEvent.Ready,
            YouTubeBridgeEvent.VideoPlay
        ]);
    });

    it("unsubscribe fonctionne", () => {
        const received = [];
        const unsub = bridge.subscribe(e => received.push(e.type));

        bridge.connect();
        unsub();
        win.receive({ event: "onReady" });

        expect(received).toHaveLength(0);
    });

    // ───────── ready + queue ─────────

    it("met les commandes en file d'attente tant que le player n'est pas ready", () => {
        bridge.connect();
        bridge.command("playVideo");
        bridge.command("seekTo", [30]);

        expect(posted.some(p => JSON.parse(p.data).func === "playVideo")).toBe(false);

        win.receive({ event: "onReady" });

        const funcs = posted.map(p => JSON.parse(p.data).func);
        expect(funcs).toContain("playVideo");
        expect(funcs).toContain("seekTo");
    });

    it("émet Ready une seule fois", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type), { types: [YouTubeBridgeEvent.Ready] });

        bridge.connect();
        win.receive({ event: "onReady" });
        win.receive({ event: "onReady" });
        win.receive({ event: "initialDelivery", info: {} });

        expect(received).toEqual([YouTubeBridgeEvent.Ready]);
    });

    // ───────── états ─────────

    it("traduit correctement les états du player", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type));

        bridge.connect();
        win.receive({ event: "onReady" });

        win.receive({ event: "onStateChange", info: 1 }); // play
        win.receive({ event: "onStateChange", info: 2 }); // pause
        win.receive({ event: "onStateChange", info: 3 }); // buffering
        win.receive({ event: "onStateChange", info: 0 }); // ended

        expect(received).toEqual(expect.arrayContaining([
            YouTubeBridgeEvent.VideoPlay,
            YouTubeBridgeEvent.VideoPause,
            YouTubeBridgeEvent.VideoBuffering,
            YouTubeBridgeEvent.VideoEnded,
            YouTubeBridgeEvent.StateChange
        ]));
    });

    // ───────── infoDelivery ─────────

    it("émet TimeUpdate et DurationChange", () => {
        const received = [];
        bridge.subscribe(e => received.push(e));

        bridge.connect();
        win.receive({ event: "onReady" });

        win.receive({
            event: "infoDelivery",
            info: { currentTime: 12.5, duration: 180 }
        });

        const timeEvent = received.find(e => e.type === YouTubeBridgeEvent.TimeUpdate);
        const durationEvent = received.find(e => e.type === YouTubeBridgeEvent.DurationChange);

        expect(timeEvent).toEqual({
            type: YouTubeBridgeEvent.TimeUpdate,
            time: 12.5,
            duration: 180
        });
        expect(durationEvent.duration).toBe(180);
    });

    it("n'émet VolumeChange / MuteChange que lorsque la valeur change", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type), {
            types: [YouTubeBridgeEvent.VolumeChange, YouTubeBridgeEvent.MuteChange]
        });

        bridge.connect();
        win.receive({ event: "onReady" });

        // première fois
        win.receive({ event: "infoDelivery", info: { volume: 50, muted: false } });
        // même valeurs → pas d'événement
        win.receive({ event: "infoDelivery", info: { volume: 50, muted: false } });
        // changement
        win.receive({ event: "infoDelivery", info: { volume: 80, muted: true } });

        expect(received).toEqual([
            YouTubeBridgeEvent.VolumeChange,
            YouTubeBridgeEvent.MuteChange,
            YouTubeBridgeEvent.VolumeChange,
            YouTubeBridgeEvent.MuteChange
        ]);
    });

    it("émet VideoChange seulement quand la vidéo change vraiment", () => {
        const received = [];
        bridge.subscribe(e => received.push(e), { types: [YouTubeBridgeEvent.VideoChange] });

        bridge.connect();
        win.receive({ event: "onReady" });

        win.receive({
            event: "infoDelivery",
            info: { videoData: { video_id: "abc", title: "Titre", author: "Auteur" } }
        });
        // même vidéo
        win.receive({
            event: "infoDelivery",
            info: { videoData: { video_id: "abc", title: "Titre", author: "Auteur" } }
        });

        expect(received).toHaveLength(1);
        expect(received[0].videoId).toBe("abc");
    });

    // ───────── sécurité / filtrage ─────────

    it("ignore les messages qui ne viennent pas de l'iframe", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type));

        bridge.connect();
        win.receive({ event: "onReady" }, {}); // mauvais source

        expect(received).toHaveLength(0);
    });

    // ───────── disconnect ─────────

    it("disconnect empêche toute nouvelle notification", () => {
        const received = [];
        bridge.subscribe(e => received.push(e.type));

        bridge.connect();
        bridge.disconnect();
        win.receive({ event: "onReady" });

        expect(received).toHaveLength(0);
    });
});