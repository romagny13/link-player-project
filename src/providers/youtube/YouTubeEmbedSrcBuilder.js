export class YouTubeEmbedSrcBuilder {
    static #BASE_URL = "https://www.youtube.com/embed";

    #enablejsapi;
    #origin;

    constructor({enablejsapi = false, origin = globalThis.location?.origin} = {}) {
        this.#enablejsapi = Boolean(enablejsapi);
        this.#origin = origin && origin !== "null" ? origin : null; // "null" = file:// pages
    }

    get enablejsapi() {
        return this.#enablejsapi;
    }

    get origin() {
        return this.#origin;
    }

    // IFRAME
    // src="https://www.youtube.com/embed/OKmD6fS0P_I?si=wulUtSQlodRUnwvL&start=120"
    // SRC => src="https://www.youtube.com/embed
    // - videoId (MANDATORY) in the path src="https://www.youtube.com/embed/${videoId}"
    // - start (OPTIONAL) time in seconds
    // - autoplay (OPTIONAL) (1 to play) requires mute=1 otherwise it won't start
    buildVideoSrc(videoId, {autoplay, startSeconds} = {}) {
        if (!videoId) throw new TypeError("buildVideoSrc(): videoId is required");
        const q = this.#params({autoplay, startSeconds});
        return this.#url(encodeURIComponent(videoId), q);
    }

    // IFRAME
    // src="https://www.youtube.com/embed/3HSKp9pVMKY?playlist=3HSKp9pVMKY,m_luzarfbbM,p8yXdbwFNgc&start=120&index=2&autoplay=1&mute=1"
    // src="https://www.youtube.com/embed/?playlist=3HSKp9pVMKY,m_luzarfbbM,p8yXdbwFNgc&index=2"
    // - videoId in the path (with or without)
    // - playlist (MANDATORY) comma-separated series of videoIds
    // - start (OPTIONAL) time in seconds
    // - index (OPTIONAL, 1-based) used only if no videoId
    // - autoplay (OPTIONAL) (1 to play) requires mute=1 otherwise it won't start
    buildVideoListSrc(videoIds, {autoplay, index, startSeconds} = {}) {
        if (!Array.isArray(videoIds) || !videoIds.length)
            throw new TypeError("buildVideoListSrc(): a non-empty array is required");

        const q = this.#params({autoplay, startSeconds});
        q.set("playlist", videoIds.join(","));
        // if (index > 0) {
        //     q.set("index", String(Math.floor(index) + 1));
        //     return this.#url("", q);
        // }
        return this.#url(encodeURIComponent(videoIds[0]), q);
    }

    // IFRAME
    // src="https://www.youtube.com/embed/videoseries?list=PLfO5yE9Cc3wo"
    // src="https://www.youtube.com/embed/m_luzarfbbM?list=PLfO5yE9Cc3wo"
    // - videoId (OPTIONAL) in the path, otherwise videoseries
    // - list (MANDATORY) with the playlistId
    // - autoplay (OPTIONAL) (1 to play) requires mute=1 otherwise it won't start
    buildPlaylistSrc(playlistId, {autoplay, videoId} = {}) {
        if (!playlistId) throw new TypeError("buildPlaylistSrc(): playlistId is required");

        const q = this.#params({autoplay});
        q.set("list", playlistId);
        return this.#url(videoId ? encodeURIComponent(videoId) : "videoseries", q);
    }

    #params({autoplay, startSeconds} = {}) {
        const q = new URLSearchParams();
        if (this.#enablejsapi) {
            q.set("enablejsapi", "1");
            if (this.#origin) q.set("origin", this.#origin);
        }
        if (autoplay) q.set("autoplay", "1");
        if (startSeconds > 0) q.set("start", String(Math.floor(startSeconds)));
        return q;
    }

    #url(path, q) {
        const s = q.toString();
        return `${YouTubeEmbedSrcBuilder.#BASE_URL}/${path}${s ? `?${s}` : ""}`;
    }

}