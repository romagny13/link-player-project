import {UrlInfo} from "../../models/UrlInfo.js";
import {toAutoplayMode, toInt} from "../../utils/helpers.js";
import {VideoInfo} from "../../models/VideoInfo.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";
import {InfoParser} from "../InfoParser.js";

export class OkruInfoParser extends InfoParser {

    #rawQueryParam(url, name) {
        for (const pair of url.search.slice(1).split("&")) {
            const separator = pair.indexOf("=");
            const key = separator === -1 ? pair : pair.slice(0, separator);
            if (key === name) return separator === -1 ? "" : pair.slice(separator + 1);
        }
        return null;
    }

    #splitIds = (rawValue) =>
        rawValue
            .split(",")
            .map((s) => this.#decodeText(s).trim())
            .filter(Boolean);

    #decodeText = (text) => {
        try {
            return decodeURIComponent(text);
        } catch {
            return text; // malformed sequence such as "100%": keep it as written
        }
    }

    /** Split BEFORE decoding: a comma inside a title is %2C, a raw comma separates two titles. An empty label stays in place (positional). */
    #splitLabels = (rawValue) =>
        rawValue ? rawValue.split(",").map((s) => this.#decodeText(s).trim()) : [];

    parseUrl(url) {
        let u;
        try {
            u = new URL(url);
        } catch {
            return null;
        }
        const rawIds = this.#rawQueryParam(u, "video_ids");

        if (rawIds !== null) {
            const videoIds = this.#splitIds(rawIds);
            if (!videoIds.length) return null;

            return new UrlInfo({
                kind: "videoList",
                videoIds,
                index: toInt(u.searchParams.get("index")),
                labels: this.#splitLabels(this.#rawQueryParam(u, "labels")),
            });
        }
        // extract video id from path
        const match = /^\/video(?:embed)?\/(\d+)/.exec(u.pathname);
        return match ?
            new UrlInfo({
                kind: "video",
                videoId: match[1]
            }) :
            null;
    }

    buildUrl(def) {
        if (!def) throw new TypeError("buildUrl(): definition is required");

        if (def.playlistId) throw new TypeError("buildUrl(): playlist not supported");

        const id = def.videoId ?? def.videoIds?.[0];
        if (!id) throw new TypeError("buildUrl(): need videoId or videoIds");

        return `https://ok.ru/video/${id}`;
    }

    parseDefinition(def) {
        const urlInfos = this.parseUrl(def.url);
        if (!urlInfos) throw new Error(`Invalid URL: '${def.url}'`);

        const videos = def.videos ?? [];
        if (!Array.isArray(videos)) throw new Error("videos must be an array");

        switch (urlInfos.kind) {
            case "video":
                return new VideoInfo({
                    provider: "okru",
                    target: def.target,
                    videoId: urlInfos.videoId,
                    autoplay: toAutoplayMode(def.autoplay),
                    startSeconds: this.parseTime(def.start),
                    title: def.title ?? "",
                    description : def.description ?? "",
                    channel: def.channel ?? "",
                    channelUrl: def.channelUrl ?? "",
                    thumbnail: def.thumbnail ?? "",
                    duration: this.parseTime(def.duration),
                    showOnInit: def.showOnInit,
                    key: def.key,
                    extra: def.extra
                });
            case "videoList": {
                const labels = urlInfos.labels;
                const videoIds = urlInfos.videoIds;
                if (labels.length && labels.length !== videoIds.length) {
                    console.warn(
                        `[OkruProvider] ${labels.length} labels for ${videoIds.length} videos (a comma in a title that is not encoded as %2C?)`
                    );
                }

                const index = urlInfos.index ?? def.index;
                const list = new VideoListInfo(
                    "okru", def.target, videoIds, index, def.showOnInit, def.key
                );

                videoIds.forEach((videoId, i) => {
                    // videos (data-videos or code) wins over labels= in the URL
                    const v = videos.length ? videos[i] : {title: labels[i]};

                    list.addVideo(new VideoInfo({
                        provider: "okru",
                        target: def.target,
                        videoId,
                        autoplay: toAutoplayMode(v?.autoplay ?? def.autoplay),
                        startSeconds: this.parseTime(v?.start),
                        title: v?.title ?? "",
                        description : v?.description ?? "",
                        channel: v?.channel ?? "",
                        channelUrl: v?.channelUrl ?? "",
                        thumbnail: v?.thumbnail ?? "",
                        duration: this.parseTime(v?.duration),
                        key: v?.key,
                        extra: v?.extra
                    }));
                });

                return list;
            }
        }
    }
}