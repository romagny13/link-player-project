import {ThumbnailService} from "../ThumbnailService.js";
import {injectStyles} from "../utils/dom.js";

export const PANEL_CSS = `
:where(.lp-panel){
  --_bg:var(--lp-bg,#141414);--_line:var(--lp-border,#2a2a2a);--_hover:var(--lp-hover,#1e1e1e);
  --_text:var(--lp-text,#9a9a9a);--_text-on:var(--lp-text-active,#f0f0f0);--_muted:var(--lp-muted,#777);
  --_accent:var(--lp-accent,#f7931e);
  inset:0 0 0 auto;z-index:var(--lp-z,999);width:var(--lp-w,176px);max-width:70%;
  background:var(--_bg);border-left:1px solid var(--_line);color:var(--_text);
  font:12px var(--lp-font,system-ui,sans-serif);transition:transform .2s}
:where([data-lp-theme=light] .lp-panel){--_bg:var(--lp-bg,#fff);--_line:var(--lp-border,#e2e2e2);--_hover:var(--lp-hover,#f3f3f3);--_text:var(--lp-text,#555);--_text-on:var(--lp-text-active,#111);--_muted:var(--lp-muted,#999)}
:where(.lp-panel[data-open=false]){transform:translateX(100%);visibility:hidden}
:where(.lp-scroll){position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}

:where(.lp-handle){position:absolute;top:0;bottom:0;left:-5px;z-index:2;width:10px;cursor:col-resize;touch-action:none}
:where(.lp-handle)::after{content:"";position:absolute;top:0;bottom:0;left:4px;width:2px;background:var(--_accent);opacity:0;transition:opacity .15s}
:where(.lp-handle:hover,.lp-handle:focus-visible,[data-lp-resizing] .lp-handle)::after{opacity:.8}
:where(.lp-handle:focus-visible){outline:none}

:where(.lp-head){position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 8px 7px 12px;background:var(--_bg);color:var(--_muted);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
:where(.lp-close){width:26px;height:26px;padding:0;cursor:pointer;border-radius:5px;border:1px solid color-mix(in srgb,var(--_accent) 35%,transparent);background:color-mix(in srgb,var(--_accent) 8%,transparent);color:var(--_accent);font:inherit}

:where(.lp-item){position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--_line);cursor:pointer;user-select:none}
:where(.lp-item:hover,.lp-item[data-current]){background:var(--_hover)}
:where(.lp-item[data-current])::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--_accent)}
:where(.lp-item:focus-visible,.lp-group-head:focus-visible){outline:2px solid var(--_accent);outline-offset:-2px}
:where(.lp-num){min-width:18px;font-size:11px;color:var(--_muted)}
:where(.lp-item[data-current] .lp-num){color:var(--_accent)}
:where(.lp-info){flex:1;min-width:0}
:where(.lp-title){display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;line-height:1.3;color:var(--_text)}
:where(.lp-item[data-current] .lp-title){color:var(--_text-on);font-weight:500}
:where(.lp-chan,.lp-dur){margin-top:2px;font-size:10px;color:var(--_muted)}
:where(.lp-thumb){position:relative;width:80px;height:45px;flex-shrink:0;border-radius:3px;overflow:hidden;background:#1a1a1a}
:where(.lp-thumb img){display:block;width:100%;height:100%;object-fit:cover}
:where(.lp-tn){position:absolute;right:3px;bottom:2px;padding:1px 4px;border-radius:2px;background:rgba(0,0,0,.7);color:#fff;font-size:9px}

:where(.lp-group-head){display:block;width:100%;padding:8px 12px;border:0;border-bottom:1px solid var(--_line);background:var(--_hover);color:var(--_text);font:inherit;font-size:11px;letter-spacing:.08em;text-transform:uppercase;text-align:left;cursor:pointer;user-select:none}
:where(.lp-group[data-collapsed] .lp-group-items){display:none}

:where(.lp-toggle){position:absolute;z-index:calc(var(--lp-z,999) + 1);width:36px;height:36px;padding:0;border:0;border-radius:50%;background:var(--lp-toggle-bg,rgba(0,0,0,.55));color:var(--lp-toggle-color,#fff);font-size:18px;cursor:pointer;opacity:0;transition:opacity .15s}
:where(.lp-toggle[data-pos=top-right]){top:8px;right:60px}
:where(.lp-toggle[data-pos=bottom-left]){left:140px;bottom:20px}
:where(.lp-host:hover .lp-toggle,.lp-toggle:focus-visible){opacity:1}
@media(hover:none){:where(.lp-toggle){opacity:1}}

/* Anchor positioning: the panel and the toggle follow the box of the iframe, whatever its size or class.
   Without support, the rules above (panel fitted to the host) stay in force. */
@supports (anchor-name:--a){
  :where(.lp-host[data-lp-anchored] .lp-panel){
    position-anchor:var(--lp-anchor);
    top:anchor(top,0px);bottom:anchor(bottom,0px);right:anchor(right,0px);left:auto;
    max-width:calc(anchor-size(width,100%) * .7);
    position-visibility:anchors-visible}
  :where(.lp-host[data-lp-anchored] .lp-toggle){position-anchor:var(--lp-anchor);position-visibility:anchors-visible}
  :where(.lp-host[data-lp-anchored] .lp-toggle[data-pos=top-right]){top:calc(anchor(top,0px) + 8px);right:calc(anchor(right,0px) + 60px)}
  :where(.lp-host[data-lp-anchored] .lp-toggle[data-pos=bottom-left]){left:calc(anchor(left,0px) + 140px);bottom:calc(anchor(bottom,0px) + 20px)}
}
`;

