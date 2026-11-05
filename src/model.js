import { DuplicateEntryError, isUrl, makeItem, toAutoplayMode } from "./util.js";

/** Content of a playlist: items declared in code, or discovered by the provider. Resolved once, never rejects. */
export class Playlist {
  constructor({ provider, parsed, items = null, seasonCounts = null }) {
    this.provider = provider;
    this.parsed = parsed;
    this.seasonCounts = seasonCounts;
    this._declared = items ? items.map((it, i) => makeItem(it.id, i, {
      ...it,
      thumbnail: it.thumbnail ?? provider.thumbnailForId?.(it.id) ?? ""
    })) : null;
    this._items = null;
  }
  get isDeclared() { return !!this._declared; }
  /** Declared items win (no network); otherwise the provider discovers them. */
  ensureItems() {
    return this._items ??= this._declared
      ? Promise.resolve(this._declared)
      : Promise.resolve(this.provider.discoverItems(this.parsed)).catch(() => []);
  }
}

/** One navigable source: describes itself (title, thumbnail...) and points to its playlist, if any. */
export class Entry {
  constructor({ key, provider, parsed, url = null, meta = {}, source = "code", link = null, playlist = null }) {
    Object.assign(this, { key, provider, parsed, url, source, link, playlist, set: null });
    this.title = meta.title ?? "";
    this.channel = meta.channel ?? "";
    this.thumbnail = meta.thumbnail ?? provider.thumbnailFor(parsed) ?? null;
    this.duration = meta.duration ?? null;
    this.autoplay = toAutoplayMode(meta.autoplay);
    this.startIndex = meta.startIndex ?? null;
    this.showOnInit = !!meta.showOnInit;
    this.panel = meta.panel !== false;
    this._thumb = null;
  }
  get isCollection() { return !!this.playlist; }
  get seasonCounts() { return this.playlist?.seasonCounts ?? null; }
  ensureItems() { return this.playlist ? this.playlist.ensureItems() : Promise.resolve([]); }
  resolveThumbnail() {
    return this._thumb ??= this.thumbnail
      ? Promise.resolve(this.thumbnail)
      : Promise.resolve(this.provider.fetchThumbnail(this.parsed)).then((u) => this.thumbnail = u ?? null).catch(() => null);
  }
}

/**
 * A group of entries of one provider, with shared properties. Every method returns the set (chainable).
 * meta: title, channel, thumbnail, duration, autoplay ("none"|"init"|"click"), startIndex, showOnInit,
 *       panel, seasonCounts, key
 * @throws DuplicateEntryError, UnsupportedUrlError, TypeError
 */
export class EntrySet {
  constructor(region, provider, commonProps = {}) {
    this.region = region;
    this.provider = provider;
    this.commonProps = commonProps;
    this.entries = [];
  }

  /** A page url, in any form the provider understands (watch?v=, ok.ru/video/..., playlist url...). */
  addUrl(url, meta = {}) {
    if (!isUrl(url)) throw new TypeError(`addUrl(): an http(s) url is required, got "${url}"`);
    this._create(this.provider.parse(url), url, meta);
    return this;
  }

  /** One video, by its id. */
  addVideo(id, meta = {}) {
    this._create(this._parse({ videoId: String(id) }, "addVideo"), null, meta);
    return this;
  }

  /**
   * A playlist hosted by the provider, by its id.
   * meta.items: the content you already know (skips the API). Its order must match the real playlist.
   */
  addPlaylist(id, meta = {}) {
    this._create(this._parse({ playlistId: String(id) }, "addPlaylist"), null, meta);
    return this;
  }

  /** A playlist made of these videos: items = [{ id, title?, channel?, thumbnail?, duration? }] or ids. */
  addVideos(items, meta = {}) {
    if (!Array.isArray(items) || !items.length) throw new TypeError("addVideos(): a non-empty array is required");
    const list = items.map((it) => (it !== null && typeof it === "object" ? it : { id: it }));
    const ids = list.map((it) => String(it.id));
    // Each provider reads the key it knows (videoIds for YouTube, itemIds for Ok.ru)
    this._create(this._parse({ videoIds: ids, itemIds: ids }, "addVideos"), null, { ...meta, items: list });
    return this;
  }

  /** The provider cannot represent this kind of source (no playlist id on Ok.ru, no list on Dailymotion...). */
  _parse(shape, method) {
    try {
      return this.provider.parse(shape);
    } catch (error) {
      if (error instanceof TypeError) throw new TypeError(`${this.provider.name} does not support ${method}()`);
      throw error;
    }
  }

  /** @internal detected links, adopted embeds, ensureEntry: url only. Returns the entry. */
  _add(ref, meta, source, extra = {}) {
    return this._create(this.provider.parse(ref), isUrl(ref) ? ref : null, meta, source, extra);
  }

  _create(parsed, url, meta = {}, source = "code", extra = {}) {
    const m = { ...this.commonProps, ...meta };
    const key = m.key ?? this.provider.keyOf(parsed) + (m.startIndex != null ? `@${m.startIndex}` : "");
    const declared = m.items?.length ? m.items : null;
    const playlist = declared || parsed.isCollection
      ? new Playlist({ provider: this.provider, parsed, items: declared, seasonCounts: m.seasonCounts })
      : null;
    const entry = new Entry({ key, provider: this.provider, parsed, url, meta: m, source, link: extra.link ?? null, playlist });
    this.region._register(this, entry);
    entry.set = this;
    this.entries.push(entry);
    return entry;
  }
}