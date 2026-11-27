import {ValueChecks} from "../utils/ValueChecks.js";
import {FORMATS, toBoolean, toFormat} from "../utils/helpers.js";

export class PlaylistInfo {
    #key;
    #provider;
    #target;
    #playlistId;
    #videoId;
    #showOnInit;
    #autoplay;
    #videos = [];
    #extra;
    #format;
    #mute;
    #source;

    constructor({
                    provider,
                    target,
                    playlistId,
                    videoId,
                    showOnInit,
                    autoplay,
                    key,
                    extra,
                    format,
                    mute,
                    source
                }) {
        ValueChecks.requireNotNullOrEmpty(provider, "provider");
        ValueChecks.requireNotNullOrEmpty(target, "target");
        ValueChecks.requireNotNullOrEmpty(playlistId, "playlistId");

        this.#provider = provider;
        this.#target = target;
        this.#playlistId = playlistId;
        this.#videoId = videoId;
        this.#showOnInit = showOnInit;
        this.#autoplay = autoplay;
        this.#extra = extra;
        this.#format = toFormat(format) ?? FORMATS.LANDSCAPE;
        this.#mute = toBoolean(mute);
        this.#source = source;

        this.#key = key ?? `${this.#provider}:playlist:${this.#playlistId}`;
    }

    get key() {
        return this.#key;
    }

    get isPlaylist() {
        return true;
    }

    get provider() {
        return this.#provider;
    }

    get target() {
        return this.#target;
    }

    get playlistId() {
        return this.#playlistId;
    }

    get videoId() {
        return this.#videoId;
    }

    get videos() {
        return Object.freeze([...this.#videos]);
    }

    get showOnInit() {
        return this.#showOnInit;
    }

    get autoplay() {
        return this.#autoplay;
    }

    get extra() {
        return this.#extra;
    }

    get format() {
        return this.#format;
    }

    get mute() {
        return this.#mute;
    }

    get source() {
        return this.#source;
    }

    addVideo(video) {
        this.#videos.push(video);
    }

    setVideos(videos) {
        this.#videos = [...videos];
    }
}
