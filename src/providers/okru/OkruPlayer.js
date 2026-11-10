import {OkruBridgeEvent, OkruIframeBridge} from "./OkruIframeBridge.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";

/**
 * One Ok.ru iframe + its bridge. Ok.ru has no "load" command: loading = changing the src.
 * A list of videos is emulated here: the player moves through the ids, and goes to the next one on `ended`.
 * Same events as YouTubePlayer ("itemChange", "ended").
 */
export class OkruPlayer {
    kind = "okru";

    #createIframe;
    #iframe = null;
    #embedBaseUrl = null;
    #bridge = null;
    #owned = false;
    #listeners = new Set();
    #videos = [];
    #ids = [];
    #index = 0;

    /**
     * @param {Object} options
     * @param {(src: string) => HTMLIFrameElement} [options.createIframe] Required unless an iframe is adopted.
     * @param {HTMLIFrameElement} [options.iframe] An existing iframe to adopt.
     */
    constructor({createIframe = null, iframe = null, embedBaseUrl = null} = {}) {
        this.#createIframe = createIframe;
        if (iframe) this.#attach(iframe, false);
        this.#embedBaseUrl = embedBaseUrl;
    }

    get iframe() {
        return this.#iframe;
    }

    subscribe(onEvent) {
        this.#listeners.add(onEvent);
        return () => this.#listeners.delete(onEvent);
    }

    load(info, {autoplay = false, index = 0} = {}) {
        this.#ids = info instanceof VideoListInfo ? [...info.videoIds] : [info.videoId];
        this.#videos = info instanceof VideoListInfo ? [...info.videos] : [info];
        this.#show(index, autoplay);
    }

    play() {
        this.#bridge?.command("play");
    }

    pause() {
        this.#bridge?.command("pause");
    }

    next() {
        this.#show(this.#index + 1, true);
    }

    previous() {
        this.#show(this.#index - 1, true);
    }

    playAt(index) {
        this.#show(index, true);
    }

    dispose() {
        this.#bridge?.disconnect();
        if (this.#owned) this.#iframe?.remove();
        this.#bridge = null;
        this.#iframe = null;
        this.#listeners.clear();
    }

    // ───────── internals ─────────

    #show(index, autoplay) {
        const id = this.#ids[index];
        if (id === undefined) return; // out of range: nothing to play

        this.#index = index;
        const info = this.#videos[index];
        const src = this.#getSrc(id, autoplay, info?.startSeconds);
        if (this.#iframe) this.#iframe.src = src;
        else this.#attach(this.#createIframe(src), true);

        if (this.#ids.length > 1) this.#emit({type: "itemChange", index});
    }

    #getSrc(videoId, autoplay, startSeconds) {
        if (this.#embedBaseUrl) {
            return this.#buildRelaySrc(videoId, autoplay, startSeconds);
        }
        return this.#buildSrc(videoId, autoplay, startSeconds);
    }

    #buildSrc(videoId, autoplay, startSeconds) {
        if (!videoId) throw new TypeError("videoId is required");

        const q = new URLSearchParams();
        if (autoplay) q.set("autoplay", "1");
        if (startSeconds > 0) q.set("fromTime", Math.floor(startSeconds));

        const s = q.toString();
        return `https://ok.ru/videoembed/${encodeURIComponent(videoId)}${
            s ? `?${s}` : ""
        }`;
    }

    #buildRelaySrc(videoId, autoplay, startSeconds) {
        if (!videoId)
            throw new TypeError("buildOkruRelaySrc(): videoId is required");
        const url = new URL(this.#embedBaseUrl);
        url.searchParams.set("videoId", videoId);
        if (autoplay) url.searchParams.set("autoplay", "1");
        if (startSeconds > 0)
            url.searchParams.set("startSeconds", Math.floor(startSeconds));
        const parentOrigin = globalThis.location?.origin;
        if (parentOrigin) url.searchParams.set("parentOrigin", parentOrigin);
        return url.href;
    }

    #attach(iframe, owned) {
        this.#iframe = iframe;
        this.#owned = owned;
        this.#bridge = new OkruIframeBridge(iframe);
        this.#bridge.subscribe((e) => this.#onBridgeEvent(e), {
            types: [OkruBridgeEvent.VideoPlay, OkruBridgeEvent.VideoPause, OkruBridgeEvent.VideoEnded, OkruBridgeEvent.Error]
        });
        this.#bridge.connect();
    }

    #onBridgeEvent(e) {
        switch (e.type) {
            case OkruBridgeEvent.VideoPlay: return this.#emit({type: "state", state: "playing", index: this.#index});
            case OkruBridgeEvent.VideoPause: return this.#emit({type: "state", state: "paused", index: this.#index});
            case OkruBridgeEvent.VideoEnded:
                this.#emit({type: "state", state: "ended", index: this.#index});
                if (this.#index + 1 < this.#ids.length) this.next();
                return;
            case OkruBridgeEvent.Error: return this.#emit({type: "error", error: new Error(e.message ?? "Ok.ru player error")});
        }
    }

    #emit(event) {
        for (const listener of [...this.#listeners]) listener(event);
    }
}