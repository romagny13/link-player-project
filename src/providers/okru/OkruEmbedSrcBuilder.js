/**
 * Builds the src of an Ok.ru iframe.
 * - direct mode: https://ok.ru/videoembed/ID?autoplay=1&fromTime=90
 * - relay mode (relayBaseUrl given): <relayBaseUrl>?videoId=ID&autoplay=1&startSeconds=90&parentOrigin=...
 */
export class OkruEmbedSrcBuilder {
    static #DIRECT_BASE_URL = "https://ok.ru/videoembed";

    #relayBaseUrl;
    #parentOrigin;

    /**
     * @param {{ relayBaseUrl?: string | null, parentOrigin?: string | null }} [options]
     *  parentOrigin defaults to globalThis.location.origin, read at build time.
     */
    constructor({relayBaseUrl = null, parentOrigin = null} = {}) {
        this.#relayBaseUrl = relayBaseUrl;
        this.#parentOrigin = parentOrigin;
    }

    get isRelay() {
        return Boolean(this.#relayBaseUrl);
    }

    /**
     * @param {{ videoId: string, autoplay?: boolean, startSeconds?: number }} params
     * @returns {string}
     */
    build({videoId, autoplay = false, startSeconds} = {}) {
        if (!videoId) throw new TypeError("videoId is required");
        return this.isRelay
            ? this.#buildRelay(videoId, autoplay, startSeconds)
            : this.#buildDirect(videoId, autoplay, startSeconds);
    }

    #buildDirect(videoId, autoplay, startSeconds) {
        const q = new URLSearchParams();
        if (autoplay) q.set("autoplay", "1");
        if (startSeconds > 0) q.set("fromTime", String(Math.floor(startSeconds)));

        const s = q.toString();
        return `${OkruEmbedSrcBuilder.#DIRECT_BASE_URL}/${encodeURIComponent(videoId)}${s ? `?${s}` : ""}`;
    }

    #buildRelay(videoId, autoplay, startSeconds) {
        const url = new URL(this.#relayBaseUrl);
        url.searchParams.set("videoId", videoId);
        if (autoplay) url.searchParams.set("autoplay", "1");
        if (startSeconds > 0) url.searchParams.set("startSeconds", String(Math.floor(startSeconds)));

        const origin = this.#parentOrigin ?? globalThis.location?.origin;
        if (origin) url.searchParams.set("parentOrigin", origin);
        return url.href;
    }
}