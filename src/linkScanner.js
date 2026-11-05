import { toAutoplayMode } from "./util.js";

const intAttr = (v) => (v != null && /^\d+$/.test(v) ? +v : null);

/** [data-link] elements: <a href> or any element with data-url. */
export function readLinks(root) {
    return [...root.querySelectorAll("[data-link]")].map(readLink).filter(Boolean);
}

export function readLink(node) {
    const d = node.dataset;
    const url = (node.tagName === "A" ? node.href : d.url) || "";
    if (!url) return null;
    return {
        link: node,
        url,
        target: d.target ?? "",
        meta: {
            key: d.key || undefined,
            title: d.title || node.textContent.trim(),
            channel: d.channel,
            thumbnail: d.thumbnail || node.querySelector("img")?.src || undefined, // else derived from the id
            autoplay: node.hasAttribute("data-autoplay") ? toAutoplayMode(d.autoplay) : "none",
            showOnInit: node.hasAttribute("data-show-on-init") && d.showOnInit !== "false",
            startIndex: intAttr(d.index),
            seasonCounts: d.seasons ? d.seasons.split(",").map(Number).filter((n) => n > 0) : null,
            panel: d.panel !== "false"
        }
    };
}