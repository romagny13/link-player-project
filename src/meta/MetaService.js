import {applyItems, applyDefinition} from "./metaMerge.js";

/**
 * ROLE: complete the metadata of an info (items of a playlist, title / channel of a video) with the provider's API.
 * It knows nothing about regions or the DOM. It mutates the info (metaMerge) and says whether something changed.
 */
export class MetaService {
    #youtube;
    #scope;
    #resolved = new WeakSet();

    /** @param {"playlists"|"all"} scope  "playlists": single videos are not looked up unless forced. */
    constructor({youtube, scope = "playlists"}) {
        if (scope !== "playlists" && scope !== "all")
            throw new TypeError(`Invalid youtubeMetaScope '${scope}': expected "playlists" or "all".`);
        this.#youtube = youtube;
        this.#scope = scope;
    }

    /** First time for an info only (unless `force`). @returns {Promise<boolean>} true when the info changed. */
    async ensure(info, {force = false} = {}) {
        if (!force && this.#resolved.has(info)) return false;
        this.#resolved.add(info);
        return this.#enrich(info, force);
    }

    async #enrich(info, force) {
        if (info.provider !== "youtube") return false;
        if (!info.isPlaylist && !force && this.#scope !== "all") return false;
        const items = await this.#youtube.resolve(info, {force});
        if (!items?.length) return false;
        if (info.isPlaylist) {
            applyItems(info, items);
            return true;
        }
        return applyDefinition(info, items[0]);
    }
}
