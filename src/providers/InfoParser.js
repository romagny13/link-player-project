import {toNumber, toBoolean} from "../utils/helpers.js";

export class InfoParser {
    getUrl(element) {
        if (element.tagName === "A") return element.href;
        if (element.tagName === "IFRAME") return element.src;
        return element.dataset?.url;
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
            start: data.start,            // raw: reads "90" and "1m30s"
            title: data.title,
            description: data.description,
            channel: data.channel,
            channelUrl: data.channelUrl,
            thumbnail: data.thumbnail,
            duration: data.duration,
            videos: this.parseJsonAttribute(data.videos, "data-videos") ?? [],
            index: toNumber(data.index),
            target: data.target ?? (element.tagName === "IFRAME" ? element.parentElement?.id : undefined),
            showOnInit: toBoolean(data.showOnInit),
            key: data.key,
            extra: data.extra
        };
    }

    parseUrl(url) {
        throw new Error("parseUrl() must be implemented");
    }

    parseSrc(src) {
        throw new Error("parseSrc() must be implemented");
    }

    buildUrl(def) {
        throw new Error("buildUrl() must be implemented");
    }

    parseFromLink(link) {
        const url = this.getUrl(link);
        if (!url) throw new Error(`No URL found for element '${link}'`);
        return this.parseDefinition({url, ...this.readLinkData(link)});
    }

    parseFromFrame(frame){
        throw new Error("parseFromFrame() must be implemented");
    }

    parseDefinition(def) {
        throw new Error("parseDefinition() must be implemented");
    }

    getValidUrl(url) {
        try {
            return new URL(String(url).trim());
        } catch {
            return null;
        }
    }
}

