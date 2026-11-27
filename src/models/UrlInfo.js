export class UrlInfo {
    #kind;
    #videoId;
    #videoIds;
    #playlistId;
    #startSeconds;
    #index;
    #labels;
    #format;
    #source;

    constructor({
                    kind,
                    videoId,
                    videoIds,
                    playlistId,
                    startSeconds,
                    index,
                    labels,
                    format,
                    source
                }) {
        this.#kind = kind;
        this.#videoId = videoId;
        this.#videoIds = videoIds;
        this.#playlistId = playlistId;
        this.#startSeconds = startSeconds;
        this.#index = index;
        this.#labels = labels;
        this.#format = format;
        this.#source = source;
    }

    get kind() {
        return this.#kind;
    }

    get videoId() {
        return this.#videoId;
    }

    get videoIds() {
        return this.#videoIds;
    }

    get playlistId() {
        return this.#playlistId;
    }

    get startSeconds() {
        return this.#startSeconds;
    }

    get index() {
        return this.#index;
    }

    get labels() {
        return this.#labels;
    }

    get format() {
        return this.#format;
    }

    get source() {
        return this.#source;
    }
}

export class SrcInfo extends UrlInfo {
    #autoplay;
    #mute;

    constructor({
                    kind,
                    videoId,
                    videoIds,
                    playlistId,
                    startSeconds,
                    index,
                    labels,
                    format,
                    source,
                    autoplay,
                    mute
                }) {
        super({kind, videoId, videoIds, playlistId, startSeconds, index, labels, format, source});
        this.#autoplay = autoplay;
        this.#mute = mute;
    }

    get autoplay() {
        return this.#autoplay;
    }

    get mute() {
        return this.#mute;
    }
}