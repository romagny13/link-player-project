import { hostOf, isUrl, UnsupportedUrlError } from "../util.js";

export class DailymotionProvider {
  id = "dailymotion";
  name = "Dailymotion";
  label = "Dailymotion player";
  panel = null; // no item list without the Dailymotion API

  /** playerId: Player ID from Dailymotion Studio. An id found in an existing embed url wins. */
  constructor({ playerId = null } = {}) {
    this._playerId = playerId;
  }

  canHandle(url) {
    try {
      const u = new URL(url);
      const h = hostOf(u);
      if (h === "geo.dailymotion.com")
        return (
          /^\/player\/[^/]+\.(?:html|js)$/.test(u.pathname) &&
          (u.searchParams.has("video") || u.searchParams.has("playlist"))
        );
      return h === "dailymotion.com" && (u.pathname.startsWith("/video/") || u.pathname.startsWith("/playlist/"));
    } catch {
      return false;
    }
  }

  /** ref: url | video id (x…) | { videoId, playlistId, playerId } */
  parse(ref) {
    if (ref && typeof ref === "object" && !Array.isArray(ref)) return this._shape(ref);
    const s = String(ref).trim();
    if (!isUrl(s)) {
      if (/^x[a-z0-9]+$/i.test(s)) return this._shape({ videoId: s });
      throw new UnsupportedUrlError(s);
    }
    if (!this.canHandle(s)) throw new UnsupportedUrlError(s);
    const u = new URL(s);
    const geo = /^\/player\/([^/]+)\.(?:html|js)$/.exec(u.pathname);
    if (hostOf(u) === "geo.dailymotion.com" && geo)
      return this._shape({
        videoId: u.searchParams.get("video"),
        playlistId: u.searchParams.get("playlist"),
        playerId: geo[1]
      });
    const video = u.pathname.match(/^\/video\/([^/]+)/);
    const playlist = u.pathname.match(/^\/playlist\/([^/]+)/);
    return this._shape({
      videoId: video?.[1] ?? null,
      playlistId: playlist?.[1] ?? u.searchParams.get("playlist")
    });
  }

  _shape({ videoId = null, playlistId = null, playerId = null }) {
    if (!videoId && !playlistId) throw new TypeError("Dailymotion: videoId or playlistId required");
    return {
      provider: this.id,
      type: videoId ? "video" : "playlist",
      id: videoId ?? playlistId,
      videoId,
      playlistId,
      playerId,
      initialIndex: null,
      isCollection: !!playlistId
    };
  }

  keyOf(p) {
    return ["dm", p.type, p.id, p.videoId && p.playlistId].filter(Boolean).join(":");
  }

  buildSrc(p, { autoplay = false } = {}) {
    const playerId = p.playerId ?? this._playerId;
    if (playerId) {
      const q = new URLSearchParams();
      if (p.videoId) q.set("video", p.videoId);
      if (p.playlistId) q.set("playlist", p.playlistId);
      if (autoplay) q.set("autoplay", "true");
      return `https://geo.dailymotion.com/player/${playerId}.html?${q}`;
    }
    // Legacy fallback: no longer guaranteed, set `dailymotionPlayerId`
    return `https://www.dailymotion.com/embed/${p.type}/${p.id}${autoplay ? "?autoplay=1" : ""}`;
  }

  thumbnailForId(id) {
    return `https://www.dailymotion.com/thumbnail/video/${id}`;
  }
  thumbnailFor(p) {
    return p.videoId ? this.thumbnailForId(p.videoId) : null;
  }
  async fetchThumbnail(p) {
    return this.thumbnailFor(p);
  }
  async discoverItems() {
    return [];
  }
  createController() {
    return { playAt() {}, dispose() {} };
  }
}