import {InfoParser} from "../InfoParser.js";
import {SrcInfo, UrlInfo} from "../../models/UrlInfo.js";
import {
    timeToSeconds,
    toAutoplayMode,
    toInt,
    toBool01,
    describe,
    SOURCE_KINDS
} from "../../utils/helpers.js";
import {VideoInfo} from "../../models/VideoInfo.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";
import {PlaylistInfo} from "../../models/PlaylistInfo.js";
import {YouTubeThumbnailUrlBuilder} from "./YouTubeThumbnailUrlBuilder.js";

export class YouTubeInfoParser extends InfoParser {
    #thumbnailUrlBuilder;

    /**
     * @param {{ thumbnailUrlBuilder?: YouTubeThumbnailUrlBuilder | null }} [options]
     */
    constructor({thumbnailUrlBuilder = null} = {}) {
        super();
        this.#thumbnailUrlBuilder =
            thumbnailUrlBuilder ?? new YouTubeThumbnailUrlBuilder();
    }

    isValidVideoId(id) {
        return typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id);
    }

    parseUrl(url) {
        const u = this.getValidUrl(url);
        if (!u) throw new Error("Invalid URL");

        let host = u.hostname.toLowerCase();
        if (host.startsWith("www.")) host = host.slice(4);

        const path = u.pathname.replace(/\/+$/, "") || "/";
        const p = u.searchParams;

        // ---------- youtu.be ----------
        if (host === "youtu.be") {
            const videoId = path.slice(1);

            if (!this.isValidVideoId(videoId)) {
                throw new Error("Invalid video ID");
            }

            const playlistId = p.get("list") || null;
            const startSeconds = timeToSeconds(p.get("t"));

            return new UrlInfo({
                kind: playlistId ? "playlist" : "video",
                videoId,
                playlistId,
                startSeconds,
                source: url
            });
        }

        // ---------- youtube.com family ----------
        if (host === "youtube.com" || host.endsWith(".youtube.com")) {
            // /watch
            if (path === "/watch") {
                const videoId = p.get("v");
                const playlistId = p.get("list") || null;
                const index = toInt(p.get("index"));
                const startSeconds = timeToSeconds(p.get("t"));

                if (videoId && !this.isValidVideoId(videoId)) {
                    throw new Error("Invalid video ID");
                }

                if (playlistId) {
                    return new UrlInfo({
                        kind: "playlist",
                        videoId: videoId || null,
                        playlistId,
                        startSeconds,
                        index,
                        source: url
                    });
                }

                if (videoId) {
                    return new UrlInfo({
                        kind: "video",
                        videoId,
                        startSeconds,
                        source: url
                    });
                }

                throw new Error("Missing video ID or playlist");
            }

            // /watch_videos
            if (path === "/watch_videos") {
                const raw = p.get("video_ids");
                if (!raw) throw new Error("Missing video_ids");

                const videoIds = raw
                    .split(",")
                    .map((id) => id.trim())
                    .filter((id) => this.isValidVideoId(id));

                if (videoIds.length === 0) {
                    throw new Error("No valid video IDs");
                }

                const index = toInt(p.get("index"));

                return new UrlInfo({
                    kind: "videoList",
                    videoIds,
                    videoId: videoIds[0],
                    index,
                    source: url
                });
            }
        }

        throw new Error("Unsupported YouTube URL");
    }

    parseSrc(src) {
        const u = this.getValidUrl(src); // ← corrigé
        if (!u) throw new Error("Invalid URL");

        let host = u.hostname.toLowerCase();
        if (host.startsWith("www.")) host = host.slice(4);

        if (
            host !== "youtube.com" &&
            !host.endsWith(".youtube.com") &&
            host !== "youtube-nocookie.com"
        ) {
            throw new Error("Invalid embed host");
        }

        const path = u.pathname.replace(/\/+$/, "");
        if (path !== "/embed" && !path.startsWith("/embed/")) {
            throw new Error("Invalid embed URL");
        }

        const p = u.searchParams;
        const segments = path.split("/").filter(Boolean); // ["embed", "xxx"]
        const seg = segments[1] || null;

        const videoId =
            seg && seg !== "videoseries" && this.isValidVideoId(seg) ? seg : null;

        const playlistId = p.get("list") || null;
        const rawPlaylist = p.get("playlist"); // video list for embeds
        const videoIds = rawPlaylist
            ? rawPlaylist
                .split(",")
                .map((id) => id.trim())
                .filter((id) => this.isValidVideoId(id))
            : null;

        const startSeconds = toInt(p.get("start"));
        const index = toInt(p.get("index"));
        const autoplay = toBool01(p.get("autoplay"));
        const mute = toBool01(p.get("mute"));

        let kind = null;
        if (playlistId) kind = "playlist";
        else if (videoIds && videoIds.length) kind = "videoList";
        else if (videoId) kind = "video";
        else throw new Error("Invalid embed URL");

        return new SrcInfo({
            kind,
            videoId,
            videoIds,
            playlistId,
            startSeconds,
            index,
            autoplay,
            mute,
            source: src
        });
    }

    parseFromFrame(frame) {
        if (!frame || frame.tagName !== "IFRAME")
            throw new Error(`Expected an IFRAME element, but received: ${describe(frame)}`);

        const urlInfos = this.parseSrc(frame.src);
        if (!urlInfos)
            throw new Error(`Invalid iframe src: "${frame.src || "(empty)"}"`);

        const host = frame.parentElement;
        if (!host)
            throw new Error(
                `Iframe has no parent element (src: "${frame.src || "(empty)"}")`
            );

        const target = (host.id ||= `host:${crypto.randomUUID()}`);
        const source = {url: urlInfos.source, element: frame, kind: SOURCE_KINDS.FRAME};
        switch (urlInfos.kind) {
            case "video":
                return new VideoInfo({
                    provider: "youtube",
                    target,
                    videoId: urlInfos.videoId,
                    autoplay: toAutoplayMode(urlInfos.autoplay),
                    startSeconds: urlInfos.startSeconds,
                    source
                });
            case "videoList":
                return new VideoListInfo({
                    provider: "youtube",
                    target,
                    videoId: urlInfos.videoId,
                    videoIds: urlInfos.videoIds,
                    index: urlInfos.index,
                    autoplay: toAutoplayMode(urlInfos.autoplay),
                    source
                });
            case "playlist":
                return new PlaylistInfo({
                    provider: "youtube",
                    target,
                    playlistId: urlInfos.playlistId,
                    videoId: urlInfos.videoId,
                    autoplay: toAutoplayMode(urlInfos.autoplay),
                    source
                });
        }
    }

    parseDefinition(def, element) {
        const urlInfos = this.parseUrl(def.url);
        if (!urlInfos) throw new Error(`Invalid URL: '${def.url}'`);

        const videos = def.videos ?? [];
        if (!Array.isArray(videos)) throw new Error("videos must be an array");

        const source = {
            url: urlInfos.source,
            element,
            kind: element ? SOURCE_KINDS.LINK : SOURCE_KINDS.DEFINITION
        };
        switch (urlInfos.kind) {
            case "video":
                return new VideoInfo({
                    provider: "youtube",
                    target: def.target,
                    videoId: urlInfos.videoId,
                    autoplay: toAutoplayMode(def.autoplay),
                    startSeconds: timeToSeconds(def.start) ?? urlInfos.startSeconds,
                    title: def.title ?? "",
                    description: def.description ?? "",
                    channel: def.channel ?? "",
                    channelUrl: def.channelUrl ?? "",
                    duration: timeToSeconds(def.duration),
                    thumbnail:
                        def.thumbnail ??
                        this.#thumbnailUrlBuilder.getThumbnailUrl(urlInfos.videoId),
                    showOnInit: def.showOnInit,
                    key: def.key,
                    extra: def.extra,
                    source
                });
            case "videoList": {
                const index = urlInfos.index ?? def.index;
                const list = new VideoListInfo({
                    provider: "youtube",
                    target: def.target,
                    videoIds: urlInfos.videoIds,
                    index,
                    showOnInit: def.showOnInit,
                    autoplay: toAutoplayMode(def.autoplay),
                    key: def.key,
                    extra: def.extra,
                    source
                });
                urlInfos.videoIds.forEach((videoId, i) => {
                    const v = videos[i] ?? {};
                    list.addVideo(
                        new VideoInfo({
                            provider: "youtube",
                            target: def.target,
                            videoId,
                            autoplay: toAutoplayMode(v.autoplay ?? def.autoplay),
                            startSeconds: timeToSeconds(v.start),
                            title: v.title ?? "",
                            description: v.description ?? "",
                            channel: v.channel ?? "",
                            channelUrl: v.channelUrl ?? "",
                            duration: timeToSeconds(v.duration),
                            thumbnail:
                                v.thumbnail ??
                                this.#thumbnailUrlBuilder.getThumbnailUrl(videoId),
                            key: v.key,
                            extra: v.extra
                        })
                    );
                });
                return list;
            }
            case "playlist": {
                const playlistId = urlInfos.playlistId;
                const playlist = new PlaylistInfo({
                    provider: "youtube",
                    target: def.target,
                    playlistId: playlistId,
                    videoId: urlInfos.videoId,
                    showOnInit: def.showOnInit,
                    autoplay: toAutoplayMode(def.autoplay),
                    key: def.key,
                    extra: def.extra,
                    source
                });
                const items = videos.length ? videos : [];

                items.forEach((v, i) => {
                    playlist.addVideo(
                        new VideoInfo({
                            provider: "youtube",
                            target: def.target,
                            videoId: v.videoId ?? `${playlistId}#${i}`,
                            autoplay: toAutoplayMode(v.autoplay ?? def.autoplay),
                            startSeconds: timeToSeconds(v.start),
                            title: v.title ?? "",
                            description: v.description ?? "",
                            channel: v.channel ?? "",
                            channelUrl: v.channelUrl ?? "",
                            thumbnail:
                                v.thumbnail ??
                                (v.videoId
                                    ? this.#thumbnailUrlBuilder.getThumbnailUrl(v.videoId)
                                    : ""),
                            duration: timeToSeconds(v.duration),
                            key: v.key,
                            extra: v.extra
                        })
                    );
                });
                return playlist;
            }
        }
    }

    buildUrl(def) {
        if (!def) throw new TypeError("buildUrl(): definition is required");

        const q = new URLSearchParams();
        let path = "watch";

        if (def.playlistId) {
            q.set("list", def.playlistId);
            if (def.videoId) q.set("v", def.videoId);
        } else if (def.videoIds?.length) {
            path = "watch_videos";
            q.set("video_ids", def.videoIds.join(","));
            if (def.index != null) q.set("index", def.index);
        } else if (def.videoId) {
            q.set("v", def.videoId);
            if (def.start != null) q.set("t", def.start);
        } else {
            throw new TypeError("buildUrl(): need playlistId, videoIds, or videoId");
        }

        return `https://www.youtube.com/${path}?${q}`;
    }
}
