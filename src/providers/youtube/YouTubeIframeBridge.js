/** Event types sent to subscribers. */
export const YouTubeBridgeEvent = Object.freeze({
    Ready: "ready",
    StateChange: "stateChange",
    VideoPlay: "videoPlay",
    VideoPause: "videoPause",
    VideoBuffering: "videoBuffering",
    VideoEnded: "videoEnded",
    TimeUpdate: "timeUpdate",
    DurationChange: "durationChange",
    PlaylistIndexChange: "playlistIndexChange",
    VideoChange: "videoChange",
    VolumeChange: "volumeChange",
    MuteChange: "muteChange",
    RateChange: "rateChange",
    QualityChange: "qualityChange",
    Error: "error",
    Message: "message",
});

export class YouTubeIframeBridge {
    #iframe;
    #window;
    #listeners = new Map(); // onEvent -> Set of event types, or null for every typed event
    #connected = false;
    #ready = false;
    #queue = [];
    #lastIndex = null;
    #known = {};

    constructor(iframe, {window = globalThis} = {}) {
        this.#iframe = iframe;
        this.#window = window;
    }

    subscribe(onEvent, {types} = {}) {
        const wanted = types ? new Set(types) : null;
        this.#listeners.set(onEvent, wanted?.size ? wanted : null);
        return () => this.#listeners.delete(onEvent);
    }

