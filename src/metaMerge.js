import {VideoInfo} from "./models/VideoInfo.js";
import {isEmpty, toAutoplayMode} from "./utils/helpers.js";

/** A text: what is declared, else the fallback, else "". A text is never undefined. */
const text = (declared, fallback) => (isEmpty(declared) ? fallback ?? "" : declared);

/**
 * Anything that is not a text (a number, a flag, an object, a key): what is declared, else the fallback,
 * else left as it was. Never turned into "": the model gives its own default (key, extra...).
 */
const fill = (declared, fallback) => (isEmpty(declared) && !isEmpty(fallback) ? fallback : declared);

/**
 * Items -> videos of a list / playlist, IN PLACE (the info keeps its identity: regions and journal compare by reference).
 * Values already declared (data-*, data-videos, definitions) win; items only fill the gaps.
 * An item: { id?, title, description, channel, channelUrl, thumbnail, duration, startSeconds (seconds), showOnInit, key, extra, autoplay }.
 * @param {VideoListInfo|PlaylistInfo} info
 * @param {object[]} items
 */
export function applyItems(info, items) {
    const current = info.videos;
    const videos = items
        .map((item, i) => {
            // the id of the item, else the one the list / the existing video already has; a playlist whose ids
            // are unknown gets a placeholder id: playback goes by index, not by id
            const id = [item.id, info.videoIds?.[i], current[i]?.videoId].find((v) => !isEmpty(v))
                ?? (info.playlistId ? `${info.playlistId}#${i}` : null);
            if (isEmpty(id)) return null;

            const old = current[i]?.videoId === id ? current[i] : current.find((v) => v.videoId === id);
            return new VideoInfo({
                provider: info.provider,
                target: info.target,
                videoId: id,
                autoplay: old ? old.autoplay : toAutoplayMode(item.autoplay),
                startSeconds: fill(old?.startSeconds, item.startSeconds),
                title: text(old?.title, item.title),
                description: text(old?.description, item.description),
                channel: text(old?.channel, item.channel),
                channelUrl: text(old?.channelUrl, item.channelUrl),
                thumbnail: text(old?.thumbnail, item.thumbnail),
                duration: fill(old?.duration, item.duration),
                showOnInit: fill(old?.showOnInit, item.showOnInit),
                key: fill(old?.key, item.key),
                extra: fill(old?.extra, item.extra) ?? null
            });
        })
        .filter(Boolean);
    info.setVideos(videos);
}

/**
 * Applies what the code defines for an info (the link may then be only a navigation link).
 * Single video: {title, description, channel, channelUrl, thumbnail, duration}, only the empty fields are filled.
 * List / playlist: {videos: [item]} (see applyItems), positional for a list of videos (the ids are known).
 * @returns {boolean} true when something changed.
 */
export function applyDefinition(info, definition) {
    if (!definition) return false;
    if (!info.isPlaylist) return info.fillMissing(definition);
    const items = definition.videos;
    if (!items?.length) return false;
    applyItems(info, items);
    return true;
}

/** @param {object|((info) => object|null)|null} definitions Keyed by info.key ("youtube:ID", "youtube:list:a,b", "youtube:playlist:PL...", or your own key), or a function. */
export function resolveDefinition(definitions, info) {
    if (typeof definitions === "function") return definitions(info) ?? null;
    return definitions?.[info.key] ?? null;
}