import { hostOf, intParam, shortHash, makeItem, isUrl, DAY, UnsupportedUrlError } from "../util.js";

const YT_ORIGINS = ["https://www.youtube.com", "https://www.youtube-nocookie.com"];
const thumbOf = (id) => `https://img.youtube.com/vi/${id}/mqdefault.jpg`; // 16:9, no black bars
const isoToSeconds = (s = "") => {
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null;
};

export class YouTubeEmbedSrcBuilder {
    // video:        /embed/ID?enablejsapi=1&origin=…&autoplay=1&start=42
    // playlist id:  /embed/videoseries?enablejsapi=1&list=PL…&index=0
    // video ids:    /embed/videoseries?enablejsapi=1&playlist=a,b,c&index=0   (index is 0-based)
    constructor({ origin = globalThis.location?.origin ?? "" } = {}) {
        this._origin = origin;
    }

    buildSrc({ autoplay = false, startSeconds = null, videoId = null, videoIds = null, playlistId = null, index = null } = {}) {
        const q = new URLSearchParams({ enablejsapi: "1" });
        if (this._origin) q.set("origin", this._origin);
        if (autoplay) q.set("autoplay", "1");
        if (startSeconds !== null) q.set("start", startSeconds);

        if (videoIds?.length) {
            q.set("playlist", videoIds.join(","));
            if (index !== null) q.set("index", index);
            return `https://www.youtube.com/embed/videoseries?${q}`;
        }
        if (playlistId) {
            q.set("list", playlistId);
            if (index !== null || !videoId) {
                if (index !== null) q.set("index", index);
                return `https://www.youtube.com/embed/videoseries?${q}`;
            }
        }
        if (!videoId) throw new TypeError("YouTube: videoId, videoIds or playlistId required");
        return `https://www.youtube.com/embed/${videoId}?${q}`;
    }
}

export class YouTubeProvider {
    id = "youtube";
    name = "YouTube";
    label = "YouTube player";
    panel = { toggle: "bottom-left", open: false };

    constructor({ apiKey = null, store = null, fetchFn = (...a) => fetch(...a), origin } = {}) {
        this._apiKey = apiKey;
        this._store = store;
        this._fetch = fetchFn;
        this._src = new YouTubeEmbedSrcBuilder({ origin });
    }

    canHandle(url) {
        try {
            const u = new URL(url);
            const h = hostOf(u);
            if ((h === "youtube.com" || h === "youtube-nocookie.com") && /^\/embed(\/|$)/.test(u.pathname)) return true;
            if (h === "youtube.com")
                return (
                    (u.pathname === "/watch" && u.searchParams.has("v")) ||
                    (u.pathname === "/watch_videos" && u.searchParams.has("video_ids"))
                );
            return h === "youtu.be" && u.pathname.length > 1;
        } catch {
            return false;
        }
    }

    /** ref: url | video id | playlist id | array of video ids | { videoId, playlistId, videoIds, startSeconds, initialIndex } */
    parse(ref) {
        if (Array.isArray(ref)) return this._shape({ videoIds: ref.map(String) });
        if (ref && typeof ref === "object") return this._shape(ref);
        const s = String(ref).trim();
        if (isUrl(s)) return this._parseUrl(s);
        if (/^(PL|UU|LL|FL|OL|RD)[\w-]{10,}$/.test(s)) return this._shape({ playlistId: s });
        if (/^[\w-]{11}$/.test(s)) return this._shape({ videoId: s });
        throw new UnsupportedUrlError(s);
    }

    _shape({ videoId = null, playlistId = null, videoIds = null, startSeconds = null, initialIndex = null }) {
        const ids = videoIds?.length ? videoIds : null;
        return {
            provider: this.id,
            videoId,
            playlistId,
            videoIds: ids,
            startSeconds,
            initialIndex,
            isCollection: !!(ids || playlistId)
        };
    }

    _parseUrl(url) {
        if (!this.canHandle(url)) throw new UnsupportedUrlError(url);
        const u = new URL(url);
        const emb = /^\/embed(?:\/([^/]+))?\/?$/.exec(u.pathname);
        const pathId = emb?.[1] && emb[1] !== "videoseries" ? emb[1] : null;
        const ids = u.searchParams.get(emb ? "playlist" : "video_ids");
        const videoIds = ids ? ids.split(",").map((s) => s.trim()).filter(Boolean) : null;
        if (pathId && videoIds && !videoIds.includes(pathId)) videoIds.unshift(pathId);
        const urlIndex = intParam(u, "index");
        return this._shape({
            videoId: emb ? pathId : hostOf(u) === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v"),
            playlistId: u.searchParams.get("list"),
            videoIds,
            startSeconds: intParam(u, "start") ?? intParam(u, "t"),
            initialIndex: urlIndex === null ? null : emb ? urlIndex : Math.max(urlIndex - 1, 0) // watch: 1-based
        });
    }

