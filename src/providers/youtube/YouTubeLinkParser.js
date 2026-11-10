import {UrlInfo} from "../../models/UrlInfo.js";
import {toAutoplayMode, toInt} from "../../utils/helpers.js";
import {VideoInfo} from "../../models/VideoInfo.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";
import {PlaylistInfo} from "../../models/PlaylistInfo.js";
import {LinkParser} from "../LinkParser.js";
import {YouTubeThumbnailUrlBuilder} from "./YouTubeThumbnailUrlBuilder.js";

export class YouTubeLinkParser extends LinkParser {
    #thumbnailUrlBuilder;

    /**
     * @param {{ thumbnailUrlBuilder?: YouTubeThumbnailUrlBuilder | null }} [options]
     */
    constructor({thumbnailUrlBuilder = null} = {}) {
        super();
        this.#thumbnailUrlBuilder = thumbnailUrlBuilder ?? new YouTubeThumbnailUrlBuilder();
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
            startSeconds: this.parseStartTime(q.get("t") ?? q.get("start"))
        });
    }

    // HTMLElement
    parse(element) {
        const url = this.getUrl(element);
        if (!url) throw new Error(`No URL found for element '${element}'`);

        const urlInfos = this.parseUrl(url);
        if (!urlInfos) throw new Error(`Invalid URL: '${url}'`);

        const data = this.readLinkData(element);
        switch (urlInfos.kind) {
            case "video":
                return new VideoInfo({
                    provider: "youtube",
                    target: data.target,
                    videoId: urlInfos.videoId,
                    autoplay: toAutoplayMode(data.autoplay),
                    startSeconds: this.parseStartTime(data.startSeconds) ?? urlInfos.startSeconds,
                    title: data.title ?? "",
                    channel: data.channel ?? "",
                    thumbnail: data.thumbnail ?? this.#thumbnailUrlBuilder.getThumbnailUrl(urlInfos.videoId),
                    showOnInit: data.showOnInit
                });
            case "videoList": {
                const list = new VideoListInfo("youtube", data.target, urlInfos.videoIds, urlInfos.index, data.showOnInit);
                urlInfos.videoIds.forEach((videoId, i) => {
                    const videoInfo = data.videos[i] ?? {};
                    list.addVideo(
                        new VideoInfo({
                            provider: "youtube",
                            target: data.target,
                            videoId: videoId,
                            // data-videos json
                            autoplay: toAutoplayMode(videoInfo.autoplay),
                            startSeconds: this.parseStartTime(data.startSeconds),
                            title: videoInfo.title ?? "",
                            channel: videoInfo.channel ?? "",
                            thumbnail: videoInfo.thumbnail ?? this.#thumbnailUrlBuilder.getThumbnailUrl(videoId),
                        })
                    );
                });
                return list;
            }
            case "playlist": {
                const playlist = new PlaylistInfo(
                    "youtube",
                    data.target,
                    urlInfos.playlistId,
                    urlInfos.videoId,
                    data.showOnInit
                );

                for (const videoInfo of data.videos) {
                    // fallback video
                    playlist.addVideo(new VideoInfo({
                        provider: "youtube",
                        target: data.target,
                        // data-videos json
                        videoId: videoInfo.id,
                        autoplay: toAutoplayMode(videoInfo.autoplay),
                        startSeconds: this.parseStartTime(videoInfo.startSeconds),
                        title: videoInfo.title ?? "",
                        channel: videoInfo.channel ?? "",
                        thumbnail: videoInfo.thumbnail ?? this.#thumbnailUrlBuilder.getThumbnailUrl(videoInfo.id),
                    }));
                }
                return playlist;
            }
        }
    }
}