export function ensureRelative(el) {
    if (getComputedStyle(el).position === "static") {
        el.style.position = "relative";
    }
}

const CAN_ANCHOR = globalThis.CSS?.supports?.("anchor-name", "--a") ?? false;
let anchorId = 0;

export class PanelRenderer {
    #host = null;
    #iframe = null;
    #panel = null;
    #scroll = null;
    #handle = null;
    #toggle = null;
    #info = null;
    #onSelectItem = null;
    #open = null; // null until the first render, then kept from one info to the next
    #current = null;
    #collapsed = null; // labels of the folded seasons; null until the first render
    #width = 176;
    #defaultWidth = 176;
    #anchorName = null;
    #itemRenderer = null;
    #headerRenderer = null;
    #toggleRenderer = null;
    #groupRenderer = null;

    #options = {
        handleWidth: 10,
        header: true,
        open: true,
        togglePosition: undefined,
        seasons: true // true: read them from the titles, false: none, number[]: items per season
    };

    constructor(
        options = {},
        itemRenderer = null,
        headerRenderer = null,
        toggleRenderer = null,
        groupRenderer = null,
        thumbnails = null
    ) {
        if (options.handleWidth) this.#options.handleWidth = options.handleWidth;
        if (options.header === false) this.#options.header = false;
        if (options.open !== undefined) this.#options.open = Boolean(options.open);
        if (options.togglePosition !== undefined)
            this.#options.togglePosition = options.togglePosition;
        if (options.seasons !== undefined) this.#options.seasons = options.seasons;

        this.#itemRenderer = itemRenderer ?? new ItemRenderer(thumbnails);
        this.#headerRenderer = headerRenderer ?? new HeaderRenderer();
        this.#toggleRenderer = toggleRenderer ?? new ToggleRenderer();
        this.#groupRenderer = groupRenderer ?? new GroupRenderer();
    }

    render({
               host = null,
               iframe = null,
               info,
               current = null,
               onSelectItem = null,
               widths = null
           }) {
        host = host ?? iframe?.parentElement; // no container to create
        if (!host) {
            throw new Error("[PanelRenderer] host or an attached iframe is required");
        }
        if (this.#host && this.#host !== host) this.clear(); // the host changed: clean the old one
        iframe = iframe ?? this.#iframe; // render() rappelé sans iframe : on garde l'ancre

        injectStyles("lp-panel-styles", PANEL_CSS);

        const items = info.videos ?? [info];
        this.#host = host;
        this.#info = info;
        this.#onSelectItem = onSelectItem;
        this.#current = current ?? info.index ?? null;
        this.#defaultWidth = items.some((item) => item.thumbnailPath) ? 280 : 176;

        this.#setupHost(host);
        this.#setupAnchor(iframe);

        const saved = Number(widths?.get());
        this.#setWidth(saved > 0 ? saved : this.#defaultWidth);

        this.#ensurePanel();
        this.#ensureResizeHandle(widths);
        this.#fillPanel(items);

        this.#ensureToggle();
        this.#setOpen(this.#open ?? this.#options.open);
        this.#placeAfterIframe();
    }

    /** Marks the item that is playing, without drawing the panel again. */
    setCurrent(index, iframe = this.#iframe) {
        if (this.#host && iframe !== this.#iframe) {
            this.#setupAnchor(iframe);
            this.#placeAfterIframe();
        }
        this.#current = index;
        if (!this.#scroll) return;

        for (const row of this.#scroll.querySelectorAll("[data-index]")) {
            const isCurrent = Number(row.dataset.index) === index;
            row.toggleAttribute("data-current", isCurrent);
            if (isCurrent) {
                row.setAttribute("aria-current", "true");
                const group = row.closest(".lp-group");
                if (group?.hasAttribute("data-collapsed"))
                    this.#setCollapsed(group, false);
                row.scrollIntoView?.({ block: "nearest" });
            } else {
                row.removeAttribute("aria-current");
            }
        }
    }

    clear() {
        this.#releaseAnchor();
        this.#panel?.remove(); // the scroll area and the resize handle go with it
        this.#panel = null;
        this.#scroll = null;
        this.#handle = null;
        this.#toggle?.remove();
        this.#toggle = null;
        this.#open = null;
        this.#current = null;
        this.#collapsed = null;
        this.#host?.style.removeProperty("--lp-w");
        this.#host?.classList.remove("lp-host");
        this.#host = null;
        this.#iframe = null;
    }

    destroy() {
        this.clear();
    }

    // ─── Host ───

    #setupHost(host) {
        host.classList.add("lp-host"); // the CSS shows the toggle when the host is hovered
        ensureRelative(host); // containing block of the panel; nothing else is changed on the host
    }

    // ─── Anchor ───
    // The panel follows the box of the iframe through CSS anchor positioning:
    // no observer, no measure, no wrapper, and the iframe is left untouched.

    #setupAnchor(iframe) {
        if (this.#iframe && this.#iframe !== iframe) {
            this.#iframe.style.removeProperty("anchor-name"); // the iframe was replaced
        }
        this.#iframe = iframe;

        if (!iframe || !CAN_ANCHOR) {
            // fallback: the panel is fitted to the host
            this.#host.style.removeProperty("--lp-anchor");
            delete this.#host.dataset.lpAnchored;
            return;
        }

        const name = (this.#anchorName ??= `--lp-a${++anchorId}`);
        iframe.style.setProperty("anchor-name", name);
        this.#host.style.setProperty("--lp-anchor", name);
        this.#host.dataset.lpAnchored = "";
    }

    #releaseAnchor() {
        this.#iframe?.style.removeProperty("anchor-name");
        this.#host?.style.removeProperty("--lp-anchor");
        if (this.#host) delete this.#host.dataset.lpAnchored;
    }

    #setWidth(px) {
        // snapshot (initial / drag); the live clamp is done by max-width in the CSS
        const box = this.#iframe?.offsetWidth || this.#host?.clientWidth || 0;
        const min = 120;
        const max = Math.max(min, box * 0.7);

        const width = Math.max(min, Math.min(max, Math.round(px)));

        this.#host?.style.setProperty("--lp-w", `${width}px`);
        this.#width = width;
        return width;
    }

    // ─── Resize handle ───

    #ensureResizeHandle(widths) {
        if (this.#handle) return;

        const handle = document.createElement("div");
        handle.className = "lp-handle";
        const w = this.#options.handleWidth;

        // Positioning only: the bar is drawn by the CSS
        Object.assign(handle.style, {
            position: "absolute",
            top: "0",
            bottom: "0",
            left: `${-w / 2}px`,
            width: `${w}px`
        });

        handle.tabIndex = 0;
        handle.title = "Drag to resize (double-click to reset)";
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-orientation", "vertical");

        let drag = null;

        handle.onpointerdown = (e) => {
            if (e.button !== 0) return;
            drag = { startX: e.clientX, startWidth: this.#width };
            handle.setPointerCapture?.(e.pointerId);
            this.#host.dataset.lpResizing = "";
            this.#host.style.userSelect = "none";
            this.#host.style.cursor = "col-resize";
            // the iframe would swallow the pointer events during the drag
            if (this.#iframe) this.#iframe.style.pointerEvents = "none";
            e.preventDefault();
        };

        handle.onpointermove = (e) => {
            if (!drag) return;
            this.#setWidth(drag.startWidth + (drag.startX - e.clientX));
        };

        const endDrag = () => {
            if (!drag) return;
            drag = null;
            delete this.#host.dataset.lpResizing;
            this.#host.style.userSelect = "";
            this.#host.style.cursor = "";
            if (this.#iframe) this.#iframe.style.pointerEvents = "";
            widths?.set(this.#width);
        };

        handle.onpointerup = endDrag;
        handle.onpointercancel = endDrag;

        handle.ondblclick = () => {
            this.#setWidth(this.#defaultWidth);
            widths?.clear();
        };

        handle.onkeydown = (e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const delta = e.key === "ArrowLeft" ? 16 : -16;
            this.#setWidth(this.#width + delta);
            widths?.set(this.#width);
        };

        this.#handle = handle;
        this.#panel.appendChild(handle);
    }

    // ─── Panel ───

    #ensurePanel() {
        if (this.#panel) return;

        const panel = document.createElement("div");
        panel.className = "lp-panel";
        panel.style.position = "absolute"; // everything else (inset, size, look) comes from the CSS

        const scroll = document.createElement("div");
        scroll.className = "lp-scroll";
        panel.appendChild(scroll);

        // One listener for everything the panel contains: the renderers only have to set data-* attributes
        panel.addEventListener("click", (event) => this.#onClick(event));
        panel.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const row = event.target.closest?.("[data-index]");
            if (!row) return;
            event.preventDefault();
            this.#select(Number(row.dataset.index));
        });

        this.#panel = panel;
        this.#scroll = scroll;
        this.#host.appendChild(panel); // after the iframe in the DOM, as anchor positioning requires
    }

    #onClick(event) {
        const action = event.target.closest?.("[data-lp-action]");
        if (action?.dataset.lpAction === "close") {
            this.#setOpen(false);
            this.#toggle?.focus(); // the close button is hidden now: keep the keyboard focus somewhere useful
            return;
        }
        if (action?.dataset.lpAction === "toggle-group") {
            const group = action.closest(".lp-group");
            if (group)
                this.#setCollapsed(group, !group.hasAttribute("data-collapsed"));
            return;
        }
        const row = event.target.closest?.("[data-index]");
        if (row) this.#select(Number(row.dataset.index));
    }

    #select(index) {
        this.#onSelectItem?.(index, this.#info);
    }

    #placeAfterIframe() {
        const f = this.#iframe;
        if (!f || !this.#host.contains(f)) return;
        for (const el of [this.#panel, this.#toggle]) {
            if (el && f.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
                this.#host.appendChild(el); // l'ancre doit précéder l'élément ancré
        }
    }

    #fillPanel(items) {
        const scroll = this.#scroll;
        scroll.replaceChildren(); // clear panel content

        if (this.#options.header) {
            scroll.appendChild(
                this.#headerRenderer.render({ count: items.length, canClose: true })
            );
        }

        const seasons = this.#options.seasons;
        const groups =
            seasons === false
                ? null
                : groupBySeason(items, Array.isArray(seasons) ? seasons : null);

        if (!groups) {
            for (let index = 0; index < items.length; index++)
                scroll.appendChild(this.#renderItem(items, index));
            return;
        }

        // First draw: only the season that is playing is unfolded. Afterward the choice of the user is kept.
        if (this.#collapsed === null) {
            const at = this.#current ?? 0;
            this.#collapsed = new Set(
                groups.filter((g) => at < g.start || at >= g.end).map((g) => g.label)
            );
        }

        for (const { label, start, end } of groups) {
            const collapsed = this.#collapsed.has(label);

            const group = document.createElement("div");
            group.className = "lp-group";
            group.dataset.label = label;
            if (collapsed) group.dataset.collapsed = "";

            const body = document.createElement("div");
            body.className = "lp-group-items";
            for (let index = start; index < end; index++)
                body.appendChild(this.#renderItem(items, index));

            group.append(
                this.#groupRenderer.render({ label, count: end - start, collapsed }),
                body
            );
            scroll.appendChild(group);
        }
    }

    #renderItem(items, index) {
        return this.#itemRenderer.render(
            items[index],
            index,
            index === this.#current
        );
    }

    #setCollapsed(group, collapsed) {
        group.toggleAttribute("data-collapsed", collapsed);
        group
            .querySelector("[data-lp-action=toggle-group]")
            ?.setAttribute("aria-expanded", String(!collapsed));
        if (collapsed) this.#collapsed?.add(group.dataset.label);
        else this.#collapsed?.delete(group.dataset.label);
    }

    // ─── Toggle ───

    #ensureToggle() {
        if (this.#toggle) return;

        const toggle = this.#toggleRenderer.render({
            position: this.#options.togglePosition
        });
        toggle.addEventListener("click", () => this.#setOpen(true));

        this.#toggle = toggle;
        this.#host.appendChild(toggle);
    }

    #setOpen(open) {
        this.#open = open;
        if (this.#panel) this.#panel.dataset.open = String(open); // the CSS slides the panel and hides it
        if (this.#toggle) this.#toggle.hidden = open;
    }
}

