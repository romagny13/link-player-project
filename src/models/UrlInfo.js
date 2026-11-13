export class UrlInfo {
    #kind;
    #videoId;
    #videoIds;
    #playlistId;
    #startSeconds;
    #index;
    #labels;
    #source;

    constructor({
                    kind,
                    videoId,
                    videoIds,
                    playlistId,
                    startSeconds,
                    index,
                    labels,
                    source
                }) {
        this.#kind = kind;
        this.#videoId = videoId;
        this.#videoIds = videoIds;
        this.#playlistId = playlistId;
        this.#startSeconds = startSeconds;
        this.#index = index;
        this.#labels = labels;
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
                    source,
                    autoplay,
                    mute
                }) {
        super({kind, videoId, videoIds, playlistId, startSeconds, index, labels, source});
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