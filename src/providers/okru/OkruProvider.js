import {OkruLinkParser} from "./OkruLinkParser.js";
import {OkruPlayer} from "./OkruPlayer.js";
import {makeIframe} from "../../utils/dom.js";

export class OkruProvider {
    id = "okru";
    hosts = ["ok.ru"];
    #linkParser;
    #embedBaseUrl;

    constructor({linkParser = null, embedBaseUrl = null} = {}) {
        this.#linkParser = linkParser ?? new OkruLinkParser();
        this.#embedBaseUrl = embedBaseUrl;
    }

    getInfo(link) {
        return this.#linkParser.parse(link);
    }

    createPlayer({iframe = null} = {}) {
        return new OkruPlayer({
            createIframe: (src) => makeIframe({
                width: "560", height: "315", src,
                title: "OK.ru video player",
                allow: "autoplay; fullscreen",
                referrerPolicy: "strict-origin-when-cross-origin",
                allowFullscreen: true,
                extraAttrs: {}
            }),
            iframe,
            embedBaseUrl : this.#embedBaseUrl
        });
    }
}