    connect() {
        if (this.#connected) return;
        this.#connected = true;
        this.#window.addEventListener("message", this.#onMessage);
        this.#iframe.addEventListener("load", this.#onIframeLoaded);
        this.#handshake(); // the iframe may already be loaded
    }

    disconnect() {
        if (!this.#connected) return;
        this.#connected = false;
        this.#window.removeEventListener("message", this.#onMessage);
        this.#iframe.removeEventListener("load", this.#onIframeLoaded);
        this.#queue.length = 0;
        this.#listeners.clear();
    }

    command(func, args = []) {
        const message = {event: "command", func, args};
        if (this.#ready) this.send(message);
        else this.#queue.push(message);
    }

    send(message) {
        this.#iframe.contentWindow?.postMessage(
            JSON.stringify(message),
            this.#getTargetOrigin()
        );
    }

    // ───────── internals ─────────

    /** Tells the player to start sending messages to this page. */
    #handshake() {
        this.send({event: "listening", id: 1, channel: "widget"});
    }

    /** Arrow function: `this` must stay the bridge when used as an event listener. */
    #onMessage = (e) => {
        if (e.source !== this.#iframe.contentWindow) return;

        const d = this.#parse(e.data);
        if (!d?.event) return;

        this.#emit({
            type: YouTubeBridgeEvent.Message,
            name: d.event,
            info: d.info
        });
        switch (d.event) {
            case "onReady":
                this.#markReady();
                break;
            case "initialDelivery":
                this.#markReady();
                this.#handleDelivery(d.info);
                break;
            case "infoDelivery":
                this.#handleDelivery(d.info);
                break;
            case "onStateChange":
                this.#handleState(d.info);
                break;
            case "onError":
                this.#emit({type: YouTubeBridgeEvent.Error, code: d.info});
                break;
        }
    };

    #onIframeLoaded = () => {
        this.#ready = false;
        this.#handshake();
    };

    #handleState(state) {
        this.#emit({type: YouTubeBridgeEvent.StateChange, state});
        switch (state) {
            case 1: // playing
                this.#emit({type: YouTubeBridgeEvent.VideoPlay});
                break;
            case 2: // paused
                this.#emit({type: YouTubeBridgeEvent.VideoPause});
                break;
            case 3: // buffering
                this.#emit({type: YouTubeBridgeEvent.VideoBuffering});
                break;
            case 0: // ended
                this.#emit({
                    type: YouTubeBridgeEvent.VideoEnded
                });
                break;
            // -1 (unstarted) and 5 (cued) only produce stateChange
        }
    }

    #handleDelivery(info = {}) {
        if (info.playerState)
            this.#handleState(info.playerState);

        if (info.currentTime) {
            this.#emit({
                type: YouTubeBridgeEvent.TimeUpdate,
                time: info.currentTime,
                duration: info.duration
            });
        }

        if (info.duration) {
            this.#emit({
                type: YouTubeBridgeEvent.DurationChange,
                duration: info.duration
            });
        }

        if (info.playlistIndex != null)
            console.log("playlistIndexChanged => ", info?.playlistIndex);
        if (info.playlistIndex != null && info.playlistIndex !== this.#lastIndex) {
            this.#lastIndex = info.playlistIndex;
            this.#emit({
                type: YouTubeBridgeEvent.PlaylistIndexChange,
                index: info.playlistIndex
            });
        }

        if (info.videoData?.video_id && this.#remember("videoId", info.videoData.video_id)) {
            this.#emit({
                type: YouTubeBridgeEvent.VideoChange,
                videoId: info.videoData.video_id,
                title: info.videoData.title,
                author: info.videoData.author
            });
        }
        this.#handleSound(info);
        this.#handleRate(info.playbackRate);
        this.#handleQuality(info.playbackQuality);
    }

    /** Volume and mute come together in a delivery; each one is notified on its own change. */
    #handleSound({volume, muted} = {}) {
        const volumeChanged = this.#remember("volume", volume);
        const mutedChanged = this.#remember("muted", muted);
        const sound = {
            volume: this.#known.volume ?? null,
            muted: this.#known.muted ?? null
        };
        if (volumeChanged)
            this.#emit({type: YouTubeBridgeEvent.VolumeChange, ...sound});
        if (mutedChanged)
            this.#emit({type: YouTubeBridgeEvent.MuteChange, ...sound});
    }

    #handleRate(rate) {
        if (this.#remember("rate", rate))
            this.#emit({type: YouTubeBridgeEvent.RateChange, rate});
    }

    #handleQuality(quality) {
        if (this.#remember("quality", quality))
            this.#emit({type: YouTubeBridgeEvent.QualityChange, quality});
    }

    /** Marks the player as ready, sends the queued commands, then notifies `ready`. */
    #markReady() {
        if (this.#ready) return;
        this.#ready = true;
        this.#queue.splice(0).forEach((m) => this.send(m));
        this.#emit({type: YouTubeBridgeEvent.Ready});
    }

    #remember(name, value) {
        if (value == null || this.#known[name] === value) return false;
        this.#known[name] = value;
        return true;
    }

    #emit(event) {
        for (const [onEvent, types] of [...this.#listeners]) {
            const wanted = types
                ? types.has(event.type)
                : event.type !== YouTubeBridgeEvent.Message;
            if (!wanted) continue;
            try {
                onEvent(event);
            } catch (error) {
                console.error("[YouTubeIframeBridge] subscriber failed", error);
            }
        }
    }

    #parse(data) {
        if (typeof data !== "string") return null;
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    #getTargetOrigin() {
        try {
            return new URL(this.#iframe.src).origin;
        } catch {
            return "*";
        }
    }
}


