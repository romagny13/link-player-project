import {
  toBool,
  toIntOrNull,
  toIntList,
  toStringOrNull,
  toAutoplayMode
} from "./converters.js";

// Keys as exposed by element.dataset (data-show-on-init -> showOnInit)
export const DATA_ATTRIBUTES = Object.freeze({
  key: "key",
  url: "url", // required
  target: "target",
  autoplay: "autoplay",
  showOnInit: "showOnInit",
  index: "index",
  seasons: "seasons",
  thumbnail: "thumbnail"
});

export const LINK_SELECTOR = "[data-link]";

export class InvalidUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidUrlError";
  }
}

/** Returns the trimmed absolute URL, or throws InvalidUrlError. */
export function assertValidUrl(value) {
  const text = value == null ? "" : String(value).trim();
  if (text === "") throw new InvalidUrlError("URL is missing or empty");

  try {
    new URL(text);
  } catch {
    throw new InvalidUrlError(`URL is malformed: "${text}"`);
  }
  return text;
}

const MAX_QUERY = 48; // longer queries are replaced by a short hash

/** 32-bit FNV-1a, base36: short, stable, no dependency. */
function shortHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function keyFromUrl(url) {
  const u = new URL(assertValidUrl(url));
  // Decoded values, sorted by name (stable for repeated names): the key stays
  // readable and ?b=1&a=2 equals ?a=2&b=1. The #fragment is never part of it.
  const query = [...u.searchParams]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${u.hostname.replace(/^www\./, "")}${u.pathname}`;
  if (!query) return base;
  return `${base}?${query.length > MAX_QUERY ? `#${shortHash(query)}` : query}`;
}

/**
 * DOM -> raw values. No decision here, only copying.
 * dataUrl and href are both kept: choosing between them is parseSource's job.
 */
export function readRawLink(link) {
  const d = link.dataset ?? {};
  return {
    key: d[DATA_ATTRIBUTES.key],
    dataUrl: d[DATA_ATTRIBUTES.url],
    href: link.getAttribute?.("href") ?? undefined,
    target: d[DATA_ATTRIBUTES.target],
    autoplay: d[DATA_ATTRIBUTES.autoplay],
    showOnInit: d[DATA_ATTRIBUTES.showOnInit],
    index: d[DATA_ATTRIBUTES.index],
    seasons: d[DATA_ATTRIBUTES.seasons],
    thumbnail: d[DATA_ATTRIBUTES.thumbnail]
  };
}

/** Raw values -> SourceInfo. Pure: no DOM. Throws InvalidUrlError. */
export function parseLink(raw) {
  // data-url wins, href is the fallback (a blank data-url falls back too)
  const url = assertValidUrl(
    toStringOrNull(raw.dataUrl) ?? toStringOrNull(raw.href)
  );

  return Object.freeze({
    url,
    key: toStringOrNull(raw.key) ?? keyFromUrl(url),
    target: toStringOrNull(raw.target),
    autoplay: toAutoplayMode(raw.autoplay),
    showOnInit: toBool(raw.showOnInit),
    startIndex: toIntOrNull(raw.index),
    seasonCounts: toIntList(raw.seasons),
    thumbnail: toStringOrNull(raw.thumbnail)
  });
}

export class LinkScanner {
  findLinks(scope) {
    return scope.querySelectorAll(LINK_SELECTOR);
  }

  scan(scope = document) {
    return Array.from(this.findLinks(scope)).map((link) =>
      Object.freeze({ ...parseLink(readRawLink(link)), link })
    );
  }
}
