import {toNumber, toBoolean} from "../utils/helpers.js";

export class InfoParser {
    getUrl(element) {
        if (element.tagName === "A") return element.href;
        if (element.tagName === "IFRAME") return element.src;
        return element.dataset?.url;
    }

    parseStartTime(t) {
        if (!t) return undefined;

        // If it's just a raw number (e.g., "120" in seconds)
        if (/^\d+$/.test(t)) return Number(t);

        // Regex matching YouTube's h/m/s format
        const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(t);

        // If regex matches but no h, m, or s value was captured (invalid string), reject
        if (!m || (!m[1] && !m[2] && !m[3])) return undefined;

        return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    }

    parseJsonAttribute(value, name) {
        if (value === undefined) return undefined;
        let data;
        try {
            data = JSON.parse(value);
        } catch (error) {
            throw new Error(`Invalid JSON in ${name}: ${error.message}`);
        }
        if (!Array.isArray(data)) throw new Error(`${name} must be a JSON array`);
        return data;
    }

    readLinkData(element) {
        const data = element.dataset;
        return {
            autoplay: data.autoplay,
            start: data.start,            // raw: parseStartTime reads "90" and "1m30s"
            title: data.title,
            channel: data.channel,
            thumbnail: data.thumbnail,
            videos: this.parseJsonAttribute(data.videos, "data-videos") ?? [],
            index: toNumber(data.index),
            target: data.target ?? (element.tagName === "IFRAME" ? element.parentElement?.id : undefined),
            showOnInit: toBoolean(data.showOnInit),
            key: data.key,
        };
    }

    parseFromElement(element) {
        const url = this.getUrl(element);
        if (!url) throw new Error(`No URL found for element '${element}'`);
        return this.parseDefinition({url, ...this.readLinkData(element)});
    }

    parseDefinition(def) {
        throw new Error("parseDefinition() must be implemented");
    }
}

