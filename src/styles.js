import { el } from "./util.js";

const CSS = `
.lp-host{position:relative}
.lp-frame{position:absolute;inset:0;width:100%;height:100%;border:0}
.lp-panel{--b:var(--lp-bg,#141414);--l:var(--lp-border,#2a2a2a);--h:var(--lp-hover,#1e1e1e);--t:var(--lp-text,#9a9a9a);--ta:var(--lp-text-active,#f0f0f0);--n:var(--lp-muted,#555);--a:var(--lp-accent,#f7931e);position:absolute;inset:0 0 0 auto;z-index:999;width:var(--lp-w,176px);max-width:70%;display:flex;flex-direction:column;overflow:hidden auto;overscroll-behavior:contain;scroll-behavior:auto;scrollbar-width:thin;background:var(--b);border-left:1px solid var(--l);font:12px var(--lp-font,system-ui,sans-serif);transition:transform .2s}
.lp-panel.lp-closed{transform:translateX(100%);visibility:hidden}
[data-lp-theme=light] .lp-panel{--b:var(--lp-bg,#fff);--l:var(--lp-border,#e2e2e2);--h:var(--lp-hover,#f3f3f3);--t:var(--lp-text,#555);--ta:var(--lp-text-active,#111);--n:var(--lp-muted,#b0b0b0)}
.lp-head{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;padding:8px 8px 7px 12px;background:var(--b);color:var(--n);font-size:10px;letter-spacing:.12em;text-transform:uppercase}
.lp-close{width:26px;height:26px;padding:0;cursor:pointer;border-radius:5px;border:1px solid color-mix(in srgb,var(--a) 35%,transparent);background:color-mix(in srgb,var(--a) 8%,transparent);color:var(--a)}
.lp-item{position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--l);cursor:pointer;user-select:none}
.lp-item:hover,.lp-item.lp-active{background:var(--h)}
.lp-item.lp-active::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--a)}
.lp-item:focus-visible{outline:2px solid var(--a);outline-offset:-2px}
.lp-num{min-width:18px;font-size:11px;color:var(--n)}
.lp-active .lp-num{color:var(--a)}
.lp-info{flex:1;min-width:0}
.lp-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;line-height:1.3;color:var(--t)}
.lp-active .lp-title{color:var(--ta);font-weight:500}
.lp-chan{margin-top:2px;font-size:10px;color:var(--n)}
.lp-thumb{position:relative;width:80px;height:45px;flex-shrink:0;border-radius:3px;overflow:hidden;background:#1a1a1a}
.lp-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.lp-tn{position:absolute;right:3px;bottom:2px;padding:1px 4px;border-radius:2px;background:rgba(0,0,0,.7);color:#fff;font-size:9px}
.lp-sh{padding:8px 12px;background:var(--h);border-bottom:1px solid var(--l);color:var(--t);font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;user-select:none}
.lp-collapsed .lp-item{display:none}
.lp-toggle{position:absolute;z-index:9999;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:var(--lp-toggle-bg,rgba(0,0,0,.55));color:var(--lp-toggle-color,#fff);font-size:18px;cursor:pointer;opacity:0;transition:opacity .15s}
.lp-toggle[hidden],.lp-resize[hidden]{display:none}
.lp-toggle[data-pos=top-right]{top:8px;right:60px}
.lp-toggle[data-pos=bottom-left]{left:140px;bottom:20px}
.lp-host:hover .lp-toggle,.lp-toggle:focus-visible{opacity:1}
@media(hover:none){.lp-toggle{opacity:1}}
.lp-resize{position:absolute;top:0;bottom:0;z-index:1000;width:10px;cursor:col-resize;touch-action:none;right:calc(min(var(--lp-w,176px),70%) - 5px)}
.lp-resize::after{content:"";position:absolute;inset:0 auto 0 4px;width:2px;background:var(--lp-accent,#f7931e);opacity:0;transition:opacity .15s}
.lp-resize:hover::after,.lp-resize:focus-visible::after,.lp-resizing .lp-resize::after{opacity:.8}
.lp-resize:focus-visible{outline:none}
.lp-resizing{user-select:none;cursor:col-resize}
.lp-resizing iframe{pointer-events:none}
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

export function injectStyles() {
    if (document.getElementById("lp-styles")) return;
    const s = el("style");
    s.id = "lp-styles";
    s.textContent = CSS;
    document.head.appendChild(s);
}
