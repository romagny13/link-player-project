import { hostOf, intParam, safeDecode, shortHash, makeItem, isUrl, UnsupportedUrlError } from "../util.js";

export class OkruProvider {
    id = "okru";
    name = "Ok.ru";
    label = "Ok.ru player";
    panel = { toggle: "top-right", open: true };

    constructor({ embedBaseUrl = "https://ok.ru/videoembed/", fetchFn = (...a) => fetch(...a) } = {}) {
        this._base = embedBaseUrl;
        this._fetch = fetchFn;
    }

    canHandle(url) {
        try {
            const u = new URL(url);
            return hostOf(u) === "ok.ru" && u.pathname.startsWith("/video/");
        } catch {
            return false;
        }
    }

    /** ref: url | video id | array of ids | { videoId, itemIds, labels, initialIndex } */
    parse(ref) {
        if (Array.isArray(ref)) return this._shape({ itemIds: ref.map(String) });
        if (ref && typeof ref === "object") return this._shape(ref);
        const s = String(ref).trim();
        if (isUrl(s)) return this._parseUrl(s);
        if (/^\d+$/.test(s)) return this._shape({ videoId: s });
        throw new UnsupportedUrlError(s);
    }

    _shape({ videoId = null, itemIds = null, labels = [], initialIndex = null }) {
        const ids = itemIds?.length ? itemIds.map(String) : videoId ? [String(videoId)] : [];
        if (!ids.length) throw new TypeError("Ok.ru: videoId or itemIds required");
        const id = videoId ? String(videoId) : ids[0];
        return {
            provider: this.id,
            videoId: id,
            itemIds: ids,
            labels,
            initialIndex: initialIndex ?? Math.max(ids.indexOf(id), 0),
            isCollection: ids.length > 1
        };
    }

    _parseUrl(url) {
        if (!this.canHandle(url)) throw new UnsupportedUrlError(url);
        const u = new URL(url);
        const videoId = u.pathname.match(/^\/video\/([^/]+)/)[1];
        const listed = (u.searchParams.get("video_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const itemIds = !listed.length ? [videoId] : listed.includes(videoId) ? listed : [videoId, ...listed];

        // Raw match on purpose: titles contain encoded commas, so split BEFORE decoding
        const raw = u.search.match(/[?&]labels=([^&]*)/)?.[1];
        const names = raw ? raw.split(",").map((s) => safeDecode(s.trim())).filter(Boolean) : [];
        const offset = itemIds.length - listed.length;
        const labels = offset > 0 && listed.length ? [...Array(offset).fill(""), ...names] : names;

        return this._shape({ videoId, itemIds, labels, initialIndex: intParam(u, "index") });
    }

    keyOf(p) {
        return [
            "ok",
            p.videoId,
            p.itemIds.length > 1 && shortHash(p.itemIds.join(",")),
            p.initialIndex > 0 && `i${p.initialIndex}`
        ]
            .filter(Boolean)
            .join(":");
    }

    buildSrc(p, { autoplay = false, index = null } = {}) {
        const id = index === null ? p.videoId : p.itemIds[index] ?? p.videoId;
        return `${this._base}${id}${autoplay ? (this._base.includes("?") ? "&" : "?") + "autoplay=1" : ""}`;
    }

    thumbnailForId() {
        return null; // needs the oEmbed endpoint
    }
    thumbnailFor() {
        return null;
    }
    async fetchThumbnail(p) {
        try {
            const res = await this._fetch(
                `https://ok.ru/oembed?url=${encodeURIComponent(`https://ok.ru/video/${p.videoId}`)}&format=json`
            );
            return res.ok ? (await res.json()).thumbnail_url ?? null : null;
        } catch {
            return null;
        }
    }

    async discoverItems(p) {
        return p.itemIds.length < 2 ? [] : p.itemIds.map((id, i) => makeItem(id, i, { title: p.labels[i] }));
    }

    /** No player API on Ok.ru: changing video means reloading the iframe. */
    createController(iframe, { parsed }) {
        return {
            playAt: (i, { autoplay = true } = {}) => {
                iframe.src = this.buildSrc(parsed, { autoplay, index: i });
            },
            dispose() { }
        };
    }
}