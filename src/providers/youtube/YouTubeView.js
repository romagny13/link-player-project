import {MediaView} from "../../views/MediaView.js";
import {VideoInfo} from "../../models/VideoInfo.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";
import {PlaylistInfo} from "../../models/PlaylistInfo.js";
import {YouTubeIframeBridge, YouTubeBridgeEvent} from "./YouTubeIframeBridge.js";

/**
 * A YouTube iframe + its bridge. The iframe is created once (src), then driven with API commands:
 * loading another video does NOT replace the iframe. An existing iframe can be adopted (`iframe` option).
 */
export class YouTubeView extends MediaView {
    kind = "youtube";
    togglePosition = "bottom-left";

    #builder;
    #createIframe;
    #bridge = null;

    /**
     * @param {YouTubeEmbedSrcBuilder} options.builder
     * @param {(src: string) => HTMLIFrameElement} [options.createIframe] Required unless an iframe is adopted.
     * @param {HTMLIFrameElement} [options.iframe] An existing iframe to adopt.
     */
    constructor({builder, createIframe = null, iframe = null}) {
        super();
        this.#builder = builder;
        this.#createIframe = createIframe;
        if (iframe) {
            this.#prepareAdopted(iframe);
            this.#attach(iframe, false);
        }
    }

    get canMute() { return true; }

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
        } catch {
        }
    }

    load(info, {autoplay = false, index = 0} = {}) {
        const verb = autoplay ? "load" : "cue";
        if (!this.root) {
            this.#attach(this.#createIframe(this.#src(info, {autoplay, index})), true);
            if (index > 0) {
                if (info instanceof VideoListInfo) this.#bridge.command(`${verb}Playlist`, [info.videoIds, index, 0]);
                else if (info instanceof PlaylistInfo)
                    this.#bridge.command(`${verb}Playlist`, [{list: info.playlistId, listType: "playlist", index, startSeconds: 0}]);
            }
            return;
        }
        this.#bridge.resetState();
        if (info instanceof VideoInfo) this.#bridge.command(`${verb}VideoById`, [info.videoId, info.startSeconds ?? 0]);
        else if (info instanceof VideoListInfo) this.#bridge.command(`${verb}Playlist`, [info.videoIds, index, 0]);
        else if (info instanceof PlaylistInfo)
            this.#bridge.command(`${verb}Playlist`, [{
                list: info.playlistId, listType: "playlist",
                index: index || this.#indexOfStartVideo(info), startSeconds: 0
            }]);
        else throw new Error("Invalid operation: VideoInfo, VideoListInfo or PlaylistInfo expected.");
        if (info.mute) this.mute();
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

    seekTo(seconds, {play = true} = {}) {
        this.#bridge?.command("seekTo", [seconds, true]);
        if (play) this.#bridge?.command("playVideo");
    }

    /** One postMessage, the iframe is kept. Without autoplay the item is only cued. */
    selectItem(info, index, {autoplay = true} = {}) {
        if (autoplay) return this.playAt(index);
        if (info instanceof VideoListInfo) this.#bridge?.command("cuePlaylist", [info.videoIds, index, 0]);
        else if (info instanceof PlaylistInfo)
            this.#bridge?.command("cuePlaylist", [{list: info.playlistId, listType: "playlist", index, startSeconds: 0}]);
    }

    mute() { this.#bridge?.command("mute"); }
    unmute() { this.#bridge?.command("unMute"); }   // "unMute" avec un M majuscule
    setVolume(volume) { this.#bridge?.command("setVolume", [Math.round(volume * 100)]); }

    dispose() {
        this.#bridge?.disconnect();
        this.#bridge = null;
        super.dispose();
    }

    #attach(iframe, owned) {
        this.setRoot(iframe, owned);
        this.#bridge = new YouTubeIframeBridge(iframe);
        this.#bridge.subscribe((e) => this.#onBridgeEvent(e), {
            types: [
                YouTubeBridgeEvent.PlaylistIndexChange, YouTubeBridgeEvent.VideoEnded,
                YouTubeBridgeEvent.VideoPlay, YouTubeBridgeEvent.VideoPause,
                YouTubeBridgeEvent.MuteChange, YouTubeBridgeEvent.VolumeChange,
                YouTubeBridgeEvent.Error
            ]
        });
        this.#bridge.connect();
    }

    #onBridgeEvent(e) {
        switch (e.type) {
            case YouTubeBridgeEvent.PlaylistIndexChange:
                return this.emit({type: "itemChange", index: e.index});
            case YouTubeBridgeEvent.VideoPlay:
                return this.emit({type: "state", state: "playing"});
            case YouTubeBridgeEvent.VideoPause:
                return this.emit({type: "state", state: "paused"});
            case YouTubeBridgeEvent.VideoEnded:
                return this.emit({type: "state", state: "ended"});
            case YouTubeBridgeEvent.VolumeChange:
            case YouTubeBridgeEvent.MuteChange: return this.emit({
                type: "sound",
                muted: e.muted,
                volume: e.volume == null ? null : e.volume / 100
            });
            case YouTubeBridgeEvent.Error:
                return this.emit({type: "error", error: new Error(`YouTube player error ${e.code}`)});
        }
    }

    #src(info, {autoplay, index}) {
        if (info instanceof VideoInfo)
            return this.#builder.buildVideoSrc(info.videoId, {autoplay, startSeconds: info.startSeconds, mute: info.mute});
        if (info instanceof VideoListInfo)
            return this.#builder.buildVideoListSrc(info.videoIds, {autoplay, index, mute: info.mute});
        if (info instanceof PlaylistInfo)
            return this.#builder.buildPlaylistSrc(info.playlistId, {autoplay, videoId: info.videoId, mute: info.mute});
        throw new Error("Invalid operation: VideoInfo, VideoListInfo or PlaylistInfo expected.");
    }

    /** Position of the starting video among the fallback videos (data-videos), 0 when unknown. */
    #indexOfStartVideo(info) {
        return Math.max(0, info.videos.findIndex((v) => v.videoId === info.videoId));
    }
}
