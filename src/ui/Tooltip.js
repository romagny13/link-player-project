import {injectStyles} from "../utils/dom.js";

const TOOLTIP_CSS = `
@layer lp-tooltip {
    .lp-tip{position:fixed;z-index:99999;display:none;width:280px;height:158px;border-radius:8px;overflow:hidden;pointer-events:none;background:linear-gradient(135deg,#222222,#111111);box-shadow:0 8px 24px rgba(0,0,0,.55);opacity:0;transform:translateY(4px);transition:opacity .15s ease,transform .15s ease;font:500 14px var(--lp-font,system-ui,sans-serif);color:#fff}
    .lp-tip.lp-show{opacity:1;transform:none}
     .lp-tip{background:radial-gradient(circle at 50% 30%, #1a1a1a 0%, #0d0d0d 70%)}
    .lp-tip[data-provider=youtube]{background:radial-gradient(circle at 50% 30%, #1c1111 0%, #0d0d0d 70%); --fa:#4d1414; --fb:#141414}
    .lp-tip[data-provider=dailymotion]{background:radial-gradient(circle at 50% 30%, #11151c 0%, #0d0d0d 70%); --fa:#123a63; --fb:#101820}
    .lp-tip[data-provider=okru]{background:radial-gradient(circle at 50% 30%, #1c1510 0%, #0d0d0d 70%); --fa:#5a3508; --fb:#181108}
    
    .lp-tip img,.lp-tip-loader{display:block;width:100%;height:100%;object-fit:cover}
    .lp-tip img[hidden],.lp-tip-loader[hidden]{display:none}
    
    .lp-tip-loader{background:linear-gradient(90deg,transparent,#2a2a2a 50%,transparent) 0 0/200% 100% #111;animation:lp-shimmer 1.2s infinite}
    @keyframes lp-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
    
    .lp-tip-play{position:absolute;top:50%;left:50%;width:52px;height:52px;transform:translate(-50%,-50%);border-radius:50%;background:rgba(0,0,0,0.6);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;transition:background 0.2s ease}
    .lp-tip-play::after{content:"";display:block;width:0;height:0;border-style:solid;border-width:8px 0 8px 14px;border-color:transparent transparent transparent #ffffff;margin-left:3px}
    
    .lp-tip-title{position:absolute;bottom:0;left:0;right:0;padding:24px 12px 12px 12px;background:linear-gradient(transparent,rgba(0,0,0,0.8));z-index:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;text-shadow:1px 1px 2px rgba(0,0,0,.5)}
    
    .lp-tip.lp-nothumb{background:linear-gradient(135deg,var(--fa,#2f2f2f),var(--fb,#141414))}
    .lp-tip.lp-nothumb::before{content:attr(data-name);position:absolute;top:10px;left:12px;font:600 10px var(--lp-font,system-ui,sans-serif);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.55)}
    .lp-tip.lp-nothumb .lp-tip-play{top:42%}
    .lp-tip.lp-nothumb .lp-tip-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;line-height:1.3}
}
.lp-nav-item{display:flex;align-items:center;gap:8px;padding:0;border:2px solid transparent;border-radius:6px;background:none;cursor:pointer;overflow:hidden;font:inherit;color:inherit}
.lp-nav-item img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.lp-nav-item.lp-active{border-color:var(--lp-accent,#f7931e)}
.lp-nav-item:focus-visible{outline:2px solid var(--lp-accent,#f7931e);outline-offset:2px}
`;

const SHOW_DELAY_MS = 120;
const HIDE_DELAY_MS = 150;
const THUMB_TIMEOUT_MS = 3000;
const CURSOR_MARGIN = 14;
const YOUTUBE_MISSING_WIDTH = 120;

/** Default Renderer mis à jour avec le nouveau design */
export class TooltipRenderer {
    createElement() {
        const tip = document.createElement("div");
        tip.className = "lp-tip";

        const loader = document.createElement("div");
        loader.className = "lp-tip-loader";

        const img = document.createElement("img");
        img.alt = "";

        const play = document.createElement("div");
        play.className = "lp-tip-play";

        const span = document.createElement("span");
        span.className = "lp-tip-title";

        tip.append(loader, img, play, span);
        return tip;
    }

    onShow(tip, { title, provider }) {
        const [loader, img] = tip.children;
        tip.dataset.provider = provider.id ?? "";
        tip.dataset.name = provider.name ?? "";
        tip.classList.remove("lp-nothumb");
        tip.lastChild.textContent = title;
        loader.hidden = false;
        img.hidden = true;
        img.removeAttribute("src");
    }

