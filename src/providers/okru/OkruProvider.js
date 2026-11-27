import {MediaProvider} from "../MediaProvider.js";
import {OkruInfoParser} from "./OkruInfoParser.js";
import {OkruEmbedSrcBuilder} from "./OkruEmbedSrcBuilder.js";
import {OkruView} from "./OkruView.js";
import {IframeFactory} from "../../views/IframeFactory.js";

export class OkruProvider extends MediaProvider {
    id = "okru";
    hosts = ["ok.ru", "odnoklassniki.ru"];

    #infoParser;
    #urlBuilder;
    #iframes;

    constructor({infoParser = null, embedBaseUrl = null, urlBuilder = null, iframeFactory = null} = {}) {
        super();
        this.#infoParser = infoParser ?? new OkruInfoParser();
        this.#urlBuilder = urlBuilder ?? new OkruEmbedSrcBuilder({relayBaseUrl: embedBaseUrl});
        this.#iframes = iframeFactory ?? new IframeFactory();
    }

    getInfoFromFrame(frame) {
        return this.#infoParser.parseFromFrame(frame);
    }

    getInfoFromLink(link) {
        return this.#infoParser.parseFromLink(link);
    }

    getInfoFromDefinition(definition) {
        if (!definition.url) definition.url = this.#infoParser.buildUrl(definition);
        return this.#infoParser.parseDefinition(definition);
    }

    createView({iframe = null} = {}) {
        return new OkruView({
            urlBuilder: this.#urlBuilder,
            createIframe: (src) => this.#iframes.create("okru", src),
            iframe
        });
    }
}
