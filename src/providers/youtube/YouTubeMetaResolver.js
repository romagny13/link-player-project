import {isEmpty} from "../../utils/helpers.js";

const DAY = 24 * 60 * 60 * 1000;

/** The fields of an item the API can give (the same names as the VideoInfo getters). */
const FIELDS = ["title", "description", "channel", "channelUrl", "thumbnail", "duration"];

const fieldsOf = (source = {}) => Object.fromEntries(FIELDS.map((f) => [f, source[f]]));

const fillEmpty = (meta, extra = {}) => {
    const out = {...meta};
    for (const f of FIELDS) if (isEmpty(out[f]) && !isEmpty(extra[f])) out[f] = extra[f];
    return out;
};

/** "PL123#3": the id given to a playlist item whose id is unknown (see applyItems). */
const isPlaceholder = (id) => typeof id === "string" && id.includes("#");

/**
 * Completes the metadata of a YouTube video, list or playlist (panel, page sections...).
 * Order: what is declared (data-videos, code definitions) > YouTube Data API (cached) > fallback title ("Video 1"...).
 *
 * It only works when a REQUIRED field is empty (`required`, the title by default) unless `force` is given:
 * everything declared is then left alone and every other empty field is filled from the API too
 * (description, channel, channelUrl, thumbnail, duration).
 * Without `api` (no key, or refused) a list only gets the fallback title, and a single video gets nothing
 * (a fallback title would hide the real one later). Never rejects.
 *
 * Its result is applied by applyItems() (lists, metaMerge.js) or applyDefinition() (single video).
 */
export class YouTubeMetaResolver {
    #api;
    #cache;
    #videoTtlMs;
    #playlistTtlMs;
    #fallbackTitle;
    #required;

    /**
     * @param {object} [options]
     * @param {YouTubeDataApi|null} [options.api] null: the API is never called.
     * @param {{ get(key): any, set(key, value, ttlMs): void }|null} [options.cache]
     * @param {number} [options.videoTtlMs] Video titles rarely change.
     * @param {number} [options.playlistTtlMs] A playlist content changes more often.
     * @param {(index: number) => string} [options.fallbackTitle] Title of a list item that is still without one.
     * @param {string[]} [options.required] The fields that must not stay empty (names of VideoInfo getters):
     *   when one is empty the API is asked. Add "description", "channel"... to complete a video that already has a title.
     */
    constructor({
                    api = null,
                    cache = null,
                    videoTtlMs = 7 * DAY,
                    playlistTtlMs = DAY,
                    fallbackTitle = (i) => `Video ${i + 1}`,
                    required = ["title"]
                } = {}) {
        this.#api = api;
        this.#cache = cache;
        this.#videoTtlMs = videoTtlMs;
        this.#playlistTtlMs = playlistTtlMs;
        this.#fallbackTitle = fallbackTitle;
        this.#required = required;
    }

    /**
     * @param {VideoInfo|VideoListInfo|PlaylistInfo} info
     * @param {{ force?: boolean }} [options] force: ask even when nothing required is missing. Declared values are
     *   still never overwritten.
     * @returns {Promise<object[]|null>} Items [{ id, title, description, channel, channelUrl, thumbnail, duration }]
     *   (one item for a single video), or null when there is nothing to do (not YouTube, or nothing required is
     *   missing, or the API has nothing).
     */
    async resolve(info, {force = false} = {}) {
        if (info.provider !== "youtube") return null;
        return info.isPlaylist ? this.#resolveList(info, force) : this.#resolveVideo(info, force);
    }

    async #resolveVideo(info, force) {
        const declared = fieldsOf(info);
        if (!force && this.#isComplete(declared)) return null;
        if (!this.#api?.available) return null; // nothing to ask, and no fallback title for a single video

        let meta;
        try {
            meta = (await this.#videosMeta([info.videoId])).get(info.videoId);
        } catch (error) {
            console.warn("[YouTubeMetaResolver] API failed:", error.message);
            return null;
        }
        return meta ? [{id: info.videoId, ...fillEmpty(declared, meta)}] : null; // private / deleted video: absent
    }

    async #resolveList(info, force) {
        const declared = info.videos.map((v) => ({id: v.videoId, meta: fieldsOf(v)}));
        if (!force && declared.length > 0 && declared.every((d) => this.#isComplete(d.meta))) return null;

        let fetched = [];
        if (this.#api?.available) {
            try {
                fetched = await this.#fetchEntries(info);
            } catch (error) {
                console.warn("[YouTubeMetaResolver] API failed, defaults used:", error.message);
            }
        }
        return this.#merge(this.#base(info, declared, fetched), fetched);
    }

    #isComplete(meta) {
        return this.#required.every((field) => !isEmpty(meta[field]));
    }

    async #fetchEntries(info) {
        if (info.playlistId) return this.#playlistEntries(info.playlistId);
        const meta = await this.#videosMeta(info.videoIds);
        return info.videoIds.filter((id) => meta.has(id)).map((id) => ({id, meta: meta.get(id)}));
    }

    /** Cache per video: two lists (or a list and a single video) sharing videos do not pay twice. */
    async #videosMeta(ids) {
        const result = new Map();
        const missing = [];
        for (const id of ids) {
            const hit = this.#cache?.get(`video:v2:${id}`);
            if (hit) result.set(id, hit);
            else missing.push(id);
        }
        if (missing.length) {
            for (const [id, meta] of await this.#api.videos(missing)) {
                result.set(id, meta);
                this.#cache?.set(`video:v2:${id}`, meta, this.#videoTtlMs);
            }
        }
        return result;
    }

    async #playlistEntries(playlistId) {
        const key = `playlist:v2:${playlistId}`;
        const hit = this.#cache?.get(key);
        if (hit) return hit;
        const entries = await this.#api.playlistItems(playlistId);
        if (entries.length) this.#cache?.set(key, entries, this.#playlistTtlMs);
        return entries;
    }

    /** The items to complete, in the order of the panel: declared, else the ids of a list (all of them), else what the API says. */
    #base(info, declared, fetched) {
        if (declared.length) return declared; // declared positions are kept, even for a video the API did not return
        if (info.videoIds?.length) return info.videoIds.map((id) => ({id, meta: {}})); // a list keeps every position
        return fetched;
    }

    #merge(base, fetched) {
        const byId = new Map(fetched.map((entry) => [entry.id, entry.meta]));

        return base.map(({id, meta}, index) => {
            // a placeholder id (a playlist defined without ids) is matched by position
            const entry = byId.has(id) ? {id, meta: byId.get(id)} : isPlaceholder(id) ? fetched[index] : null;
            const filled = fillEmpty(meta, entry?.meta);
            return {id: entry?.id ?? id, ...filled, title: filled.title || this.#fallbackTitle(index)};
        });
    }
}