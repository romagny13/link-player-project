import { injectStyles } from "./styles.js";
import { el } from "./util.js";

/** Thumbnail tooltip on hover (not on touch devices). One shared element. */
export class Tooltip {
    constructor() {
        this._token = 0; // ignores a thumbnail that arrives after another link took over
        this._el = null;
        this._timer = null;
        this._hideTimer = null;
        this._last = null;
        // A click or tap anywhere closes it (mouseleave is unreliable on hybrid devices)
        document.addEventListener(
            "pointerdown",
            () => {
                clearTimeout(this._timer);
                this._hide();
            },
            true
        );
    }

    /** provider: { id, name } of the link's provider, used for the fallback look. */
    attach(target, getThumb, title, provider = {}) {
        const onEnter = (e) => {
            this._last = e;
            this._timer = setTimeout(() => this._show(getThumb, title, provider), 120);
        };
        const onMove = (e) => this._move(e);
        const onLeave = () => {
            clearTimeout(this._timer);
            this._hide();
        };

        target.addEventListener("mouseenter", onEnter);
        target.addEventListener("mousemove", onMove);
        target.addEventListener("mouseleave", onLeave);

        // fonction de détachement
        return () => {
            target.removeEventListener("mouseenter", onEnter);
            target.removeEventListener("mousemove", onMove);
            target.removeEventListener("mouseleave", onLeave);
            clearTimeout(this._timer);
            this._hide();
        };
    }

    _build() {
        const tip = el("div", "lp-tip");
        const img = new Image();
        img.alt = "";
        tip.append(
            el("div", "lp-tip-loader"),
            img,
            el("div", "lp-tip-play"),
            el("span", "lp-tip-title")
        );
        document.body.append(tip);
        return (this._el = tip);
    }

    async _show(getThumb, title, provider) {
        injectStyles();
        clearTimeout(this._hideTimer);
        const token = ++this._token;
        const tip = this._el ?? this._build();
        const [loader, img] = tip.children;

        tip.dataset.provider = provider.id ?? "";
        tip.dataset.name = provider.name ?? "";
        tip.classList.remove("lp-nothumb");
        tip.lastChild.textContent = title;
        loader.hidden = false;
        img.hidden = true;
        img.removeAttribute("src");
        tip.style.display = "block";
        this._move(this._last);
        requestAnimationFrame(() => {
            if (token === this._token) tip.classList.add("lp-show");
        });

        const fallback = () => {
            loader.hidden = true;
            tip.classList.add("lp-nothumb");
        };
        const url = await Promise.race([
            getThumb(),
            new Promise((r) => setTimeout(() => r(null), 3000))
        ]);
        if (token !== this._token) return;
        if (!url) return fallback();

        const probe = new Image();
        probe.onload = () => {
            if (token !== this._token) return;
            // YouTube serves a grey 120x90 image when the video no longer exists
            if (provider.id === "youtube" && probe.naturalWidth <= 120)
                return fallback();
            loader.hidden = true;
            img.src = url;
            img.hidden = false;
        };
        probe.onerror = () => {
            if (token === this._token) fallback();
        };
        probe.src = url;
    }

    _move(e) {
        if (!this._el || !e) return;
        const m = 14;
        const { offsetWidth: w, offsetHeight: h } = this._el;
        this._el.style.left = `${e.clientX + m + w > innerWidth ? e.clientX - w - m : e.clientX + m
            }px`;
        this._el.style.top = `${e.clientY + m + h > innerHeight ? e.clientY - h - m : e.clientY + m
            }px`;
    }

    _hide() {
        this._token++;
        if (!this._el) return;
        this._el.classList.remove("lp-show");
        clearTimeout(this._hideTimer);
        this._hideTimer = setTimeout(() => {
            this._el.style.display = "none";
        }, 150);
    }

    dispose() { clearTimeout(this._timer); clearTimeout(this._hideTimer); this._el?.remove(); this._el = null; }
}