import {ValueChecks} from "../utils/ValueChecks.js";
import {FORMATS, isEmpty, toBoolean, toFormat} from "../utils/helpers.js";

export class VideoInfo {
    #key;
    #provider;
    #target;
    #videoId;
    #autoplay;
    #startSeconds;
    #title;
    #description;
    #channel;
    #channelUrl;
    #thumbnail;
    #duration;
    #showOnInit;
    #extra;
    #format;
    #mute;
    #source; //  { url?, element?, kind }

    constructor({
                    provider,
                    target,
                    videoId,
                    autoplay,
                    startSeconds,
                    title,
                    description,
                    channel,
                    channelUrl,
                    thumbnail,
                    duration,
                    showOnInit,
                    key,
                    extra,
                    format,
                    mute,
                    source
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
        this.#description = description;
        this.#channel = channel;
        this.#channelUrl = channelUrl;
        this.#thumbnail = thumbnail;
        this.#duration = duration;
        this.#showOnInit = showOnInit;
        this.#extra = extra;
        this.#format = toFormat(format) ?? FORMATS.LANDSCAPE;
        this.#mute = toBoolean(mute);
        this.#source = source;

        this.#key = key ?? `${this.#provider}:${this.#videoId}`;
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

    get description() {
        return this.#description;
    }

    get channel() {
        return this.#channel;
    }

    get channelUrl() {
        return this.#channelUrl;
    }

    get thumbnail() {
        return this.#thumbnail;
    }

    get duration() {
        return this.#duration;
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

    get showOnInit() {
        return this.#showOnInit;
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

    fillMissing({title, description, channel, channelUrl, thumbnail, duration} = {}) {
        let changed = false;
        if (isEmpty(this.#title) && title) {
            this.#title = title;
            changed = true;
        }
        if (isEmpty(this.#description) && description) {
            this.#description = description;
            changed = true;
        }
        if (isEmpty(this.#channel) && channel) {
            this.#channel = channel;
            changed = true;
        }
        if (isEmpty(this.#channelUrl) && channelUrl) {
            this.#channelUrl = channelUrl;
            changed = true;
        }
        if (isEmpty(this.#thumbnail) && thumbnail) {
            this.#thumbnail = thumbnail;
            changed = true;
        }
        if (isEmpty(this.#duration) && duration) {
            this.#duration = duration;
            changed = true;
        }
        return changed;
    }
}