    onLoading(tip) {
        const [loader] = tip.children;
        loader.hidden = false;
    }

    onThumbLoaded(tip, url) {
        const [loader, img] = tip.children;
        loader.hidden = true;
        img.src = url;
        img.hidden = false;
    }

    onFallback(tip) {
        const [loader] = tip.children;
        loader.hidden = true;
        tip.classList.add("lp-nothumb");
    }
}

/** Thumbnail tooltip on hover (not on touch devices). One shared element. */
export class Tooltip {
    #token = 0;
    #el = null;
    #timer = null;
    #hideTimer = null;
    #last = null;
    #tooltipRenderer;

    #onPointerDown = () => {
        clearTimeout(this.#timer);
        this.#hide();
    };

    constructor(tooltipRenderer = null) {
        this.#tooltipRenderer = tooltipRenderer ?? new TooltipRenderer();
        document.addEventListener("pointerdown", this.#onPointerDown, true);
    }

    attach(target, getThumb, title, provider = {}) {
        const onEnter = (e) => {
            this.#last = e;
            clearTimeout(this.#timer);
            this.#timer = setTimeout(() => this.#show(getThumb, title, provider), SHOW_DELAY_MS);
        };
        const onMove = (e) => {
            this.#last = e;
            this.#move(e);
        };
        const onLeave = () => {
            clearTimeout(this.#timer);
            this.#hide();
        };

        target.addEventListener("mouseenter", onEnter);
        target.addEventListener("mousemove", onMove);
        target.addEventListener("mouseleave", onLeave);

        return () => {
            target.removeEventListener("mouseenter", onEnter);
            target.removeEventListener("mousemove", onMove);
            target.removeEventListener("mouseleave", onLeave);
            clearTimeout(this.#timer);
            this.#hide();
        };
    }

    #build() {
        const tip = this.#tooltipRenderer.createElement();
        tip.classList.add("lp-tip");
        document.body.append(tip);
        return (this.#el = tip);
    }

    async #show(getThumb, titleResolver, provider) {
        injectStyles("lp-tooltip-styles", TOOLTIP_CSS);
        clearTimeout(this.#hideTimer);
        const token = ++this.#token;
        const tip = this.#el ?? this.#build();

        const title = typeof titleResolver === "function" ? titleResolver() : titleResolver;

        this.#tooltipRenderer.onShow(tip, { title, provider });

        tip.style.display = "block";
        this.#move(this.#last);
        requestAnimationFrame(() => {
            if (token === this.#token) tip.classList.add("lp-show");
        });

        const fallback = () => {
            if (token !== this.#token) return;
            this.#tooltipRenderer.onFallback(tip);
        };

        const url = await this.#fetchThumb(getThumb);
        if (token !== this.#token) return;
        if (!url) return fallback();

        const probe = new Image();
        probe.onload = () => {
            if (token !== this.#token) return;
            if (provider.id === "youtube" && probe.naturalWidth <= YOUTUBE_MISSING_WIDTH)
                return fallback();
            this.#tooltipRenderer.onThumbLoaded(tip, url);
        };
        probe.onerror = () => {
            if (token === this.#token) fallback();
        };
        probe.src = url;
    }

    async #fetchThumb(getThumb) {
        let timeoutId;
        const timeout = new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(null), THUMB_TIMEOUT_MS);
        });
        const thumb = (async () => getThumb())().catch(() => null);
        try {
            return await Promise.race([thumb, timeout]);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    #move(e) {
        if (!this.#el || !e) return;
        const {offsetWidth: w, offsetHeight: h} = this.#el;
        const m = CURSOR_MARGIN;
        this.#el.style.left = `${e.clientX + m + w > innerWidth ? e.clientX - w - m : e.clientX + m}px`;
        this.#el.style.top = `${e.clientY + m + h > innerHeight ? e.clientY - h - m : e.clientY + m}px`;
    }

    #hide() {
        this.#token++;
        if (!this.#el) return;
        this.#el.classList.remove("lp-show");
        clearTimeout(this.#hideTimer);
        this.#hideTimer = setTimeout(() => {
            if (this.#el) this.#el.style.display = "none";
        }, HIDE_DELAY_MS);
    }

    dispose() {
        this.#token++;
        clearTimeout(this.#timer);
        clearTimeout(this.#hideTimer);
        document.removeEventListener("pointerdown", this.#onPointerDown, true);
        this.#el?.remove();
        this.#el = null;
    }
}