/**
 * @typedef {(
 *   | { type: "ready" }
 *   | { type: "stateChange", state: number }
 *   | { type: "videoPlay" }
 *   | { type: "videoPause" }
 *   | { type: "videoBuffering" }
 *   | { type: "videoEnded", index: number|null }
 *   | { type: "timeUpdate", time: number, duration?: number }
 *   | { type: "durationChange", duration: number }
 *   | { type: "playlistIndexChange", index: number }
 *   | { type: "videoChange", videoId: string, title?: string, author?: string }
 *   | { type: "volumeChange", volume: number, muted: boolean|null }
 *   | { type: "muteChange", volume: number|null, muted: boolean }
 *   | { type: "rateChange", rate: number }
 *   | { type: "qualityChange", quality: string }
 *   | { type: "error", code: number }
 *   | { type: "message", name: string, info: any }
 * )} YouTubeBridgeEventData
 *
 * - ready: the player is ready to receive commands.
 * - stateChange: raw state on every change (-1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued).
 * - videoPlay / videoPause / videoBuffering / videoEnded: shortcuts for the states 1, 2, 3 and 0.
 *   videoEnded is fired for every video of a playlist, including the last one;
 *   `index` is the playlist index, or null when unknown (e.g. a single video).
 * - timeUpdate: playback position, in seconds.
 * - durationChange: the duration of the current video is known or changed, in seconds.
 * - playlistIndexChange: the playing playlist item changed.
 * - videoChange: the current video changed (id, and title / author when the player gives them).
 * - volumeChange: the volume level changed (0-100). `muted` is the current mute state.
 * - muteChange: the player was muted or unmuted. `volume` is the current level.
 * - rateChange: the playback rate changed (1, 1.5, 2...).
 * - qualityChange: the playback quality changed ("small", "medium", "large", "hd720", "hd1080"...).
 * - error: YouTube error code.
 * - message: every message of the player, as it was received (`name` is its `event`). Debugging and
 *   anything not covered above. Delivered only to subscribers that ask for it in `types`.
 *
 * Every value-change event above (index, video, volume, mute, rate, quality, duration) is also
 * notified once for the first value known after a load: a custom control can initialise itself from it.
 * Where the values come from: the `infoDelivery` messages, the only ones read here besides `onReady`,
 * `initialDelivery`, `onStateChange` and `onError`. Seen on a real embed: `volume` and `muted` (always together),
 * `playbackQuality` with `availableQualityLevels` and `preferredQuality`. Not confirmed yet: `playbackRate`,
 * `duration` and `videoData`. Other messages (`apiInfoDelivery`: captions...) are only available as `message`.
 */

