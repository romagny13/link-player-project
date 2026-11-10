import {injectStyles} from "../utils/dom.js";

const TOOLTIP_CSS = `
.lp-tip{position:fixed;z-index:99999;display:none;width:280px;height:158px;border-radius:8px;overflow:hidden;pointer-events:none;background:var(--lp-tip-bg,#1a1a1a);box-shadow:0 8px 24px rgba(0,0,0,.55);opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease}
.lp-tip.lp-show{opacity:1;transform:none}
.lp-tip[data-provider=youtube]{--fa:#4d1414;--fb:#141414}
.lp-tip[data-provider=dailymotion]{--fa:#123a63;--fb:#101820}
.lp-tip[data-provider=okru]{--fa:#5a3508;--fb:#181108}
.lp-tip::after{content:"";position:absolute;inset:auto 0 0;height:60px;background:linear-gradient(transparent,rgba(0,0,0,.7));pointer-events:none}
.lp-tip img,.lp-tip-loader{display:block;width:100%;height:100%}
.lp-tip img{object-fit:cover}
.lp-tip img[hidden],.lp-tip-loader[hidden]{display:none}
.lp-tip-loader{background:linear-gradient(90deg,transparent,#2a2a2a 50%,transparent) 0 0/200% 100% #111;animation:lp-shimmer 1.2s infinite}
@keyframes lp-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
.lp-tip-play{position:absolute;top:50%;left:50%;width:68px;height:48px;transform:translate(-50%,-50%);border-radius:12px;background:rgba(0,0,0,.8)}
.lp-tip-play::after{content:"";position:absolute;top:50%;left:55%;transform:translate(-50%,-50%);border:solid transparent;border-width:12px 0 12px 20px;border-left-color:#fff}
.lp-tip-title{position:absolute;left:12px;right:12px;bottom:12px;z-index:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#fff;font:500 14px var(--lp-font,system-ui,sans-serif);text-shadow:1px 1px 2px rgba(0,0,0,.5)}
.lp-tip.lp-nothumb{background:linear-gradient(135deg,var(--fa,#2f2f2f),var(--fb,#141414))}
.lp-tip.lp-nothumb::before{content:attr(data-name);position:absolute;top:10px;left:12px;font:600 10px var(--lp-font,system-ui,sans-serif);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.55)}
.lp-tip.lp-nothumb::after{display:none}
.lp-tip.lp-nothumb .lp-tip-play{top:42%}
.lp-tip.lp-nothumb .lp-tip-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;line-height:1.3}
.lp-nav-item{display:flex;align-items:center;gap:8px;padding:0;border:2px solid transparent;border-radius:6px;background:none;cursor:pointer;overflow:hidden;font:inherit;color:inherit}
.lp-nav-item img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.lp-nav-item.lp-active{border-color:var(--lp-accent,#f7931e)}
.lp-nav-item:focus-visible{outline:2px solid var(--lp-accent,#f7931e);outline-offset:2px}
`;

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
        const tip = document.createElement("div");
        tip.className = "lp-tip";

        const loader = document.createElement("div");
        loader.className = "lp-tip-loader";

        const img = new Image();
        img.alt = "";

        const play = document.createElement("div");
        play.className = "lp-tip-play";

        const span = document.createElement("span");
        span.className = "lp-tip-title";

        tip.append(loader, img, play, span);
        document.body.append(tip);
        return (this._el = tip);
    }

    async _show(getThumb, title, provider) {
        injectStyles("lp-tootltip-styles", TOOLTIP_CSS);
        clearTimeout(this._hideTimer);
        const token = ++this._token;
        const tip = this._el ?? this._build();
        const [loader, img] = tip.children;

        tip.dataset.provider = provider.id ?? "";
        tip.dataset.name = provider.name ?? "";
        tip.classList.remove("lp-nothumb");
        tip.lastChild.textContent = typeof title === "function" ? title() : title;
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
        this._el.style.left = `${e.clientX + m + w > innerWidth ? e.clientX - w - m : e.clientX + m}px`;
        this._el.style.top = `${e.clientY + m + h > innerHeight ? e.clientY - h - m : e.clientY + m}px`;
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

    dispose() {
        clearTimeout(this._timer);
        clearTimeout(this._hideTimer);
        if (this._el) this._el.style.display = "none";
        this._el?.remove();
        this._el = null;
    }
}