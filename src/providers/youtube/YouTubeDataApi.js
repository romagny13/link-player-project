export class YouTubeApiError extends Error {
    constructor(status, reason) {
        super(`YouTube API ${status}${reason ? ` (${reason})` : ""}`);
        this.name = "YouTubeApiError";
        this.status = status;
    }
}

/** ISO 8601 duration ("PT1H2M3S") to seconds. */
export function parseIsoDuration(iso) {
    if (!iso) return null;
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
    return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null;
}

const snippetMeta = (s = {}) => ({
    title: s.title ?? "",
    channel: s.videoOwnerChannelTitle ?? s.channelTitle ?? "",
    thumbnail: (s.thumbnails?.medium ?? s.thumbnails?.default)?.url ?? ""
});

/** Reasons after which every call would fail too. A private playlist (403) must not disable the API for the other videos. */
const DISABLING_REASONS = new Set(["keyInvalid", "quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded", "accessNotConfigured", "ipRefererBlocked"]);

export class YouTubeDataApi {
    #key;
    #fetch;
    #timeoutMs;
    #disabled = false;

    constructor({ apiKey, fetch = globalThis.fetch?.bind(globalThis), timeoutMs = 3000 } = {}) {
        this.#key = apiKey;
        this.#fetch = fetch;
        this.#timeoutMs = timeoutMs;
    }

    /** False without a key, or once the API refused the key or the quota: no more calls are made. */
    get available() {
        return Boolean(this.#key) && !this.#disabled;
    }

    /** @returns {Promise>} video id -> meta. Private or deleted videos are absent. */
    async videos(ids) {
        if (!ids || ids.length === 0) return new Map();
        const result = new Map();
        for (let i = 0; i < ids.length; i += 50) {            // 50 ids per call at most
            const data = await this.#get("videos", { part: "snippet,contentDetails", id: ids.slice(i, i + 50).join(",") });
            for (const v of data.items ?? [])
                result.set(v.id, { ...snippetMeta(v.snippet), duration: parseIsoDuration(v.contentDetails?.duration) });
        }
        return result;
    }

    /** @returns {Promise<{ id: string, meta: object }[]>} in playlist order, at most `maxItems`. */
    async playlistItems(playlistId, maxItems = 200) {
        if (!playlistId) return [];
        const entries = [];
        let pageToken;
        do {
            const data = await this.#get("playlistItems", { part: "snippet", playlistId, maxResults: 50, pageToken });
            for (const it of data.items ?? [])
                entries.push({ id: it.snippet.resourceId.videoId, meta: snippetMeta(it.snippet) });
            pageToken = data.nextPageToken;
        } while (pageToken && entries.length < maxItems);
        return entries.slice(0, maxItems);
    }

    async #get(path, params) {
        if (!this.available) {
            throw new YouTubeApiError(0, "ApiDisabled");
        }

        const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
        for (const [k, v] of Object.entries({ ...params, key: this.#key })) if (v != null) url.searchParams.set(k, v);

        const res = await this.#fetch(url, { signal: AbortSignal.timeout(this.#timeoutMs) });
        if (!res.ok) {
            const reason = (await res.json().catch(() => null))?.error?.errors?.[0]?.reason;
            if (res.status === 401 || res.status === 429 || DISABLING_REASONS.has(reason)) {
                this.#disabled = true;
            }
            throw new YouTubeApiError(res.status, reason);
        }
        return res.json();
    }
}