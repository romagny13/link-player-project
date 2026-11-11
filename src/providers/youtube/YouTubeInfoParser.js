import {UrlInfo} from "../../models/UrlInfo.js";
import {toAutoplayMode, toInt} from "../../utils/helpers.js";
import {VideoInfo} from "../../models/VideoInfo.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";
import {PlaylistInfo} from "../../models/PlaylistInfo.js";
import {InfoParser} from "../InfoParser.js";
import {YouTubeThumbnailUrlBuilder} from "./YouTubeThumbnailUrlBuilder.js";

export class YouTubeInfoParser extends InfoParser {
    #thumbnailUrlBuilder;

    /**
     * @param {{ thumbnailUrlBuilder?: YouTubeThumbnailUrlBuilder | null }} [options]
     */
    constructor({thumbnailUrlBuilder = null} = {}) {
        super();
        this.#thumbnailUrlBuilder = thumbnailUrlBuilder ?? new YouTubeThumbnailUrlBuilder();
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

    parseUrl(url) {
        const u = new URL(url);
        const q = u.searchParams;

        if (q.has("video_ids")) {
            const videoIds = q.get("video_ids").split(",").map((s) => s.trim()).filter(Boolean);
            if (videoIds.length === 0) return null;
            return new UrlInfo({kind: "videoList", videoIds, index: toInt(q.get("index"))});
        }

        // watch?v=ID | youtu.be/ID | /embed/ID | /shorts/ID | /live/ID
        const host = u.hostname.replace(/^www\./, "");
        const pathId = /^\/(?:embed|shorts|live)\/([\w-]+)/.exec(u.pathname)?.[1];
        const videoId =
            q.get("v") ||
            (host === "youtu.be" ? u.pathname.split("/")[1] : null) ||
            (pathId !== "videoseries" ? pathId : null) ||
            null;

        // 1. a playlist: the video id is optional
        if (q.has("list")) {
            return new UrlInfo({kind: "playlist", playlistId: q.get("list"), videoId});
        }

        // 2. embed form of a list of videos: /embed/ID?playlist=b,c
        const extra = (q.get("playlist") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        if (extra.length) {
            return new UrlInfo({
                kind: "videoList",
                videoIds: [videoId, ...extra].filter(Boolean),
                index: toInt(q.get("index"))
            });
        }

        // 3. only now: a single video needs an id
        if (!videoId) throw new Error(`Invalid URL: no video or playlist id in '${url}'`);
        return new UrlInfo({
            kind: "video",
            videoId,
            startSeconds: this.parseTime(q.get("t") ?? q.get("start"))
        });
    }

    parseDefinition(def) {
        const urlInfos = this.parseUrl(def.url);
        if (!urlInfos) throw new Error(`Invalid URL: '${def.url}'`);

        const videos = def.videos ?? [];
        if (!Array.isArray(videos)) throw new Error("videos must be an array");

        switch (urlInfos.kind) {
            case "video":
                return new VideoInfo({
                    provider: "youtube",
                    target: def.target,
                    videoId: urlInfos.videoId,
                    autoplay: toAutoplayMode(def.autoplay),
                    startSeconds: this.parseTime(def.start) ?? urlInfos.startSeconds,
                    title: def.title ?? "",
                    description: def.description ?? "",
                    channel: def.channel ?? "",
                    channelUrl: def.channelUrl ?? "",
                    duration: this.parseTime(def.duration),
                    thumbnail: def.thumbnail ?? this.#thumbnailUrlBuilder.getThumbnailUrl(urlInfos.videoId),
                    showOnInit: def.showOnInit,
                    key: def.key,
                    extra: def.extra
                });
            case "videoList": {
                const index = urlInfos.index ?? def.index;
                const list = new VideoListInfo(
                    "youtube", def.target, urlInfos.videoIds, index, def.showOnInit, def.key
                );
                urlInfos.videoIds.forEach((videoId, i) => {
                    const v = videos[i] ?? {};
                    list.addVideo(new VideoInfo({
                        provider: "youtube",
                        target: def.target,
                        videoId,
                        autoplay: toAutoplayMode(v.autoplay ?? def.autoplay),   // repli sur l'autoplay du lien (comme Okru)
                        startSeconds: this.parseTime(v.start),       // plus de def.start sur toutes les vidéos
                        title: v.title ?? "",
                        description: v.description ?? "",
                        channel: v.channel ?? "",
                        channelUrl: v.channelUrl ?? "",
                        duration: this.parseTime(v.duration),
                        thumbnail: v.thumbnail ?? this.#thumbnailUrlBuilder.getThumbnailUrl(videoId),
                        key: v.key,
                        extra: v.extra
                    }));
                });
                return list;
            }
            case "playlist": {
                const playlist = new PlaylistInfo(
                    "youtube", def.target, urlInfos.playlistId, urlInfos.videoId, def.showOnInit, def.key
                );
                const items = videos.length ? videos : [];

                items.forEach((v, i) => {
                    playlist.addVideo(new VideoInfo({
                        provider: "youtube",
                        target: def.target,
                        videoId: v.videoId,
                        autoplay: toAutoplayMode(v.autoplay),
                        startSeconds: this.parseTime(v.start),
                        title: v.title ?? "",
                        description: v.description ?? "",
                        channel: v.channel ?? "",
                        channelUrl: v.channelUrl ?? "",
                        thumbnail: v.thumbnail ?? (v.videoId ? this.#thumbnailUrlBuilder.getThumbnailUrl(v.videoId) : ""),
                        duration: this.parseTime(v.duration),
                        key: v.key,
                        extra: v.extra
                    }));
                });
                return playlist;
            }
        }
    }
}