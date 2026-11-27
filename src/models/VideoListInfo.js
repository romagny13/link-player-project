import {ValueChecks} from "../utils/ValueChecks.js";
import {FORMATS, toBoolean, toFormat} from "../utils/helpers.js";

export class VideoListInfo {
    #key;
    #provider;
    #target;
    #videoIds;
    #index;
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
                    videoIds,
                    index,
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
        ValueChecks.requireNotNullOrEmpty(videoIds, "videoIds");

        this.#provider = provider;
        this.#target = target;
        this.#index = index;
        this.#showOnInit = showOnInit;
        this.#autoplay = autoplay;
        this.#videoIds = [...videoIds];
        this.#extra = extra;
        this.#format = toFormat(format) ?? FORMATS.LANDSCAPE;
        this.#mute = toBoolean(mute);
        this.#source = source;

        this.#key = key ?? `${this.#provider}:list:${this.#videoIds.join(",")}`;
    }

    get key() {
        return this.#key;
    }

    get provider() {
        return this.#provider;
    }

    get target() {
        return this.#target;
    }

    get isPlaylist() {
        return true;
    }

    get videoIds() {
        return Object.freeze([...this.#videoIds]);
    }

    get index() {
        return this.#index;
    }

    get showOnInit() {
        return this.#showOnInit;
    }

    get autoplay() {
        return this.#autoplay;
    }

    get videos() {
        return Object.freeze([...this.#videos]);
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
