/** Number of items of a list / playlist: null when unknown, 0 for a single video (it has no items). */
export function itemCountOf(info) {
    if (!info?.isPlaylist) return 0;
    return info.videoIds?.length ?? (info.videos.length || null);
}

/** A position is a whole number >= 0; anything else (undefined, null, -1...) is the first item. */
export const toIndex = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
