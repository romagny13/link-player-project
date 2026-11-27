/**
 * ROLE: look at a DOM scope and say what is in it. Nothing else.
 *
 * Stateless: it keeps nothing, never asks "was this already discovered?" (that is LinkPlayer's business,
 * through utils/ownership.js). Calling discover() twice returns the same things twice.
 * No click, no provider, no parsing of urls: only elements.
 *
 * This is the part to replace to change HOW things are found (another attribute, another convention):
 * any object with `discover(root, {defaultTarget})` returning the same shape works.
 *
 * Found:
 *   links    [data-link]            -> { element, url, target }      target: data-target, or null
 *   regions  [data-region="name"]   -> { name, element }
 *            #id of a wanted target (targets of the links + defaultTarget + `targets` given by the caller) -> { name: id, element }
 *   frames   <iframe>               -> element   (candidates to be adopted)
 */
export class RegionHost {
    /** @param {string[]} [targets] names the caller already knows (definitions, regions asked by code): looked up by id too. */
    discover(root = document, {defaultTarget = null, targets = []} = {}) {
        // links
        const links = this.links(root);
        // target elements
        const targetIds = new Set(
            links
                .map((l) => l.target)
                .filter((target) => target !== null && target !== undefined && target !== "")
        );
        if (defaultTarget) targetIds.add(defaultTarget);
        for (const name of targets) targetIds.add(name);
        const regions = this.regions(root, targetIds);
        // frames
        const frames = this.frames(root);
        return {
            links,
            regions,
            frames
        };
    }

    links(root) {
        const found = [];
        for (const element of root.querySelectorAll("[data-link]")) {
            const url = element.tagName === "A" ? element.href : element.dataset.url;
            if (url) found.push({element, url, target: element.dataset.target || null});
        }
        return found;
    }

    regions(root, targetIds = []) {
        const targetElements = new Map(); // id -> element (a name found twice: the first wins)
        for (const id of targetIds) {
            if (targetElements.has(id)) continue;
            const element = root.querySelector(`#${cssEscape(id)}`);
            if (element) targetElements.set(id, element);
        }
        return [...targetElements].map(([name, element]) => ({name, element}));
    }

    frames(root) {
        return [...root.querySelectorAll("iframe")];
    }
}

function cssEscape(id) {
    return typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(id)
        : id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}
