/** undefined -> false ; "" (attribute present) -> true ; "false"/"0" -> false ; otherwise -> true */
export function toBool(value) {
  if (value === undefined || value === null) return false;
  const v = String(value).trim().toLowerCase();
  return v !== "false" && v !== "0";
}

/** Integer >= 0, otherwise null */
export function toIntOrNull(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return /^\d+$/.test(v) ? parseInt(v, 10) : null;
}

/** "12, 26,26" -> [12, 26, 26] ; invalid values ignored ; empty list -> null */
export function toIntList(value) {
  if (value === undefined || value === null) return null;
  const list = String(value)
    .split(",")
    .map(toIntOrNull)
    .filter((n) => n !== null && n > 0);
  return list.length > 0 ? list : null;
}

/** Non-empty string, otherwise null */
export function toStringOrNull(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  return v === "" ? null : v;
}

export const AUTOPLAY_MODES = Object.freeze({
  NONE: "none",
  CLICK: "click",
  ALWAYS: "always"
});

/** undefined -> none ; "" / "true" / "always" -> always ; "click" -> click ; other -> none */
export function toAutoplayMode(value) {
  if (value === undefined || value === null) return AUTOPLAY_MODES.NONE;
  const v = String(value).trim().toLowerCase();
  if (v === "" || v === "true" || v === "always") return AUTOPLAY_MODES.ALWAYS;
  if (v === "click") return AUTOPLAY_MODES.CLICK;
  return AUTOPLAY_MODES.NONE; // "none", "false", "0", unknown values
}

/** Pure decision: should this navigation autoplay? */
export function shouldAutoplay(mode, trigger) {
  // trigger: 'click' | 'init'
  if (mode === AUTOPLAY_MODES.ALWAYS) return true;
  return mode === AUTOPLAY_MODES.CLICK && trigger === "click";
}
