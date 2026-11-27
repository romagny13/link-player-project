import {MediaView} from "../../views/MediaView.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";
import {OkruIframeBridge, OkruBridgeEvent} from "./OkruIframeBridge.js";

/**
 * An Ok.ru iframe + its bridge. Ok.ru has no "load" command: loading = changing the src.
 * A list of videos is emulated here: the view moves through the ids and goes to the next one on `ended`.
 */
export class OkruView extends MediaView {
    kind = "okru";
    togglePosition = "top-right";

    #createIframe;
    #urlBuilder;
    #bridge = null;
    /** @type {{ id: string, info: object|null }[]} a single video is a list of one */
    #items = [];
    #index = 0;

    /**
     * @param {OkruEmbedSrcBuilder} options.urlBuilder
     * @param {(src: string) => HTMLIFrameElement} [options.createIframe] Required unless an iframe is adopted.
     * @param {HTMLIFrameElement} [options.iframe] An existing iframe to adopt.
     */
    constructor({urlBuilder, createIframe = null, iframe = null}) {
        super();
        this.#urlBuilder = urlBuilder;
        this.#createIframe = createIframe;
        if (iframe) this.#attach(iframe, false);
    }

    get canMute() {
        return this.#urlBuilder.supportsMute;
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

    seekTo(seconds, {play = true} = {}) {
        const item = this.#items[this.#index];
        if (!item || !this.root) return;
        this.#bridge.resetState();
        this.root.src = this.#urlBuilder.build({
            videoId: item.id,
            autoplay: play,
            startSeconds: seconds
        });
    }

    dispose() {
        this.#bridge?.disconnect();
        this.#bridge = null;
        super.dispose();
    }

    #show(index, autoplay) {
        const item = this.#items[index];
        if (!item) return;
        this.#index = index;
        const src = this.#urlBuilder.build({
            videoId: item.id,
            autoplay,
            startSeconds: item.info?.startSeconds
        });
        if (this.root) {
            this.#bridge.resetState();
            this.root.src = src;
        } else {
            if (!this.#createIframe) throw new Error("OkruView: createIframe is required when no iframe is adopted");
            this.#attach(this.#createIframe(src), true);
        }
        if (this.#items.length > 1) this.emit({type: "itemChange", index});
    }

    #attach(iframe, owned) {
        this.setRoot(iframe, owned);
        this.#bridge = new OkruIframeBridge(iframe);
        this.#bridge.subscribe((e) => this.#onBridgeEvent(e), {
            types: [OkruBridgeEvent.VideoPlay, OkruBridgeEvent.VideoPause, OkruBridgeEvent.VideoEnded,
                OkruBridgeEvent.MuteChange, OkruBridgeEvent.VolumeChange,
                OkruBridgeEvent.Error]
        });
        this.#bridge.connect();
    }

    #onBridgeEvent(e) {
        switch (e.type) {
            case OkruBridgeEvent.VideoPlay:
                return this.emit({type: "state", state: "playing", index: this.#index});
            case OkruBridgeEvent.VideoPause:
                return this.emit({type: "state", state: "paused", index: this.#index});
            case OkruBridgeEvent.VideoEnded:
                this.emit({type: "state", state: "ended", index: this.#index});
                if (this.#index + 1 < this.#items.length) this.next();
                return;
            case OkruBridgeEvent.VolumeChange:
            case OkruBridgeEvent.MuteChange:
                return this.emit({ type: "sound", muted: e.muted, volume: e.volume });
            case OkruBridgeEvent.Error:
                return this.emit({type: "error", error: new Error(e.message ?? "Ok.ru player error")});
        }
    }
}
