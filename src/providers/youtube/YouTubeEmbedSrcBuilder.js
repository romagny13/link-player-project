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

    buildVideoSrc(videoId, {autoplay, startSeconds} = {}) {
        if (!videoId) throw new TypeError("buildVideoSrc(): videoId is required");
        const q = this.#params({autoplay, startSeconds});
        return this.#url(encodeURIComponent(videoId), q);
    }

    buildVideoListSrc(videoIds, {autoplay, index} = {}) {
        if (!Array.isArray(videoIds) || !videoIds.length)
            throw new TypeError("buildVideoListSrc(): a non-empty array is required");

        const [first, ...rest] = videoIds;
        const q = this.#params({autoplay});
        if (rest.length) q.set("playlist", rest.join(","));
        if (index > 0) q.set("index", String(Math.floor(index)));
        return this.#url(encodeURIComponent(first), q);
    }

    buildPlaylistSrc(playlistId, {autoplay, videoId} = {}) {
        if (!playlistId) throw new TypeError("buildPlaylistSrc(): playlistId is required");

        const q = this.#params({autoplay});
        q.set("list", playlistId);
        return this.#url(videoId ? encodeURIComponent(videoId) : "videoseries", q);
    }
}