/**
 * Bridge between a YouTube iframe (embed URL with `enablejsapi=1`) and the page.
 * Listens to the iframe messages, notifies subscribers and sends commands to the player.
 *
 * @example
 * const bridge = new YouTubeIframeBridge(iframe);
 * // only what is needed
 * const unsubscribe = bridge.subscribe(
 *   (e) => console.log("now playing item", e.index),
 *   { types: [YouTubeBridgeEvent.PlaylistIndexChange] }
 * );
 * // everything typed (no filter)
 * bridge.subscribe((e) => { if (e.type === YouTubeBridgeEvent.MuteChange) console.log(e.muted); });
 * bridge.connect();
 * bridge.command("playVideoAt", [2]);
 *
 * Commands for custom controls: playVideo, pauseVideo, seekTo [seconds, true], setVolume [0-100],
 * mute, unMute, setPlaybackRate [rate], nextVideo, previousVideo, playVideoAt [index].
//  */
// export class YouTubeIframeBridge {
//     #iframe;
//     #window;
//     #listeners = new Map(); // onEvent -> Set of event types, or null for every typed event
//     #connected = false;
//     #ready = false;
//     #queue = [];
//     #lastIndex = null;
//     #lastState = null;
//     #known = {}; // last value of each notified field (volume, muted, rate...), to notify changes only
//
//     /**
//      * @param {HTMLIFrameElement} iframe The YouTube iframe to bridge.
//      * @param {{ window?: Window }} [options] `window` receives the messages (injectable for tests).
//      */
//     constructor(iframe, { window = globalThis } = {}) {
//         this.#iframe = iframe;
//         this.#window = window;
//     }
//
//     /**
//      * Adds a subscriber. The same function is never added twice: subscribing it again replaces its filter.
//      * @param {(event: YouTubeBridgeEventData) => void} onEvent
//      * @param {object} [options]
//      * @param {Iterable<string>} [options.types] YouTubeBridgeEvent values to receive. Omitted or empty:
//      *   every typed event except `message`, which must be asked for explicitly.
//      * @returns {() => void} Function that removes this subscriber.
//      */
//     subscribe(onEvent, { types } = {}) {
//         const wanted = types ? new Set(types) : null;
//         this.#listeners.set(onEvent, wanted?.size ? wanted : null);
//         return () => this.#listeners.delete(onEvent);
//     }
//
//     /**
//      * Starts listening to the iframe and sends the handshake the player needs
//      * before it delivers messages. Does nothing if already connected.
//      */
//     connect() {
//         if (this.#connected) return;
//         this.#connected = true;
//         this.#window.addEventListener("message", this.#onMessage);
//         this.#iframe.addEventListener("load", this.#onIframeLoaded);
//         this.#handshake(); // the iframe may already be loaded
//     }
//
//     /**
//      * Stops listening, drops pending commands and removes all subscribers.
//      * The bridge can be connected again afterwards.
//      */
//     disconnect() {
//         if (!this.#connected) return;
//         this.#connected = false;
//         this.#window.removeEventListener("message", this.#onMessage);
//         this.#iframe.removeEventListener("load", this.#onIframeLoaded);
//         this.#queue.length = 0;
//         this.#listeners.clear();
//     }
//
//     /**
//      * Sends a player API command. Queued until the player is ready.
//      * @param {string} func Command name (playVideo, pauseVideo, playVideoAt, loadVideoById...).
//      * @param {Array} [args] Command arguments.
//      */
//     command(func, args = []) {
//         const message = { event: "command", func, args };
//         if (this.#ready) this.send(message);
//         else this.#queue.push(message);
//     }
//
//     /**
//      * Sends a raw message to the iframe.
//      * @param {object} message Serialized to JSON.
//      */
//     send(message) {
//         this.#iframe.contentWindow?.postMessage(
//             JSON.stringify(message),
//             this.#getTargetOrigin()
//         );
//     }
//
//     resetState() {
//         this.#lastIndex = null;
//         this.#lastState = null;
//         this.#known = {};
//     }
//
//     // ───────── internals ─────────
//
//     /** Tells the player to start sending messages to this page. */
//     #handshake() {
//         this.send({ event: "listening", id: 1, channel: "widget" });
//     }
//
//     /** Arrow function: `this` must stay the bridge when used as an event listener. */
//     #onMessage = (e) => {
//         if (e.source !== this.#iframe.contentWindow) return;
//
//         const d = this.#parse(e.data);
//         if (!d?.event) return;
//
//         this.#emit({
//             type: YouTubeBridgeEvent.Message,
//             name: d.event,
//             info: d.info
//         });
//         switch (d.event) {
//             case "onReady":
//                 this.#markReady();
//                 break;
//             case "initialDelivery":
//                 this.#markReady();
//                 this.#handleDelivery(d.info);
//                 break;
//             case "infoDelivery":
//                 this.#handleDelivery(d.info);
//                 break;
//             case "onStateChange":
//                 this.#handleState(d.info);
//                 break;
//             case "onError":
//                 this.#emit({ type: YouTubeBridgeEvent.Error, code: d.info });
//                 break;
//         }
//     };
//
//     /** Every (re)load of the iframe starts from scratch. */
//     #onIframeLoaded = () => {
//         this.#ready = false;
//         this.#lastIndex = null;
//         this.#lastState = null;
//         this.#known = {};
//         this.#handshake();
//     };
//
//     /**
//      * Notifies a player state. The state can come from `onStateChange` or from
//      * `infoDelivery`: an unchanged state is notified only once.
//      * @param {number} state
//      */
//     #handleState(state) {
//         if (state === this.#lastState) return;
//         this.#lastState = state;
//
//         this.#emit({ type: YouTubeBridgeEvent.StateChange, state });
//         switch (state) {
//             case 1: // playing
//                 this.#emit({ type: YouTubeBridgeEvent.VideoPlay });
//                 break;
//             case 2: // paused
//                 this.#emit({ type: YouTubeBridgeEvent.VideoPause });
//                 break;
//             case 3: // buffering
//                 this.#emit({ type: YouTubeBridgeEvent.VideoBuffering });
//                 break;
//             case 0: // ended
//                 this.#emit({
//                     type: YouTubeBridgeEvent.VideoEnded,
//                     index: this.#lastIndex
//                 });
//                 break;
//             // -1 (unstarted) and 5 (cued) only produce stateChange
//         }
//     }
//
//     /**
//      * Handles the player info. A delivery only holds what changed (plus the time, sent regularly), so a field
//      * that is absent means "unchanged". Each value is notified only when it differs from the last one.
//      * @param {object} [info]
//      */
//     #handleDelivery(info = {}) {
//         if (info.playerState != null) this.#handleState(info.playerState);
//         if (info.currentTime != null)
//             this.#emit({
//                 type: YouTubeBridgeEvent.TimeUpdate,
//                 time: info.currentTime,
//                 duration: info.duration
//             });
//         if (this.#remember("duration", info.duration))
//             this.#emit({
//                 type: YouTubeBridgeEvent.DurationChange,
//                 duration: info.duration
//             });
//         if (info.playlistIndex != null && info.playlistIndex !== this.#lastIndex) {
//             this.#lastIndex = info.playlistIndex;
//             this.#emit({
//                 type: YouTubeBridgeEvent.PlaylistIndexChange,
//                 index: info.playlistIndex
//             });
//         }
//         if (
//             info.videoData?.video_id &&
//             this.#remember("videoId", info.videoData.video_id)
//         )
//             this.#emit({
//                 type: YouTubeBridgeEvent.VideoChange,
//                 videoId: info.videoData.video_id,
//                 title: info.videoData.title,
//                 author: info.videoData.author
//             });
//         this.#handleSound(info);
//         this.#handleRate(info.playbackRate);
//         this.#handleQuality(info.playbackQuality);
//     }
//
//     /** Volume and mute come together in a delivery; each one is notified on its own change. */
//     #handleSound({ volume, muted } = {}) {
//         const volumeChanged = this.#remember("volume", volume);
//         const mutedChanged = this.#remember("muted", muted);
//         const sound = {
//             volume: this.#known.volume ?? null,
//             muted: this.#known.muted ?? null
//         };
//         if (volumeChanged)
//             this.#emit({ type: YouTubeBridgeEvent.VolumeChange, ...sound });
//         if (mutedChanged)
//             this.#emit({ type: YouTubeBridgeEvent.MuteChange, ...sound });
//     }
//
//     #handleRate(rate) {
//         if (this.#remember("rate", rate))
//             this.#emit({ type: YouTubeBridgeEvent.RateChange, rate });
//     }
//
//     #handleQuality(quality) {
//         if (this.#remember("quality", quality))
//             this.#emit({ type: YouTubeBridgeEvent.QualityChange, quality });
//     }
//
//     /** @returns {boolean} true when `value` is present and differs from the last one stored under `name`. */
//     #remember(name, value) {
//         if (value == null || this.#known[name] === value) return false;
//         this.#known[name] = value;
//         return true;
//     }
//
//     /** Marks the player as ready, sends the queued commands, then notifies `ready`. */
//     #markReady() {
//         if (this.#ready) return;
//         this.#ready = true;
//         this.#queue.splice(0).forEach((m) => this.send(m));
//         this.#emit({ type: YouTubeBridgeEvent.Ready });
//     }
//
//     /**
//      * Sends an event to the subscribers that want it. Iterates over a copy, so a subscriber can
//      * unsubscribe while being notified; a failing subscriber does not break the others.
//      * @param {YouTubeBridgeEventData} event
//      */
//     #emit(event) {
//         for (const [onEvent, types] of [...this.#listeners]) {
//             const wanted = types
//                 ? types.has(event.type)
//                 : event.type !== YouTubeBridgeEvent.Message;
//             if (!wanted) continue;
//             try {
//                 onEvent(event);
//             } catch (error) {
//                 console.error("[YouTubeIframeBridge] subscriber failed", error);
//             }
//         }
//     }
//
//     /**
//      * Parses a message payload.
//      * @param {unknown} data
//      * @returns {object|null} null when the payload is not a JSON string.
//      */
//     #parse(data) {
//         if (typeof data !== "string") return null;
//         try {
//             return JSON.parse(data);
//         } catch {
//             return null;
//         }
//     }
//
//     /**
//      * Origin of the iframe, used as the postMessage target (https://www.youtube.com).
//      * Falls back to "*" when the iframe has no valid src.
//      * @returns {string}
//      */
//     #getTargetOrigin() {
//         try {
//             return new URL(this.#iframe.src).origin;
//         } catch {
//             return "*";
//         }
//     }
// }
