/**
 * Updates an element of the page after each navigation of a region (sugar over region.afterNavigate()).
 *
 *   bindView(region, "#title", (el, to) => { el.textContent = to.item?.title ?? ""; }, {immediate: true});
 *
 * The target is resolved at EVERY call, not at registration: an element created later is found, a
 * replaced one is not stale. When it is absent or detached, nothing happens (no error).
 *
 * @param {import("./Region.js").Region} region
 * @param {string|Element|(() => Element|null)} target CSS selector, element, or a function that finds it
 *   (use a function to search inside a scope instead of the whole document).
 * @param {(element: Element, to: object, from: object|null) => void} update `to` / `from`: see afterNavigate().
 * @param {{immediate?: boolean}} [options] Given to afterNavigate().
 * @returns {() => void} Function that removes the binding.
 */
export function bindView(region, target, update, options) {
    const resolve =
        typeof target === "function" ? target
            : typeof target === "string" ? () => document.querySelector(target)
                : () => target;

    return region.afterNavigate((to, from) => {
        const element = resolve();
        if (element?.isConnected) update(element, to, from);
    }, options);
}
