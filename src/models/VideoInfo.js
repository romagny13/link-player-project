import {ValueChecks} from '../utils/ValueChecks.js';
import {isEmpty} from "../utils/helpers.js";

export class VideoInfo {
    #key;
    #provider;
    #target;
    #videoId;
    #autoplay;
    #startSeconds;
    #title;
    #channel;
    #thumbnail;
    #showOnInit;

    constructor({
                    provider,
                    target,
                    videoId,
                    autoplay,
                    startSeconds,
                    title,
                    channel,
                    thumbnail,
                    showOnInit
                }) {
        ValueChecks.requireNotNullOrEmpty(provider, "provider");
        ValueChecks.requireNotNullOrEmpty(target, "target");
        ValueChecks.requireNotNullOrEmpty(videoId, "videoId");

        this.#provider = provider;
        this.#target = target;
        this.#videoId = videoId;
        this.#autoplay = autoplay;
        this.#startSeconds = startSeconds;
        this.#title = title;
        this.#channel = channel;
        this.#thumbnail = thumbnail;
        this.#showOnInit = showOnInit;

        this.#key = `${this.#provider}:${this.#videoId}`;
    }

    get key() {
        return this.#key;
    }

    get isPlaylist() {
        return false;
    }

    get provider() {
        return this.#provider;
    }

    get target() {
        return this.#target;
    }

    get title() {
        return this.#title;
    }

    get channel() {
        return this.#channel;
    }

    get thumbnail() {
        return this.#thumbnail;
    }

    get videoId() {
        return this.#videoId;
    }

    get autoplay() {
        return this.#autoplay;
    }

    get startSeconds() {
        return this.#startSeconds;
    }

    get showOnInit(){
        return this.#showOnInit;
    }

    fillMissing({title, channel, thumbnail} = {}) {
        let changed = false;
        if (isEmpty(this.#title) && title) { this.#title = title; changed = true; }
        if (isEmpty(this.#channel) && channel) { this.#channel = channel; changed = true; }
        if (isEmpty(this.#thumbnail) && thumbnail) { this.#thumbnail = thumbnail; changed = true; }
        return changed;
    }

}

