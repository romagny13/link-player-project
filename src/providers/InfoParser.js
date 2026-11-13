import {toNumber, toBoolean} from "../utils/helpers.js";

export class InfoParser {
    getUrl(element) {
        if (element.tagName === "A") return element.href;
        if (element.tagName === "IFRAME") return element.src;
        return element.dataset?.url;
    }

    toInt(v) {
        if (v == null || v === '') return null;
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? null : n;
    }

    toBool01(v) {
        if (v === '1' || v === 1 || v === true) return true;
        if (v === '0' || v === 0 || v === false) return false;
        return null;
    }

    timeToSeconds(v) {
        if (v == null || v === '') return null;
        if (/^\d+$/.test(v)) return parseInt(v, 10);

        const m = String(v).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
        if (!m || (!m[1] && !m[2] && !m[3])) return null;

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

