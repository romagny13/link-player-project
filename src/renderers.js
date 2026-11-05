import { el } from "./util.js";
import { groupBySeason } from "./seasons.js";

export const clampWidth = (px, hostWidth) =>
    Math.min(Math.max(Math.round(px), 140), Math.max(140, Math.floor(hostWidth * 0.7)));

/**
 * Panel renderer contract (override with the `panelRenderer` option or region.setPanelRenderer()):
 *   ctx    { host, entry, items, index, cfg:{toggle,open}, onSelect(i), widths, resizable }
 *   return { setActive(i, mode?), destroy() }
 */

export function defaultPanelRenderer({ host, entry, items, index, cfg, onSelect, widths, resizable, itemRenderer = defaultItemRenderer }) {
    const defaultWidth = items.some((i) => i.thumbnail) ? 280 : 176;
    const setWidth = (w) => {
        const v = clampWidth(w, host.clientWidth || Infinity);
        host.style.setProperty("--lp-w", `${v}px`);
        return v;
    };
    let width = setWidth(widths?.get() ?? defaultWidth);

    const root = el("div", "lp-panel");
    const head = el("div", "lp-head");
    const toggle = el("button", "lp-toggle", "☰");
    const close = el("button", "lp-close", "»");
    const handle = el("div", "lp-resize");
    toggle.type = close.type = "button";
    toggle.dataset.pos = cfg?.toggle ?? "top-right";
    toggle.title = toggle.ariaLabel = "Show playlist";
    close.title = close.ariaLabel = "Hide playlist";
    head.append(el("span", "", `Playlist · ${items.length}`), close);
    root.append(head);

    let fromUser = false; // a click inside the panel must not move the scroll

    /** "center": middle of the panel. "nearest": scroll only when the item is hidden. */
    const reveal = (mode) => {
        const a = root.querySelector(".lp-active");
        if (!a) return;
        const headH = head.offsetHeight;
        const top = a.offsetTop;
        const bottom = top + a.offsetHeight;
        let next = null;
        if (mode === "center") next = top - headH - (root.clientHeight - headH - a.offsetHeight) / 2;
        else if (top < root.scrollTop + headH) next = top - headH;
        else if (bottom > root.scrollTop + root.clientHeight) next = bottom - root.clientHeight;
        if (next !== null) root.scrollTop = Math.max(0, next); // not scrollIntoView: it scrolls the page
    };
    const setOpen = (open) => {
        root.classList.toggle("lp-closed", !open);
        toggle.hidden = open;
        handle.hidden = !open || !resizable;
        if (open) reveal("center");
    };
    toggle.onclick = () => setOpen(true);
    close.onclick = () => setOpen(false);

    const makeItem = (it) => {
        const d = el("div", "lp-item");
        d.dataset.i = it.index;
        d.title = it.title;
        d.tabIndex = 0;
        d.setAttribute("role", "button");

        let content;
        try {
            content = itemRenderer({ item: it, entry });
        } catch (error) {
            console.warn("[LinkPlayer] itemRenderer failed, default used", error);
            content = defaultItemRenderer({ item: it, entry });
        }
        d.append(...[].concat(content ?? []));

        const pick = (i) => {
            fromUser = true;
            try {
                onSelect(i);
            } finally {
                fromUser = false;
            }
        };
        d.onclick = () => pick(it.index);
        d.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick(it.index);
            }
        };
        return d;
    };

    const groups = groupBySeason(items, entry.seasonCounts);
    if (!groups) items.forEach((it) => root.append(makeItem(it)));
    else
        groups.forEach((g) => {
            const sec = el("div", "lp-season");
            const sh = el("div", "lp-sh", `${g.label} (${g.end - g.start})`);
            sh.onclick = () => sec.classList.toggle("lp-collapsed");
            sec.append(sh, ...items.slice(g.start, g.end).map(makeItem));
            if (!(index >= g.start && index < g.end)) sec.classList.add("lp-collapsed");
            root.append(sec);
        });

    // resize: drag, double-click to reset, arrow keys
    let drag = null;
    handle.tabIndex = 0;
    handle.title = "Drag to resize (double-click to reset)";
    handle.setAttribute("role", "separator");
    handle.onpointerdown = (e) => {
        if (e.button) return;
        drag = { x: e.clientX, w: root.getBoundingClientRect().width };
        handle.setPointerCapture(e.pointerId);
        host.classList.add("lp-resizing");
        e.preventDefault();
    };
    handle.onpointermove = (e) => {
        if (drag) width = setWidth(drag.w + drag.x - e.clientX); // panel is on the right
    };
    handle.onpointerup = handle.onpointercancel = () => {
        if (!drag) return;
        drag = null;
        host.classList.remove("lp-resizing");
        widths?.set(width);
    };
    handle.ondblclick = () => {
        width = setWidth(defaultWidth);
        widths?.clear();
    };
    handle.onkeydown = (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        width = setWidth(root.getBoundingClientRect().width + (e.key === "ArrowLeft" ? 16 : -16));
        widths?.set(width);
    };

    host.append(root, toggle, handle);
    const setActive = (i, mode = "nearest") => {
        root.querySelectorAll(".lp-item").forEach((n) => n.classList.toggle("lp-active", +n.dataset.i === i));
        root.querySelector(".lp-active")?.closest(".lp-season")?.classList.remove("lp-collapsed");
        if (!fromUser) reveal(mode);
    };
    setOpen(cfg?.open ?? false);
    setActive(index, "center");
    return {
        setActive,
        destroy() {
            root.remove();
            toggle.remove();
            handle.remove();
        }
    };
}


