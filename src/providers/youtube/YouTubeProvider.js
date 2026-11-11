import {YouTubeInfoParser} from "./YouTubeInfoParser.js";
import {YouTubePlayer} from "./YouTubePlayer.js";
import {makeIframe} from "../../utils/dom.js";
import {YouTubeEmbedSrcBuilder} from "./YouTubeEmbedSrcBuilder.js";

export class YouTubeProvider {
    id = "youtube";
    hosts = ["youtube.com", "youtu.be", "youtube-nocookie.com"];
    #infoParser;
    #embedSrcBuilder;

    constructor({
                    infoParser = null,
                    embedSrcBuilder = null,
                    thumbnailUrlBuilder = null
                } = {}) {
        this.#infoParser =
            infoParser ?? new YouTubeInfoParser({thumbnailUrlBuilder});
        this.#embedSrcBuilder =
            embedSrcBuilder ?? new YouTubeEmbedSrcBuilder({enablejsapi: true});
    }

    getInfoFromElement(link) {
        return this.#infoParser.parseFromElement(link);
    }

    getInfoFromDefinition(definition) {
        if(!definition.url)
        {
            definition.url = this.#infoParser.buildUrl(definition);
        }
        return this.#infoParser.parseDefinition(definition);
    }

    createPlayer({iframe = null} = {}) {
        return new YouTubePlayer({
            builder: this.#embedSrcBuilder,
            createIframe: (src) =>
                makeIframe({
                    width: "560",
                    height: "315",
                    src,
                    title: "YouTube video player",
                    allow:
                        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
                    referrerPolicy: "strict-origin-when-cross-origin",
                    allowFullscreen: true,
                    extraAttrs: {}
                }),
            iframe
        });
    }
}
