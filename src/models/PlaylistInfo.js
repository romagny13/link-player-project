import {ValueChecks} from "../utils/ValueChecks.js";

export class PlaylistInfo {
    #key;
    #provider;
    #target;
    #playlistId;
    #videoId;
    #showOnInit;
    #videos = [];
    #extra;
    #source;

    constructor(
        provider,
        target,
        playlistId,
        videoId,
        showOnInit,
        key,
        extra,
        source
    ) {
        ValueChecks.requireNotNullOrEmpty(provider, "provider");
        ValueChecks.requireNotNullOrEmpty(target, "target");
        ValueChecks.requireNotNullOrEmpty(playlistId, "playlistId");

        this.#provider = provider;
        this.#target = target;
        this.#playlistId = playlistId;
        this.#videoId = videoId;
        this.#showOnInit = showOnInit;
        this.#extra = extra;
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
