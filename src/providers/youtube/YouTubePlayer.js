import {YouTubeBridgeEvent, YouTubeIframeBridge} from "./YouTubeIframeBridge.js";
import {VideoInfo} from "../../models/VideoInfo.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";
import {PlaylistInfo} from "../../models/PlaylistInfo.js";

/**
 * One YouTube iframe + its bridge. The iframe is created once (src), then driven with API
 * commands: loading another video does NOT replace the iframe.
 * An existing iframe (embed URL with enablejsapi=1) can be adopted: `new YouTubePlayer({builder, iframe})`.
 *
 * Which iframe shows which info is decided by the caller (PlayerContentAdapter): another info means
 * another player (so another iframe); the same info with another item only needs `selectItem` / `playAt`.
 *
 * Events sent to subscribers (same shape for every provider):
 *   { type: "itemChange", index }  the playing item of a playlist / list changed
 *   { type: "state", state, index? } playing / paused / ended
 *   { type: "error", error }
 */
export class YouTubePlayer {
    kind = "youtube";

    #builder;
    #createIframe;
    #iframe = null;
    #bridge = null;
    #owned = false; // true when this player created the iframe (and so removes it)
    #listeners = new Set();
    #loading = false;

    /**
     * @param {Object} options
     * @param {YouTubeEmbedSrcBuilder} options.builder
     * @param {(src: string) => HTMLIFrameElement} [options.createIframe] Required unless an iframe is adopted.
     * @param {HTMLIFrameElement} [options.iframe] An existing iframe to adopt.
     */
    constructor({builder, createIframe = null, iframe = null}) {
        this.#builder = builder;
        this.#createIframe = createIframe;
        if (iframe) {
            this.#prepareAdopted(iframe);
            this.#attach(iframe, false);
        }
    }

    get iframe() {
        return this.#iframe;
    }

    subscribe(onEvent) {
        this.#listeners.add(onEvent);
        return () => this.#listeners.delete(onEvent);
    }


