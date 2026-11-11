import {OkruBridgeEvent, OkruIframeBridge} from "./OkruIframeBridge.js";
import {OkruEmbedSrcBuilder} from "./OkruEmbedSrcBuilder.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";

/**
 * One Ok.ru iframe + its bridge. Ok.ru has no "load" command: loading = changing the src.
 * A list of videos is emulated here: the player moves through the ids, and goes to the next one on `ended`.
 * Same events as YouTubePlayer ("itemChange", "ended").
 */
export class OkruPlayer {
    kind = "okru";

    #createIframe;
    #urlBuilder;
    #iframe = null;
    #bridge = null;
    #owned = false;
    #listeners = new Set();
    /** @type {{ id: string, info: import("../../models/VideoInfo.js").VideoInfo | null }[]} a single video is a list of one */
    #items = [];
    #index = 0;

    /**
     * @param {Object} options
     * @param {(src: string) => HTMLIFrameElement} [options.createIframe] Required unless an iframe is adopted.
     * @param {HTMLIFrameElement} [options.iframe] An existing iframe to adopt.
     * @param {string} [options.embedBaseUrl] Relay page url (ignored if urlBuilder is given).
     * @param {OkruEmbedSrcBuilder} [options.urlBuilder]
     */
    constructor({createIframe = null, iframe = null, embedBaseUrl = null, urlBuilder = null} = {}) {
        this.#createIframe = createIframe;
        this.#urlBuilder = urlBuilder ?? new OkruEmbedSrcBuilder({relayBaseUrl: embedBaseUrl});
        if (iframe) this.#attach(iframe, false);
    }

    get iframe() {
        return this.#iframe;
    }

    subscribe(onEvent) {
        this.#listeners.add(onEvent);
        return () => this.#listeners.delete(onEvent);
    }

    load(info, {autoplay = false, index = 0} = {}) {
        this.#items = info instanceof VideoListInfo
            ? info.videoIds.map((id, i) => ({id, info: info.videos[i] ?? null}))
            : [{id: info.videoId, info}];
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
        const item = this.#items[index];
        if (!item) return; // out of range: nothing to play

        this.#index = index;
        const src = this.#urlBuilder.build({
            videoId: item.id,
            autoplay,
            startSeconds: item.info?.startSeconds
        });

        if (this.#iframe) {
            this.#iframe.src = src;
        } else {
            if (!this.#createIframe) {
                throw new Error("OkruPlayer: createIframe is required when no iframe is adopted");
            }
            this.#attach(this.#createIframe(src), true);
        }

        if (this.#items.length > 1) this.#emit({type: "itemChange", index});
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
                if (this.#index + 1 < this.#items.length) this.next();
                return;
            case OkruBridgeEvent.Error: return this.#emit({type: "error", error: new Error(e.message ?? "Ok.ru player error")});
        }
    }

    #emit(event) {
        for (const listener of [...this.#listeners]) listener(event);
    }
}