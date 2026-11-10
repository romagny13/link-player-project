import {VideoInfo} from "./models/VideoInfo.js";
import {AUTOPLAY_MODES} from "./utils/helpers.js";

const isEmpty = (v) => v === "" || v == null;
const pick = (declared, fallback) => (isEmpty(declared) ? fallback ?? "" : declared);

/**
 * Items -> videos of a list / playlist, IN PLACE (the info keeps its identity: regions and journal compare by reference).
 * Values already declared on the link (data-*, data-videos) win; items only fill the gaps.
 * @param {VideoListInfo|PlaylistInfo} info
 * @param {Array<{id?: string, title?: string, channel?: string, thumbnail?: string, startSeconds?: number}>} items
 */
export function applyItems(info, items) {
    const current = info.videos;
    const videos = items
        .map((item, i) => {
            // a playlist whose ids are unknown gets placeholder ids: playback goes by index, not by id
            const id = item.id ?? info.videoIds?.[i] ?? current[i]?.videoId
                ?? (info.playlistId ? `${info.playlistId}#${i}` : null);
            if (isEmpty(id)) return null;
            const old = current[i]?.videoId === id ? current[i] : current.find((v) => v.videoId === id);
            return new VideoInfo({
                provider: info.provider,
                target: info.target,
                videoId: id,
                autoplay: old?.autoplay ?? AUTOPLAY_MODES.NONE,
                startSeconds: old?.startSeconds ?? item.startSeconds,
                title: pick(old?.title, item.title),
                channel: pick(old?.channel, item.channel),
                thumbnail: pick(old?.thumbnail, item.thumbnail)
            });
        })
        .filter(Boolean);
    info.setVideos(videos);
}

/**
 * Applies what the code defines for an info (the link may then be only a navigation link).
 * Single video: {title, channel, thumbnail}. List / playlist: {videos: [{id?, title, channel, thumbnail, startSeconds}]},
 * positional for a list of videos (the ids are known), `id` required for a playlist without data-videos.
 * @returns {boolean} true when something changed.
 */
export function applyDefinition(info, definition) {
    if (!definition) return false;
    if (!info.isPlaylist) return info.fillMissing(definition);
    // `count` alone gives N items without any id or title ("Video 1" ... "Video N")
    const items = definition.videos ?? (definition.count > 0 ? Array.from({length: definition.count}, () => ({})) : null);
    if (!items?.length) return false;
    applyItems(info, items);
    return true;
}

/** @param {object|((info) => object|null)|null} definitions Keyed by info.key ("youtube:ID", "youtube:list:a,b", "youtube:playlist:PL..."), or a function. */
export function resolveDefinition(definitions, info, name = null) {
    if (typeof definitions === "function") return definitions(info, name) ?? null;
    return (name && definitions?.[name]) || definitions?.[info.key] || null; // your own name first, then info.key
}