const SEASON_RE =
    /\b(?:saison|season)\s*0*(\d{1,3})\b|\bs0*(\d{1,2})(?:\b|(?=e\d))/i;

/**
 * Splits the items into seasons: [{ label, start, end }] (end exclusive), or null when grouping is useless.
 * @param {Array} items Items with `item.title`.
 * @param {number[]|null} counts Explicit number of items per season; when absent, "Season 2" / "S02E05" are read from the titles.
 */
export function groupBySeason(items, counts = null) {
    const n = items.length;
    if (counts?.length) {
        const groups = [];
        let start = 0;
        counts.forEach((count, i) => {
            if (start < n) {
                groups.push({
                    label: `Season ${i + 1}`,
                    start,
                    end: Math.min(start + count, n)
                });
                start += count;
            }
        });
        if (start < n) groups.push({label: "Other", start, end: n});
        return groups.length > 1 ? groups : null;
    }

    const seasons = items.map((item) => {
        const match = SEASON_RE.exec(item.title ?? "");
        return match ? +(match[1] || match[2]) : null;
    });
    const first = seasons.find((season) => season !== null);
    if (first === undefined) return null;

    let current = first > 1 ? 1 : null; // leading items without a marker belong to season 1
    const groups = [];
    seasons.forEach((season, i) => {
        if (season !== null) current = season;
        const last = groups[groups.length - 1];
        if (last && last.key === current) last.end = i + 1;
        else
            groups.push({
                key: current,
                label: current === null ? "Other" : `Season ${current}`,
                start: i,
                end: i + 1
            });
    });
    return groups.length > 1 ? groups : null;
}

