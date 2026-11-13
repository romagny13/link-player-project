import {ValueChecks} from "../utils/ValueChecks.js";

export class VideoListInfo {
    #key;
    #provider;
    #target;
    #videoIds;
    #index;
    #showOnInit;
    #videos = [];
    #extra;
    #source;

    constructor({
                    provider,
                    target,
                    videoIds,
                    index,
                    showOnInit,
                    key,
                    extra,
                    source
                }) {
        ValueChecks.requireNotNullOrEmpty(provider, "provider");
        ValueChecks.requireNotNullOrEmpty(target, "target");

        this.#provider = provider;
        this.#target = target;
        this.#videoIds = videoIds;
        this.#index = index;
        this.#showOnInit = showOnInit;
        this.#videoIds = [...videoIds];
        this.#extra = extra;
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

    get videos() {
        return Object.freeze([...this.#videos]);
    }

    get extra() {
        return this.#extra;
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
