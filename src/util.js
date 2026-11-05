export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
export const isTouch = () =>
  !!globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches;
export const hostOf = (u) => u.hostname.replace(/^www\./, "");
export const intParam = (u, name) => {
  const v = u.searchParams.get(name);
  return v !== null && /^\d+$/.test(v) ? +v : null;
};
export const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
export const isUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s.trim());
export const DAY = 24 * 60 * 60 * 1000;

export const AUTOPLAY_MODES = Object.freeze({ NONE: "none", INIT: "init", CLICK: "click" });
export function toAutoplayMode(value) {
  if (value === undefined || value === null) return AUTOPLAY_MODES.NONE;
  const v = String(value).trim().toLowerCase();
  if (v === "" || v === "true" || v === "init") return AUTOPLAY_MODES.INIT;
  if (v === "click") return AUTOPLAY_MODES.CLICK;
  return AUTOPLAY_MODES.NONE;
}

/** 32-bit FNV-1a, base36: short, stable keys for long id lists. */
export function shortHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export class UnsupportedUrlError extends Error {
  constructor(ref) {
    super(`No provider can handle this reference: ${ref}`);
    this.name = "UnsupportedUrlError";
  }
}
export class DuplicateEntryError extends Error {
  constructor(key) {
    super(`Entry already registered: ${key}`);
    this.name = "DuplicateEntryError";
  }
}

/** One video of a playlist. */
export var makeItem = (id, index, { title = "", channel = "", thumbnail = "", duration = null, ...extra } = {}) => ({
  ...extra,
  id: String(id),
  index,
  title: title || `Video ${index + 1}`,
  channel,
  thumbnail,
  duration
});

/** Element, id or selector. null → global. Throws when a given scope does not exist. */
export function resolveScope(scope) {
  if (scope == null) return null;
  if (scope instanceof Element) return scope;
  if (typeof scope === "string") {
    let node = document.getElementById(scope);
    if (!node) {
      try {
        node = document.querySelector(scope);
      } catch {
        /* not a selector */
      }
    }
    if (node) return node;
  }
  throw new Error(`Scope not found: ${String(scope)}`);
}