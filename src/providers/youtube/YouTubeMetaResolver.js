const DAY = 24 * 60 * 60 * 1000;
const isEmpty = (v) => v === "" || v == null;
const fillEmpty = (meta, extra = {}) => {
    const out = {...meta};
    for (const [k, v] of Object.entries(extra)) if (isEmpty(out[k]) && !isEmpty(v)) out[k] = v;
    return out;
};

/**
 * Completes the items of a YouTube list / playlist (titles, channels, thumbnails) for the panel.
 * Order: what is declared (data-videos, definitions) > YouTube Data API (cached) > fallback title ("Video 1"...).
 * Without `api` only the fallback is used. Never rejects.
 * Replaces the YouTubeMetaResolver class of YouTubeDataApi.js (YouTubeDataApi itself is unchanged).
 */
export class YouTubeMetaResolver {
    #api;
    #cache;
    #videoTtlMs;
    #playlistTtlMs;
    #fallbackTitle;

    /**
     * @param {object} [options]
     * @param {YouTubeDataApi|null} [options.api] null: the API is never called.
     * @param {{ get(key): any, set(key, value, ttlMs): void }|null} [options.cache]
     * @param {number} [options.videoTtlMs] Video titles rarely change.
     * @param {number} [options.playlistTtlMs] A playlist content changes more often.
     * @param {(index: number) => string} [options.fallbackTitle]
     */
    constructor({
                    api = null,
                    cache = null,
                    videoTtlMs = 7 * DAY,
                    playlistTtlMs = DAY,
                    fallbackTitle = (i) => `Video ${i + 1}`
                } = {}) {
        this.#api = api;
        this.#cache = cache;
        this.#videoTtlMs = videoTtlMs;
        this.#playlistTtlMs = playlistTtlMs;
        this.#fallbackTitle = fallbackTitle;
    }

    /**
     * @param {VideoListInfo|PlaylistInfo} info
     * @returns {Promise<object[]|null>} Items [{ id, title, channel, thumbnail, duration }] to apply with applyItems(),
     *   or null when there is nothing to do (not YouTube, not a list, or every title is already known).
     */
    async resolve(info) {
        if (info.provider !== "youtube" || !info.isPlaylist) return null;

        const declared = info.videos.map((v) => ({
            id: v.videoId,
            meta: {title: v.title, channel: v.channel, thumbnail: v.thumbnail}
        }));
        if (declared.length > 0 && declared.every((d) => d.meta.title)) return null;

        let fetched = [];
        if (this.#api?.available) {
            try {
                fetched = await this.#fetchEntries(info);
            } catch (error) {
                console.warn("[YouTubeMetaResolver] API failed, defaults used:", error.message);
            }
        }
        return this.#merge(declared, fetched);
    }

    async #fetchEntries(info) {
        if (info.playlistId) return this.#playlistEntries(info.playlistId);
        const meta = await this.#videosMeta(info.videoIds);
        return info.videoIds.filter((id) => meta.has(id)).map((id) => ({id, meta: meta.get(id)}));
    }

    /** Cache per video: two lists sharing videos do not pay twice. */
    async #videosMeta(ids) {
        const result = new Map();
        const missing = [];
        for (const id of ids) {
            const hit = this.#cache?.get(`video:${id}`);
            if (hit) result.set(id, hit);
            else missing.push(id);
        }
        if (missing.length) {
            for (const [id, meta] of await this.#api.videos(missing)) {
                result.set(id, meta);
                this.#cache?.set(`video:${id}`, meta, this.#videoTtlMs);
            }
        }
        return result;
    }

    async #playlistEntries(playlistId) {
        const key = `playlist:${playlistId}`;
        const hit = this.#cache?.get(key);
        if (hit) return hit;
        const entries = await this.#api.playlistItems(playlistId);
        if (entries.length) this.#cache?.set(key, entries, this.#playlistTtlMs);
        return entries;
    }

    #merge(declared, fetched) {
        const byId = new Map(fetched.map((entry) => [entry.id, entry.meta]));
        const base = declared.length ? declared : fetched; // declared positions are kept, even for a video the API did not return

        return base.map(({id, meta}, index) => {
            // "PL123#3" is a placeholder id (playlist defined with `count` or without ids): matched by position
            const entry = byId.has(id) ? {id, meta: byId.get(id)} : id.includes("#") ? fetched[index] : null;
            const filled = fillEmpty(meta, entry?.meta);
            return {id: entry?.id ?? id, ...filled, title: filled.title || this.#fallbackTitle(index)};
        });
    }
}