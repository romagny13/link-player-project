/** Event types sent to subscribers. */
export const OkruBridgeEvent = Object.freeze({
    Ready: "ready",
    StateChange: "stateChange",
    VideoPlay: "videoPlay",
    VideoPause: "videoPause",
    VideoEnded: "videoEnded",
    TimeUpdate: "timeUpdate",
    VolumeChange: "volumeChange",
    MuteChange: "muteChange",
    Error: "error",
    Message: "message"
});

/**
 * @typedef {(
 *   | { type: "ready" }
 *   | { type: "videoPlay" }
 *   | { type: "videoPause" }
 *   | { type: "videoEnded" }
 *   | { type: "timeUpdate", time: number, duration: number }
 *   | { type: "volumeChange", volume: number, muted: boolean|null }
 *   | { type: "muteChange", muted: boolean, volume: number|null }
 *   | { type: "error", message: string }
 *   | { type: "message", name: string, info: object }
 * )} OkruBridgeEventData
 *
 * - volumeChange: the volume level changed. Ok.ru uses 0 to 1 (YouTube uses 0 to 100).
 * - muteChange: the player was muted or unmuted. `volume` is the last level known, or null.
 *   Both events are notified only when the value changes; the first value known after a load is
 *   notified too, so a custom control can initialise itself.
 * - message: every message of the player, as it was received (`name` is its `event`, `info` the whole message).
 *   Delivered only to subscribers that ask for it in `types`.
 *
 * Seen on a real embed: `{ event: "mute" }`, `{ event: "unmute" }`,
 * `{ event: "volumechange", volume: 0.98, muted: false }`.
 */
export class OkruIframeBridge {
    #iframe;
    #window;
    #listeners = new Map(); // onEvent -> Set of event types, or null for every typed event
    #connected = false;
    #ready = false;
    #readySrc = null;
    #queue = [];
    #known = {}; // last notified volume and muted

    constructor(iframe, { window = globalThis } = {}) {
        this.#iframe = iframe;
        this.#window = window;
    }

    /**
     * Adds a subscriber. The same function is never added twice: subscribing it again replaces its filter.
     * @param {(event: OkruBridgeEventData) => void} onEvent
     * @param {object} [options]
     * @param {Iterable<string>} [options.types] OkruBridgeEvent values to receive. Omitted or empty:
     *   every typed event except `message`, which must be asked for explicitly.
     * @returns {() => void} Function that removes this subscriber.
     */
    subscribe(onEvent, { types } = {}) {
        const wanted = types ? new Set(types) : null;
        this.#listeners.set(onEvent, wanted?.size ? wanted : null);
        return () => this.#listeners.delete(onEvent);
    }

    connect() {
        if (this.#connected) return;
        this.#connected = true;
        this.#window.addEventListener("message", this.#onMessage);
        this.#iframe.addEventListener("load", this.#onIframeLoaded);
    }

    disconnect() {
        if (!this.#connected) return;
        this.#connected = false;
        this.#window.removeEventListener("message", this.#onMessage);
        this.#iframe.removeEventListener("load", this.#onIframeLoaded);
        this.#listeners.clear();
    }

    #onIframeLoaded = () => {
        // The player may have announced itself before the `load` event (nested iframes): keep ready unless the src changed.
        if (this.#iframe.src === this.#readySrc) return;
        this.#ready = false;
        this.#known = {};
    };

    #onMessage = (e) => {
        if (e.source !== this.#iframe.contentWindow) return;

        const data = this.#parse(e.data);
        if (!data || !data.event) return;

        this.#emit({ type: OkruBridgeEvent.Message, name: data.event, info: data });

        // Any message proves the player is alive ("inited" may have been sent before we connected).
        this.#markReady();

        switch (data.event) {
            case "started":
            case "resumed":
                this.#emit({ type: OkruBridgeEvent.VideoPlay });
                break;
            case "paused":
                this.#emit({ type: OkruBridgeEvent.VideoPause });
                break;
            case "ended":
                this.#emit({ type: OkruBridgeEvent.VideoEnded });
                break;
            case "timeupdate":
                this.#emit({
                    type: OkruBridgeEvent.TimeUpdate,
                    time: data.time,
                    duration: data.duration
                });
                break;
            case "volumechange":
                this.#handleSound(data);
                break;
            case "mute":
                this.#handleSound({ muted: true });
                break;
            case "unmute":
                this.#handleSound({ muted: false });
                break;
            case "error":
                this.#emit({ type: OkruBridgeEvent.Error, message: data.message });
                break;
        }
    };

    /**
     * `mute` / `unmute` and `volumechange` describe the same state: each value is notified only when it differs
     * from the last one, so a `mute` followed by `volumechange { muted: true }` gives a single muteChange.
     */
    #handleSound({ volume, muted }) {
        const volumeChanged = this.#remember("volume", volume);
        const mutedChanged = this.#remember("muted", muted);
        const sound = {
            volume: this.#known.volume ?? null,
            muted: this.#known.muted ?? null
        };
        if (volumeChanged)
            this.#emit({ type: OkruBridgeEvent.VolumeChange, ...sound });
        if (mutedChanged)
            this.#emit({ type: OkruBridgeEvent.MuteChange, ...sound });
    }

    /** @returns {boolean} true when `value` is present and differs from the last one stored under `name`. */
    #remember(name, value) {
        if (value == null || this.#known[name] === value) return false;
        this.#known[name] = value;
        return true;
    }

    #parse(data) {
        if (!data) return null;
        if (typeof data === "object") return data;
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    #markReady() {
        if (this.#ready) return;
        this.#ready = true;
        this.#readySrc = this.#iframe.src;
        this.#queue.splice(0).forEach((m) => this.send(m));
        this.#emit({ type: OkruBridgeEvent.Ready });
    }

    /** Sends an event to the subscribers that want it; a failing subscriber does not break the others. */
    #emit(event) {
        for (const [onEvent, types] of [...this.#listeners]) {
            const wanted = types
                ? types.has(event.type)
                : event.type !== OkruBridgeEvent.Message;
            if (!wanted) continue;
            try {
                onEvent(event);
            } catch (error) {
                console.error("[OkruIframeBridge] subscriber failed", error);
            }
        }
    }

    command(func, args = null) {
        const message = { method: func, args };
        if (this.#ready) {
            this.send(message);
        } else {
            this.#queue.push(message);
        }
    }

    send(message) {
        this.#iframe.contentWindow?.postMessage(
            typeof message === "string" ? message : JSON.stringify(message),
            this.#getTargetOrigin()
        );
    }

    #getTargetOrigin() {
        try {
            return new URL(this.#iframe.src).origin;
        } catch {
            return "*";
        }
    }
}