    keyOf(p) {
        return [
            "yt",
            p.videoId,
            p.playlistId,
            p.videoIds && shortHash(p.videoIds.join(",")),
            p.startSeconds && `t${p.startSeconds}`,
            p.initialIndex != null && `i${p.initialIndex}`
        ]
            .filter(Boolean)
            .join(":");
    }

    buildSrc(p, { autoplay = false, index = null } = {}) {
        return this._src.buildSrc({ ...p, autoplay, index });
    }

    thumbnailForId(id) {
        return thumbOf(id);
    }
    thumbnailFor(p) {
        const id = p.videoId ?? p.videoIds?.[0];
        return id ? thumbOf(id) : null;
    }
    /** Playlist without a known first id: take the first discovered item. */
    async fetchThumbnail(p) {
        return this.thumbnailFor(p) ?? (await this.discoverItems(p))[0]?.thumbnail ?? null;
    }

    /** Never rejects. Titles/durations need the Data API; without a key the items are generic. */
    async discoverItems(p) {
        const key = p.playlistId ?? p.videoIds?.join(",");
        if (!key) return [];
        const cached = this._store?.get(`yt:${key}`);
        if (cached) return cached;

        let ids = p.videoIds ?? [];
        try {
            if (!this._apiKey) throw new Error("no apiKey (needed for list= playlists and titles)");
            if (p.playlistId) ids = await this._playlistIds(p.playlistId);
            const items = (await this._videos(ids)).map((v, i) => makeItem(v.id, i, v));
            if (items.length) this._store?.set(`yt:${key}`, items, DAY);
            return items;
        } catch (error) {
            console.warn("[YouTubeProvider]", error.message);
            return ids.map((id, i) => makeItem(id, i, { thumbnail: thumbOf(id) }));
        }
    }

    async _json(path, params) {
        const q = new URLSearchParams({ ...params, key: this._apiKey });
        const res = await this._fetch(`https://www.googleapis.com/youtube/v3/${path}?${q}`);
        if (!res.ok) throw new Error(`YouTube API ${res.status}`);
        return res.json();
    }

    async _playlistIds(playlistId) {
        const ids = [];
        let pageToken = "";
        do {
            const d = await this._json("playlistItems", {
                part: "contentDetails",
                maxResults: "50",
                playlistId,
                ...(pageToken && { pageToken })
            });
            d.items?.forEach((i) => i.contentDetails?.videoId && ids.push(i.contentDetails.videoId));
            pageToken = d.nextPageToken ?? "";
        } while (pageToken);
        return ids;
    }

    async _videos(ids) {
        const out = [];
        for (let i = 0; i < ids.length; i += 50) {
            const d = await this._json("videos", {
                part: "snippet,status,contentDetails",
                id: ids.slice(i, i + 50).join(",")
            });
            for (const v of d.items ?? []) {
                if (v.status?.privacyStatus === "private") continue;
                out.push({
                    id: v.id,
                    title: v.snippet.title,
                    channel: v.snippet.channelTitle || "",
                    thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || "",
                    duration: isoToSeconds(v.contentDetails?.duration)
                });
            }
        }
        return out;
    }

    /** postMessage API. onItemChange fires for changes made by the player itself. */
    createController(iframe, { index = null, onItemChange = () => { } } = {}) {
        const post = (m) => iframe.contentWindow?.postMessage(JSON.stringify(m), "*");
        let synced = index === null;
        const onLoad = () => post({ event: "listening" });
        const onMessage = (e) => {
            if (!YT_ORIGINS.includes(e.origin) || e.source !== iframe.contentWindow) return;
            let d;
            try {
                d = JSON.parse(e.data);
            } catch {
                return;
            }
            if (d.event !== "infoDelivery" || d.info?.playerState !== 1 || !Number.isInteger(d.info.playlistIndex)) return;
            if (!synced) {
                synced = true; // YouTube sometimes starts on the first video: force the expected one once
                if (d.info.playlistIndex !== index) return controller.playAt(index);
            }
            onItemChange(d.info.playlistIndex);
        };
        const controller = {
            playAt: (i) => post({ event: "command", func: "playVideoAt", args: [i] }),
            dispose() {
                globalThis.removeEventListener("message", onMessage);
                iframe.removeEventListener("load", onLoad);
            }
        };
        globalThis.addEventListener("message", onMessage);
        iframe.addEventListener("load", onLoad);
        return controller;
    }
}