import {OkruInfoParser} from "./OkruInfoParser.js";
import {OkruPlayer} from "./OkruPlayer.js";
import {makeIframe} from "../../utils/dom.js";

export class OkruProvider {
    id = "okru";
    hosts = ["ok.ru"];
    #infoParser;
    #embedBaseUrl;

    constructor({infoParser = null, embedBaseUrl = null} = {}) {
        this.#infoParser = infoParser ?? new OkruInfoParser();
        this.#embedBaseUrl = embedBaseUrl;
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
        return new OkruPlayer({
            createIframe: (src) =>
                makeIframe({
                    width: "560",
                    height: "315",
                    src,
                    title: "OK.ru video player",
                    allow: "autoplay; fullscreen",
                    referrerPolicy: "strict-origin-when-cross-origin",
                    allowFullscreen: true,
                    extraAttrs: {}
                }),
            iframe,
            embedBaseUrl: this.#embedBaseUrl
        });
    }
}
