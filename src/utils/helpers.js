export const toInt = (v) => {
    if (v == null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
}

export const toNumber = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") return undefined;
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
};

export const toBool01 = (v) => {
    if (v === '1' || v === 1 || v === true) return true;
    if (v === '0' || v === 0 || v === false) return false;
    return null;
}

/** data-x (present, "", "true") -> true; absent, "false", "0", "no" -> false. */
export function toBoolean(value) {
    if (value === undefined || value === null) return false;
    return !["false", "0", "no"].includes(String(value).trim().toLowerCase());
}

/**
 * Seconds from an integer string ("90") or "1h2m3s" style;
 * returns null when it is none of them.
 */
export const timeToSeconds = (v) => {
    if (v == null || v === '') return null;
    if (/^\d+$/.test(v)) return parseInt(v, 10);

    const m = String(v).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;

    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

/** Seconds from a number, "90", "1:02:03", "4:46" or "1h2m3s"; NaN when it is none of them. */
export function toSeconds(value) {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : NaN;
    const s = String(value ?? "").trim();
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    if (/^\d+(:\d{1,2}){1,2}$/.test(s)) return s.split(":").reduce((t, n) => t * 60 + Number(n), 0);
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(s);
    return m && (m[1] || m[2] || m[3]) ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : NaN;
}

export const isEmpty = (v) => v === "" || v == null;

export const isTouch = () =>
    !!globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches;

export const AUTOPLAY_MODES = Object.freeze({
    NONE: "none", // false
    INIT: "init", // true
    CLICK: "click" // click
});

export function toAutoplayMode(value) {
    if (value === undefined || value === null) return AUTOPLAY_MODES.NONE;
    const v = String(value).trim().toLowerCase();
    if (v === "" || v === "true" || v === "init") return AUTOPLAY_MODES.INIT;
    if (v === "click") return AUTOPLAY_MODES.CLICK;
    return AUTOPLAY_MODES.NONE;
}

export function describe(el) {
    if (!el) return String(el);
    const name = el.localName ?? el.tagName?.toLowerCase() ?? typeof el;
    return `<${name}${el.id ? `#${el.id}` : ""}>`;
}

export const SOURCE_KINDS = Object.freeze({LINK: "link", FRAME: "frame", DEFINITION: "definition"});