/** The head of a season: the button that folds / unfolds it. */
export class GroupRenderer {
    render({label, count, collapsed}) {
        const head = document.createElement("button");
        head.type = "button";
        head.className = "lp-group-head";
        head.textContent = `${label} · ${count}`;
        head.dataset.lpAction = "toggle-group";
        head.setAttribute("aria-expanded", String(!collapsed));
        return head;
    }
}

/**
 * The panel reacts to `data-lp-action` on any element of its content, so a custom renderer only has to set it:
 *   "close"         hides the panel
 *   "toggle-group"  folds / unfolds the season the element belongs to
 * and to `data-index` on an item (selects it).
 */
export class HeaderRenderer {
    render({count, canClose}) {
        const head = document.createElement("div");
        head.className = "lp-head";

        const title = document.createElement("span");
        title.className = "lp-head-title";
        title.textContent = `Playlist · ${count}`;
        head.append(title);

        if (canClose) {
            const close = document.createElement("button");
            close.type = "button";
            close.className = "lp-close";
            close.textContent = "»";
            close.title = "Hide playlist";
            close.setAttribute("aria-label", "Hide playlist");
            close.dataset.lpAction = "close";
            head.append(close);
        }
        return head;
    }
}

export class ItemRenderer {
    constructor(thumbnails = null) {
        this._thumbnails = thumbnails ?? new ThumbnailService();
    }

