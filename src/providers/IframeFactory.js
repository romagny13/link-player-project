import {makeIframe} from "../utils/dom.js";

/**
 * ROLE: create an iframe with the usual attributes of a provider (shortcuts per provider).
 * It does not know what goes in the iframe, only how it is made. The `src` comes from an EmbedSrcBuilder.
 */
export class IframeFactory {
    #presets = new Map();

    constructor(presets = IframeFactory.defaultPresets) {
        for (const [name, preset] of Object.entries(presets)) this.register(name, preset);
    }

    static defaultPresets = Object.freeze({
        youtube: {
            width: "560", height: "315", title: "YouTube video player",
            allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
            referrerPolicy: "strict-origin-when-cross-origin"
        },
        okru: {
            width: "560", height: "315", title: "OK.ru video player",
            allow: "autoplay; fullscreen",
            referrerPolicy: "strict-origin-when-cross-origin"
        }
    });

    register(name, preset) {
        this.#presets.set(name, Object.freeze({...preset}));
        return this;
    }

    /** @param {string} name  a preset ("youtube", "okru"...), or any name: then only `overrides` apply. */
    create(name, src, overrides = {}) {
        return makeIframe({allowFullscreen: true, ...this.#presets.get(name), ...overrides, src});
    }
}
