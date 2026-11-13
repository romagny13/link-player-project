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