    render(item, index, isCurrent = false) {
        const title = item.title || `Video ${index + 1}`;

        const row = document.createElement("div");
        row.className = "lp-item";
        row.dataset.index = String(index);
        row.title = title;
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        if (isCurrent) {
            row.dataset.current = "";
            row.setAttribute("aria-current", "true");
        }

        const text = document.createElement("div");
        text.className = "lp-info";

        const titleEl = document.createElement("div");
        titleEl.className = "lp-title";
        titleEl.textContent = title;
        text.append(titleEl);

        if (item.channel) {
            const chan = document.createElement("div");
            chan.className = "lp-chan";
            chan.textContent = item.channel;
            text.append(chan);
        }

        if (item.thumbnailPath) {
            const thumb = document.createElement("div");
            thumb.className = "lp-thumb";

            const image = document.createElement("img");
            image.alt = "";
            image.loading = "lazy";
            this._thumbnails.resolve(item.thumbnailPath).then((url) => {
                if (url) image.src = url;
                else thumb.remove(); // broken or missing: the row falls back to the number
            });

            const tn = document.createElement("span");
            tn.className = "lp-tn";
            tn.textContent = String(index + 1);

            thumb.append(image, tn);
            row.append(thumb, text);
        } else {
            const num = document.createElement("span");
            num.className = "lp-num";
            num.textContent = String(index + 1).padStart(2, "0");

            row.append(num, text);
        }

        return row;
    }
}

export class ToggleRenderer {
    /** @param {{ position?: string | object }} options Default position, used when the panel does not give one. */
    constructor({position = "top-right"} = {}) {
        this.defaultPosition = position;
    }

    render({position = this.defaultPosition} = {}) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lp-toggle";
        button.textContent = "☰";
        button.title = "Show playlist";
        button.setAttribute("aria-label", "Show playlist");

        if (typeof position === "string") button.dataset.pos = position;
        else Object.assign(button.style, position);
        return button;
    }
}