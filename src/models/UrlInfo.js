export class UrlInfo {
    #kind;
    #videoId;
    #videoIds;
    #playlistId;
    #index;
    #startSeconds;
    #labels;

    constructor({kind, videoId, videoIds, playlistId, index, startSeconds, labels}) {
        this.#kind = kind;
        this.#videoId = videoId;
        this.#videoIds = videoIds;
        this.#playlistId = playlistId;
        this.#index = index;
        this.#startSeconds = startSeconds;
        this.#labels = labels;
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

    get index() {
        return this.#index;
    }

    get startSeconds() {
        return this.#startSeconds;
    }

    get labels() {
        return this.#labels;
    }
}