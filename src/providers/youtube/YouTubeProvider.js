import {MediaProvider} from "../MediaProvider.js";
import {YouTubeInfoParser} from "./YouTubeInfoParser.js";
import {YouTubeEmbedSrcBuilder} from "./YouTubeEmbedSrcBuilder.js";
import {YouTubeView} from "./YouTubeView.js";
import {IframeFactory} from "../IframeFactory.js";

export class YouTubeProvider extends MediaProvider {
    id = "youtube";
    hosts = ["youtube.com", "youtu.be", "youtube-nocookie.com"];

    #infoParser;
    #embedSrcBuilder;
    #iframes;

    constructor({infoParser = null, embedSrcBuilder = null, thumbnailUrlBuilder = null, iframeFactory = null} = {}) {
        super();
        this.#infoParser = infoParser ?? new YouTubeInfoParser({thumbnailUrlBuilder});
        this.#embedSrcBuilder = embedSrcBuilder ?? new YouTubeEmbedSrcBuilder({enablejsapi: true});
        this.#iframes = iframeFactory ?? new IframeFactory();
    }

    getInfoFromLink(link) {
        return this.#infoParser.parseFromLink(link);
    }

    getInfoFromFrame(frame) {
        return this.#infoParser.parseFromFrame(frame);
    }

    getInfoFromDefinition(definition) {
        if (!definition.url) definition.url = this.#infoParser.buildUrl(definition);
        return this.#infoParser.parseDefinition(definition);
    }

    createView({iframe = null} = {}) {
        return new YouTubeView({
            builder: this.#embedSrcBuilder,
            createIframe: (src) => this.#iframes.create("youtube", src),
            iframe
        });
    }
}
