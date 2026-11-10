import {ValueChecks} from "../utils/ValueChecks.js";

export class VideoListInfo {
    #key;
    #provider;
    #target;
    #videoIds;
    #index;
    #showOnInit;
    #videos = [];

    constructor(provider, target, videoIds, index, showOnInit) {
        ValueChecks.requireNotNullOrEmpty(provider, "provider");
        ValueChecks.requireNotNullOrEmpty(target, "target");

        this.#provider = provider;
        this.#target = target;
        this.#videoIds = videoIds;
        this.#index = index;
        this.#showOnInit = showOnInit;

        this.#key = `${this.#provider}:list:${this.#videoIds.join(",")}`;
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

    addVideo(video) {
        this.#videos.push(video);
    }

    setVideos(videos) { this.#videos = [...videos]; }
}