    /** Without enablejsapi the commands would never be sent: the iframe is reloaded once with it. */
    #prepareAdopted(iframe) {
        try {
            const url = new URL(iframe.src);
            const origin = this.#builder.origin;
            let changed = url.searchParams.get("enablejsapi") !== "1";
            url.searchParams.set("enablejsapi", "1");
            if (origin && url.searchParams.get("origin") !== origin) {
                url.searchParams.set("origin", origin);
                changed = true;
            }
            if (changed) iframe.src = url.href;
        } catch { /* invalid src: left as is */
        }
    }

    /**
     * @param {VideoInfo|VideoListInfo|PlaylistInfo} info
     * @param {{autoplay?: boolean, index?: number}} [options] `index`: starting item of a list / playlist.
     */
    load(info, {autoplay = false, index = 0} = {}) {
        this.#loading = true;
        try {
            this.#load(info, {autoplay, index});
        } finally {
            this.#loading = false; // was left to true after reusing an existing iframe: every later event was dropped
        }
    }

    #load(info, {autoplay, index}) {
        const verb = autoplay ? "load" : "cue"; // load* starts playing, cue* does not

        // 1. create the iframe
        if (!this.#iframe) {
            this.#attach(this.#createIframe(this.#src(info, {autoplay, index})), true);
            // index applied only for videoList
            if (index > 0) {
                if (info instanceof VideoListInfo) {
                    this.#bridge.command(`${verb}Playlist`, [info.videoIds, index, 0]);
                } else if (info instanceof PlaylistInfo) {
                    this.#bridge.command(`${verb}Playlist`, [{
                        list: info.playlistId,
                        listType: "playlist",
                        index: index,
                        startSeconds: 0
                    }]);
                }
            }
            return;
        }

        // 2. existing iframe
        this.#bridge.resetState(); // the first values after a load are notified again

        if (info instanceof VideoInfo) {
            this.#bridge.command(`${verb}VideoById`, [info.videoId, info.startSeconds ?? 0]);
        } else if (info instanceof VideoListInfo) {
            this.#bridge.command(`${verb}Playlist`, [info.videoIds, index, 0]);
        } else if (info instanceof PlaylistInfo) {
            this.#bridge.command(`${verb}Playlist`, [{
                list: info.playlistId,
                listType: "playlist",
                index: index || this.#indexOfStartVideo(info),
                startSeconds: 0
            }]);
        } else {
            this.#invalid();
        }
    }

    play() {
        this.#bridge?.command("playVideo");
    }

    pause() {
        this.#bridge?.command("pauseVideo");
    }

    next() {
        this.#bridge?.command("nextVideo");
    }

    previous() {
        this.#bridge?.command("previousVideo");
    }

    playAt(index) {
        this.#bridge?.command("playVideoAt", [index]);
    }

    /**
     * Another item of the list / playlist that is already loaded: one postMessage, the iframe is kept.
     * Without autoplay the item is only cued.
     */
    selectItem(info, index, {autoplay = true} = {}) {
        if (autoplay) return this.playAt(index);
        if (info instanceof VideoListInfo) {
            this.#bridge?.command("cuePlaylist", [info.videoIds, index, 0]);
        } else if (info instanceof PlaylistInfo) {
            this.#bridge?.command("cuePlaylist", [{
                list: info.playlistId,
                listType: "playlist",
                index,
                startSeconds: 0
            }]);
        }
    }

    dispose() {
        this.#bridge?.disconnect();
        if (this.#owned) this.#iframe?.remove();
        this.#bridge = null;
        this.#iframe = null;
        this.#listeners.clear();
    }

    // ───────── internals ─────────

    #attach(iframe, owned) {
        this.#iframe = iframe;
        this.#owned = owned;
        this.#bridge = new YouTubeIframeBridge(iframe);
        this.#bridge.subscribe((e) => this.#onBridgeEvent(e), {
            types: [
                YouTubeBridgeEvent.PlaylistIndexChange,
                YouTubeBridgeEvent.VideoEnded,
                YouTubeBridgeEvent.VideoPlay,
                YouTubeBridgeEvent.VideoPause,
                YouTubeBridgeEvent.Error
            ]
        });
        this.#bridge.connect();
    }

    #onBridgeEvent(e) {
        if (this.#loading)
            return;

        switch (e.type) {
            case YouTubeBridgeEvent.PlaylistIndexChange:
                return this.#emit({type: "itemChange", index: e.index});
            case YouTubeBridgeEvent.VideoPlay:
                return this.#emit({type: "state", state: "playing"});
            case YouTubeBridgeEvent.VideoPause:
                return this.#emit({type: "state", state: "paused"});
            case YouTubeBridgeEvent.VideoEnded:
                return this.#emit({type: "state", state: "ended", index: e.index});
            case YouTubeBridgeEvent.Error:
                return this.#emit({type: "error", error: new Error(`YouTube player error ${e.code}`)});
        }
    }

    #emit(event) {
        for (const listener of [...this.#listeners]) listener(event);
    }

    #src(info, {autoplay, index}) {
        if (info instanceof VideoInfo)
            return this.#builder.buildVideoSrc(info.videoId, {autoplay, startSeconds: info.startSeconds});
        if (info instanceof VideoListInfo)
            return this.#builder.buildVideoListSrc(info.videoIds, {autoplay, index});
        if (info instanceof PlaylistInfo)
            return this.#builder.buildPlaylistSrc(info.playlistId, {autoplay, videoId: info.videoId});
        return this.#invalid();
    }

    /** Position of the starting video among the fallback videos (data-videos), 0 when unknown. */
    #indexOfStartVideo(info) {
        return Math.max(0, info.videos.findIndex((v) => v.videoId === info.videoId));
    }

    #invalid() {
        throw new Error("Invalid operation: VideoInfo, VideoListInfo or PlaylistInfo expected.");
    }
}