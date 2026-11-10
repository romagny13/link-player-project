import {UrlInfo} from "../../models/UrlInfo.js";
import {toAutoplayMode, toInt} from "../../utils/helpers.js";
import {VideoInfo} from "../../models/VideoInfo.js";
import {VideoListInfo} from "../../models/VideoListInfo.js";
import {LinkParser} from "../LinkParser.js";

export class OkruLinkParser extends LinkParser {

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

    parse(element) {
        const url = this.getUrl(element);
        if (!url) throw new Error(`No URL found for element '${element}'`);

        const urlInfos = this.parseUrl(url);
        if (!urlInfos) throw new Error(`Invalid URL: '${url}'`);

        const data = this.readLinkData(element);

        switch (urlInfos.kind) {
            case "video":
                return new VideoInfo({
                    provider: "okru",
                    target: data.target,
                    videoId: urlInfos.videoId,
                    autoplay: toAutoplayMode(data.autoplay),
                    startSeconds: this.parseStartTime(data.startSeconds),
                    title: data.title ?? "",
                    channel: data.channel ?? "",
                    thumbnail: data.thumbnail ?? "",
                    showOnInit: data.showOnInit
                });
            case "videoList": {
                const labels = urlInfos.labels;
                const videoIds = urlInfos.videoIds;
                if (
                    labels.length &&
                    labels.length !== videoIds.length
                ) {
                    console.warn(
                        `[OkruProvider] ${labels.length} labels for ${videoIds.length} videos (a comma in a title that is not encoded as %2C?)`
                    );
                }

                const list = new VideoListInfo("okru", data.target, videoIds, urlInfos.index, data.showOnInit);

                videoIds.forEach((videoId, i) => {
                    // data-items wins over labels= in the URL
                    const videoInfo = data.videos.length
                        ? data.videos[i]
                        : {title: labels[i]};

                    list.addVideo(
                        new VideoInfo({
                            provider: "okru",
                            target: data.target,
                            videoId: videoId,
                            autoplay: toAutoplayMode(videoInfo?.autoplay ?? data.autoplay),
                            startSeconds: this.parseStartTime(videoInfo?.startSeconds),
                            title: videoInfo?.title ?? "",
                            channel: videoInfo?.channel ?? "",
                            thumbnail: videoInfo?.thumbnail ?? ""
                        })
                    );
                });

                return list;
            }
        }
    }
}