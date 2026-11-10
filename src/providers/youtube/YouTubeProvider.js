import {YouTubeLinkParser} from "./YouTubeLinkParser.js";
import {YouTubePlayer} from "./YouTubePlayer.js";
import {makeIframe} from "../../utils/dom.js";
import {YouTubeEmbedSrcBuilder} from "./YouTubeEmbedSrcBuilder.js";

export class YouTubeProvider {
    id = "youtube";
    hosts = ["youtube.com", "youtu.be", "youtube-nocookie.com"];
    #linkParser;
    #embedSrcBuilder;

    constructor({linkParser = null, embedSrcBuilder = null, thumbnailUrlBuilder = null} = {}) {
        this.#linkParser = linkParser ?? new YouTubeLinkParser({thumbnailUrlBuilder});
        this.#embedSrcBuilder = embedSrcBuilder ?? new YouTubeEmbedSrcBuilder({enablejsapi: true});
    }

    getInfo(link) {
        return this.#linkParser.parse(link);
    }

    makeIframe({
                   src, // required
                   width = "560",
                   height = "315",
                   title = "YouTube video player",
                   allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
                   referrerPolicy = "strict-origin-when-cross-origin",
                   allowFullscreen = true,
                   extraAttrs = {}
               }) {
        return makeIframe({
            width,
            height,
            src,
            title,
            allow,
            referrerPolicy,
            allowFullscreen,
            extraAttrs
        });
    }

    createPlayer({iframe = null} = {})  {
        return new YouTubePlayer({
            builder: this.#embedSrcBuilder,
            createIframe: (src) => this.makeIframe({src}),
            iframe
        });
    }

}