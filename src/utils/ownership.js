/**
 * Who handles an element: ONE owner at a time (a binder, a region, an adopted iframe...).
 *
 * The truth is a module-level WeakMap, not an attribute: `cloneNode()` copies `data-lp` but not a WeakMap entry,
 * so a clone of an already handled link is a new element for everybody.
 * `data-lp` is only a mirror, there to look at in the dev tools.
 */
const owners = new WeakMap();

/** @returns {boolean} true when `owner` now owns the element (false: somebody else already does). */
export function claim(element, owner) {
    const known = owners.get(element);
    if (known && known !== owner) return false;
    owners.set(element, owner);
    if (element.dataset) element.dataset.lp = String(owner?.name ?? owner?.id ?? "lp");
    return true;
}

/** Only the owner can release. */
export function release(element, owner) {
    if (owners.get(element) !== owner) return;
    owners.delete(element);
    if (element.dataset) delete element.dataset.lp;
}

export const isClaimed = (element) => owners.has(element);

export const ownerOf = (element) => owners.get(element) ?? null;
