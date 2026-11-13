export const toInt = (value) => {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? undefined : n;
};

export const toNumber = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") return undefined;
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
};

/** data-x (present, "", "true") -> true; absent, "false", "0", "no" -> false. */
export function toBoolean(value) {
    if (value === undefined || value === null) return false;
    return !["false", "0", "no"].includes(String(value).trim().toLowerCase());
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
    if (v === "" || v === "true") return AUTOPLAY_MODES.INIT;
    if (v === "click") return AUTOPLAY_MODES.CLICK;
    return AUTOPLAY_MODES.NONE;
}

/** `<iframe#main>`: what `${element}` should have shown instead of "[object HTMLIFrameElement]". */
export function describe(el) {
    if (!el) return String(el);
    return `<${el.localName ?? typeof el}${el.id ? `#${el.id}` : ""}>`;
}