/**
 * Item renderer contract (option `itemRenderer`, region.setItemRenderer()):
 *   ctx    { item, entry }   item: { id, index, title, channel, thumbnail, duration, ...vos champs }
 *   return Node | Node[] | string   (contenu de la ligne ; la ligne elle-même appartient au panel)
 * L'état actif est un style CSS (.lp-active sur la ligne), pas un re-rendu.
 */
export function defaultItemRenderer({ item }) {
    const info = el("div", "lp-info");
    info.append(el("div", "lp-title", item.title));
    if (item.channel) info.append(el("div", "lp-chan", item.channel));
    if (item.thumbnail) {
        const t = el("div", "lp-thumb");
        const img = new Image();
        img.src = item.thumbnail;
        img.alt = "";
        img.loading = "lazy";
        t.append(img, el("span", "lp-tn", String(item.index + 1)));
        return [t, info];
    }
    return [el("span", "lp-num", String(item.index + 1).padStart(2, "0")), info];
}

/**
 * Navigation renderer contract (region.attachNav(container, renderer)), called on every state or entries change:
 *   ctx { container, region, entries, state, isActive(entryOrKey), go(target, opts),
 *         next(opts), previous(opts), back(), forward() }
 * It must be idempotent: update in place rather than rebuilding, or focus is lost on click.
 */
export function defaultNavRenderer({ container, entries, isActive, go }) {
    if (container.dataset.lpCount !== String(entries.length)) {
        container.dataset.lpCount = String(entries.length);
        container.replaceChildren(
            ...entries.map((entry) => {
                const b = el("button", "lp-nav-item");
                b.type = "button";
                b.dataset.key = entry.key;
                if (entry.thumbnail) {
                    const img = new Image();
                    img.src = entry.thumbnail;
                    img.alt = "";
                    img.loading = "lazy";
                    b.append(img);
                }
                b.append(el("span", "lp-nav-title", entry.title || entry.key));
                b.onclick = () => go(entry);
                return b;
            })
        );
    }
    container.querySelectorAll(".lp-nav-item").forEach((b) => {
        const on = isActive(b.dataset.key);
        b.classList.toggle("lp-active", on);
        on ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current");
    });
}
