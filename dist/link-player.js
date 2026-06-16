(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.LinkPlayer = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    'use strict';

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    const TOOLTIP_SHOW_DELAY = 120;
    const TOOLTIP_IMG_SIZE = { width: 280, height: 158 };
    const TOOLTIP_ID = 'linkplayer-tooltip';
    const TOOLTIP_STYLES_ID = 'linkplayer-tooltip-styles';
    const OKRU_PLAYLIST_STYLES_ID = 'linkplayer-okru-playlist-styles';
    const OKRU_TOGGLE_VISIBLE_DELAY = 2500;


    // ─────────────────────────────────────────────────────────────────────────
    // Device detection
    // ─────────────────────────────────────────────────────────────────────────

    function isTouchDevice() {
        if (typeof window === 'undefined' || !window.matchMedia) return false;
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }


    // ─────────────────────────────────────────────────────────────────────────
    // URL detection
    // ─────────────────────────────────────────────────────────────────────────

    function parseHostname(url) {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch {
            return null;
        }
    }

    function isYouTubeUrl(url) {
        try {
            const u = new URL(url);
            const host = u.hostname.replace('www.', '');
            if (host === 'youtube.com') {
                return (u.pathname === '/watch' && u.searchParams.has('v'))
                    || (u.pathname === '/watch_videos' && u.searchParams.has('video_ids'));
            }
            return host === 'youtu.be' && u.pathname.length > 1;
        } catch { return false; }
    }

    function isDailymotionUrl(url) {
        try {
            const u = new URL(url);
            const host = u.hostname.replace('www.', '');
            return host === 'dailymotion.com'
                && (u.pathname.startsWith('/video/') || u.pathname.startsWith('/playlist/'));
        } catch { return false; }
    }

    function isOkruUrl(url) {
        try {
            const u = new URL(url);
            const host = u.hostname.replace('www.', '');
            return host === 'ok.ru' && u.pathname.startsWith('/video/');
        } catch { return false; }
    }


    // ─────────────────────────────────────────────────────────────────────────
    // ID parsers
    // ─────────────────────────────────────────────────────────────────────────

    function parseYouTubeIds(url) {
        const videoMatch = url.match(/(?:youtu\.be\/|[?&]v=)([^&]+)/);
        const playlistMatch = url.match(/[?&]list=([^&]+)/);
        const videoIdsMatch = url.match(/[?&]video_ids=([^&]+)/);
        return {
            videoId: videoMatch ? videoMatch[1] : null,
            playlistId: playlistMatch ? playlistMatch[1] : null,
            videoIds: videoIdsMatch ? videoIdsMatch[1].split(',') : null,
        };
    }

    function parseDailymotionIds(url) {
        try {
            const u = new URL(url);
            const video = u.pathname.match(/^\/video\/([^/]+)/);
            const playlist = u.pathname.match(/^\/playlist\/([^/]+)/)
                || (u.searchParams.has('playlist') ? [null, u.searchParams.get('playlist')] : null);
            if (video) return { type: 'video', id: video[1], playlistId: playlist?.[1] ?? null };
            if (playlist) return { type: 'playlist', id: playlist[1], playlistId: playlist[1] };
        } catch { /* noop */ }
        return { type: null, id: null, playlistId: null };
    }

    function parseOkruIds(url) {
        try {
            const u = new URL(url);
            const video = u.pathname.match(/^\/video\/([^/]+)/);
            if (video) {
                const playlistIds = u.searchParams.has('video_ids')
                    ? u.searchParams.get('video_ids').split(',').map(s => s.trim()).filter(Boolean)
                    : null;
                const rawLabels = u.search.match(/[?&]labels=([^&]*)/)?.[1];
                const labels = rawLabels
                    ? rawLabels.split(',').map(s => decodeURIComponent(s.trim())).filter(Boolean)
                    : null;
                return { type: 'video', id: video[1], playlistIds, labels };
            }
        } catch { /* noop */ }
        return { type: null, id: null, playlistIds: null, labels: null };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Embed src builders
    // ─────────────────────────────────────────────────────────────────────────

    function buildParams(autoplay, extra) {
        const p = new URLSearchParams(extra);
        if (autoplay) p.set('autoplay', '1');
        return p;
    }

    function buildYouTubeEmbedSrc(ids, autoplay) {
        if (ids.videoId) {
            const p = buildParams(autoplay, ids.playlistId ? { list: ids.playlistId } : {});
            p.set('enablejsapi', '1');
            return `https://www.youtube.com/embed/${ids.videoId}?${p}`;
        }
        if (ids.videoIds && ids.videoIds.length) {
            const p = buildParams(autoplay, { playlist: ids.videoIds.join(',') });
            p.set('enablejsapi', '1');
            return `https://www.youtube.com/embed/videoseries?${p}`;
        }
        return null;
    }

    function buildDailymotionEmbedSrc(ids, autoplay) {
        if (!ids.id) return null;
        const p = buildParams(autoplay);
        if (ids.type === 'playlist') {
            return `https://www.dailymotion.com/embed/playlist/${ids.id}?${p}`;
        }
        if (ids.playlistId) p.set('playlist', ids.playlistId);
        return `https://www.dailymotion.com/embed/video/${ids.id}?${p}`;
    }

    function buildOkruEmbedSrc(ids, autoplay, baseUrl) {
        if (!ids.id) return null;
        const p = buildParams(autoplay);
        return `${baseUrl}${ids.id}&${p}`;
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Iframe builder
    // ─────────────────────────────────────────────────────────────────────────

    function buildIframe(src, title) {
        return `<iframe src="${src}" title="${title}" frameborder="0" `
            + `allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Embed resolution  (pure — no DOM)
    // ─────────────────────────────────────────────────────────────────────────

    function resolveEmbedHtml(url, autoplay, okruBaseUrl) {
        if (isYouTubeUrl(url)) {
            const src = buildYouTubeEmbedSrc(parseYouTubeIds(url), autoplay);
            return src ? buildIframe(src, 'YouTube player') : null;
        }
        if (isDailymotionUrl(url)) {
            const src = buildDailymotionEmbedSrc(parseDailymotionIds(url), autoplay);
            return src ? buildIframe(src, 'Dailymotion player') : null;
        }
        if (isOkruUrl(url)) {
            const src = buildOkruEmbedSrc(parseOkruIds(url), autoplay, okruBaseUrl);
            return src ? buildIframe(src, 'Ok.ru player') : null;
        }
        return null;
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Pause helper
    // ─────────────────────────────────────────────────────────────────────────

    function pauseIframe(iframe) {
        if (!iframe) return;
        if (iframe.src.includes('youtube.com')) {
            iframe.contentWindow.postMessage(
                JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
                'https://www.youtube.com'
            );
        } else if (iframe.src.includes('dailymotion.com')) {
            iframe.contentWindow.postMessage('pause', 'https://www.dailymotion.com');
        }
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Thumbnail resolvers  (pure except resolveOkruThumbnail which fetches)
    // ─────────────────────────────────────────────────────────────────────────

    function resolveYouTubeThumbnail(url) {
        const video = url.match(/(?:youtu\.be\/|[?&]v=)([^&]+)/);
        if (video) return `https://img.youtube.com/vi/${video[1]}/hqdefault.jpg`;
        const ids = url.match(/[?&]video_ids=([^&,]+)/);
        if (ids) return `https://img.youtube.com/vi/${ids[1]}/hqdefault.jpg`;
        return null;
    }

    function resolveDailymotionThumbnail(url) {
        const video = url.match(/\/video\/([^_?/]+)/);
        if (video) return `https://www.dailymotion.com/thumbnail/video/${video[1]}`;
        return null;
    }

    async function resolveOkruThumbnail(url) {
        try {
            const res = await fetch(`https://ok.ru/oembed?url=${encodeURIComponent(url)}&format=json`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.thumbnail_url ?? null;
        } catch { return null; }
    }

    async function resolveThumbnail(url) {
        if (isYouTubeUrl(url)) return resolveYouTubeThumbnail(url);
        if (isDailymotionUrl(url)) return resolveDailymotionThumbnail(url);
        if (isOkruUrl(url)) return resolveOkruThumbnail(url);
        return null;
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Thumbnail cache
    // ─────────────────────────────────────────────────────────────────────────

    const _thumbCache = new Map();

    async function resolveThumbnailCached(url) {
        if (_thumbCache.has(url)) return _thumbCache.get(url);
        const result = await resolveThumbnail(url);
        _thumbCache.set(url, result);
        return result;
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Tooltip — DOM helpers
    // ─────────────────────────────────────────────────────────────────────────

    function injectTooltipStyles() {
        if (document.getElementById(TOOLTIP_STYLES_ID)) return;
        const s = document.createElement('style');
        s.id = TOOLTIP_STYLES_ID;
        const h = TOOLTIP_IMG_SIZE.height;
        s.textContent = `
        #${TOOLTIP_ID} {
            position: relative;
            height: ${h}px;
        }
        #${TOOLTIP_ID}.lp-no-thumb {
            display: flex;
            align-items: center;
            padding: 0 12px;
            min-height: 42px;
        }
        #${TOOLTIP_ID}.lp-no-thumb .lp-tooltip-title {
            position: static;
            bottom: auto; left: auto; right: auto;
            font-size: 13px;
            text-shadow: none;
            color: #ccc;
        }
        #${TOOLTIP_ID}::after {
            content: '';
            position: absolute;
            bottom: 0; left: 0; right: 0;
            height: 60px;
            background: linear-gradient(to bottom, transparent, rgba(0,0,0,.7));
            pointer-events: none;
        }
        #${TOOLTIP_ID}.lp-no-thumb::after {
            display: none;
        }
        #${TOOLTIP_ID} .lp-tooltip-loader,
        #${TOOLTIP_ID} .lp-tooltip-img {
            display: block;
            width: 100%;
            height: ${h}px;
        }
        #${TOOLTIP_ID} .lp-tooltip-loader {
            background: #111;
            position: relative;
        }
        #${TOOLTIP_ID} .lp-tooltip-loader::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, transparent 0%, #2a2a2a 50%, transparent 100%);
            background-size: 200% 100%;
            animation: lp-shimmer 1.2s infinite;
        }
        #${TOOLTIP_ID} .lp-tooltip-img { object-fit: cover; }
        #${TOOLTIP_ID} .lp-tooltip-play {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 68px;
            height: 48px;
            background-color: rgba(0,0,0,.8);
            border-radius: 12px;
            opacity: 0.9;
            transition: opacity .2s, background .2s, border-color .2s;
        }
        #${TOOLTIP_ID} .lp-tooltip-play::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 55%;
            transform: translate(-50%, -50%);
            border-style: solid;
            border-width: 12px 0 12px 20px;
            border-color: transparent transparent transparent white;
        }
        #${TOOLTIP_ID}:hover .lp-tooltip-play {
            opacity: 1;
            background: rgba(255,255,255,.15);
            border-color: rgba(255,255,255,.55);
        }
        #${TOOLTIP_ID} .lp-tooltip-title {
            position: absolute;
            bottom: 12px; left: 12px; right: 12px;
            color: #fff;
            font-size: 14px; font-weight: 500;
            font-family: system-ui, sans-serif;
            z-index: 1;
            text-shadow: 1px 1px 2px rgba(0,0,0,.5);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        @keyframes lp-shimmer {
            from { background-position: 200% 0; }
            to   { background-position: -200% 0; }
        }
        @media (hover: none) {
            #${TOOLTIP_ID} .lp-tooltip-play { opacity: 1; }
        }
    `;
        document.head.appendChild(s);
    }

    function createTooltipEl() {
        const el = document.createElement('div');
        el.id = TOOLTIP_ID;
        el.innerHTML = `
            <div class="lp-tooltip-loader"></div>
            <img class="lp-tooltip-img" alt="" />
            <div class="lp-tooltip-play"></div>
            <span class="lp-tooltip-title"></span>
        `;
        Object.assign(el.style, {
            display: 'none',
            position: 'fixed',
            zIndex: '9999',
            width: `${TOOLTIP_IMG_SIZE.width}px`,
            background: '#1a1a1a',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,.55)',
            pointerEvents: 'none',
            transition: 'opacity .15s ease, transform .15s ease',
            opacity: '0',
            transform: 'translateY(4px)',
        });
        document.body.appendChild(el);
        injectTooltipStyles();
        return el;
    }

    function getTooltipEl() {
        return document.getElementById(TOOLTIP_ID) || createTooltipEl();
    }

    function positionTooltip(tooltip, e) {
        const margin = 14;
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        let x = e.clientX + margin;
        let y = e.clientY + margin;
        if (x + tw > window.innerWidth) x = e.clientX - tw - margin;
        if (y + th > window.innerHeight) y = e.clientY - th - margin;
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
    }

    async function showTooltip(tooltip, url, label, forcedThumb) {
        const img = tooltip.querySelector('.lp-tooltip-img');
        const loader = tooltip.querySelector('.lp-tooltip-loader');
        const title = tooltip.querySelector('.lp-tooltip-title');

        img.style.display = 'none';
        img.src = '';
        loader.style.display = 'block';
        title.textContent = label || '';

        tooltip.style.display = 'block';
        requestAnimationFrame(() => {
            tooltip.style.opacity = '1';
            tooltip.style.transform = 'translateY(0)';
        });

        const thumbUrl = forcedThumb || await resolveThumbnailCached(url);
        if (!thumbUrl) {
            loader.style.display = 'none';
            tooltip.classList.add('lp-no-thumb');
            return;
        }
        tooltip.classList.remove('lp-no-thumb');

        const image = new Image();
        image.onload = () => { loader.style.display = 'none'; img.src = thumbUrl; img.style.display = 'block'; };
        image.onerror = () => { loader.style.display = 'none'; tooltip.classList.add('lp-no-thumb'); };
        image.src = thumbUrl;
    }

    function hideTooltip(tooltip) {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translateY(4px)';
        setTimeout(() => { tooltip.style.display = 'none'; }, 150);
    }

    function isTooltipVisible(tooltip) {
        return !!tooltip && tooltip.style.display !== 'none';
    }

    // Garde-fou global : ferme le tooltip si un tap a lieu hors du lien/tooltip.
    // Utile sur les appareils hybrides (souris + tactile) où mouseleave peut
    // ne pas se déclencher de façon fiable après un tap.
    let _tooltipOutsideHandlerAttached = false;

    function attachTooltipOutsideTapHandler(tooltip) {
        if (_tooltipOutsideHandlerAttached) return;
        _tooltipOutsideHandlerAttached = true;

        document.addEventListener('pointerdown', e => {
            if (!isTooltipVisible(tooltip)) return;
            const target = e.target;
            if (tooltip.contains(target)) return;
            if (target.closest && target.closest('a[data-link]')) return;
            hideTooltip(tooltip);
        }, true);
    }


    // ─────────────────────────────────────────────────────────────────────────
    // Ok.ru playlist sidebar
    // ─────────────────────────────────────────────────────────────────────────

    function injectOkruPlaylistStyles() {
        if (document.getElementById(OKRU_PLAYLIST_STYLES_ID)) return;
        const s = document.createElement('style');
        s.id = OKRU_PLAYLIST_STYLES_ID;
        s.textContent = `
        .lp-okru-playlist-active {
            position: relative !important;
            padding-top: 0 !important;
            height: auto !important;
        }
        .lp-okru-playlist-active::before {
            display: none !important;
        }
        .lp-okru-playlist-active iframe {
            position: static !important;
        }
        .lp-okru-wrap {
            display: flex;
            flex-direction: row;
            width: 100%;
            background: #0d0d0d;
            border-radius: 6px;
            overflow: hidden;
            align-items: flex-start;
            position: relative;
        }
        .lp-okru-iframe-slot {
            flex: 1 1 auto;
            min-width: 0;
            width: calc(100% - 176px);
            aspect-ratio: 16 / 9;
            position: relative;
            background: #000;
        }
        .lp-okru-iframe-slot iframe {
            display: block;
            width: 100%;
            height: 100%;
            border: none;
        }
        .lp-okru-sidebar {
            flex: 0 0 176px;
            width: 176px;
            position: absolute;
            top: 0; right: 0; bottom: 0;
            background: #141414;
            border-left: 1px solid #2a2a2a;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: thin;
            scrollbar-color: #2e2e2e transparent;
            z-index: 5;
        }
        .lp-okru-sidebar::-webkit-scrollbar { width: 3px; }
        .lp-okru-sidebar::-webkit-scrollbar-thumb { background: #2e2e2e; border-radius: 2px; }
        .lp-okru-sidebar-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 8px 7px 12px;
            position: sticky;
            top: 0;
            z-index: 1;
            background: #141414;   /* ← évite la transparence lors du scroll */
        }
       .lp-okru-sidebar-collapse-btn {
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: none;
            border: 1px solid #252525;
            border-radius: 4px;
            cursor: pointer;
            color: #444;
            transition: color .12s, background .12s, border-color .12s;
            padding: 0;
            flex-shrink: 0;
        }
        .lp-okru-sidebar-collapse-btn:hover {
            color: #aaa;
            background: rgba(255,255,255,0.06);
            border-color: #444;
        }
        .lp-okru-sidebar-collapse-btn svg {
            display: block;
            width: 10px;
            height: 10px;
        }
        .lp-okru-item {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 8px 12px;
            border-bottom: 1px solid #1c1c1c;
            cursor: pointer;
            transition: background .12s;
            user-select: none;
        }
        .lp-okru-item:last-child { border-bottom: none; }
        .lp-okru-item:hover { background: #1e1e1e; }
        .lp-okru-item.lp-okru-active {
            background: #1e1e1e;
            border-left: 2px solid #f7931e;
            padding-left: 10px;
        }
        .lp-okru-num {
            font-size: 11px;
            color: #3a3a3a;
            font-family: system-ui, sans-serif;
            min-width: 18px;
            flex-shrink: 0;
        }
        .lp-okru-item.lp-okru-active .lp-okru-num { color: #f7931e; }
        .lp-okru-label {
            flex: 1;
            font-size: 12px;
            color: #777;
            font-family: system-ui, sans-serif;
            line-height: 1.3;

            display: -webkit-box;
            -webkit-line-clamp: 2; /* nombre de lignes */
            -webkit-box-orient: vertical;

            overflow: hidden;
            text-overflow: ellipsis;
            overflow-wrap: break-word;
        }
        .lp-okru-item.lp-okru-active .lp-okru-label { color: #f0f0f0; }
        .lp-okru-arrow {
            flex-shrink: 0;
            width: 0; height: 0;
            border-style: solid;
            border-width: 4px 0 4px 6px;
            border-color: transparent transparent transparent #2e2e2e;
        }
        .lp-okru-item.lp-okru-active .lp-okru-arrow {
            border-color: transparent transparent transparent #f7931e;
        }
        .lp-okru-playlist-active {
            position: relative !important;
            padding-top: 0 !important;
            height: auto !important;
        }
        .lp-okru-playlist-active::before {
            display: none !important;
        }
        .lp-okru-playlist-active iframe {
            position: static !important;
        }
        .lp-okru-wrap {
            display: flex;
            flex-direction: row;
            width: 100%;
            background: #0d0d0d;
            border-radius: 6px;
            overflow: hidden;
            align-items: stretch;      
        }
        .lp-okru-iframe-slot {
            flex: 1 1 auto;
            min-width: 0;
            /* supprimé : width: calc(100% - 176px) */
            aspect-ratio: 16 / 9;
            position: relative;
            background: #000;
        }
        .lp-okru-iframe-slot iframe {
            display: block;
            width: 100%;
            height: 100%;
            border: none;
        }
        .lp-okru-sidebar {
            flex: 0 0 150px;
            width: 150px;
            background: #141414;
            border-left: 1px solid #2a2a2a;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: thin;
            scrollbar-color: #2e2e2e transparent;
            transition: flex-basis .2s ease, width .2s ease, opacity .2s ease;
        }
        /* état replié */
        .lp-okru-sidebar.lp-okru-sidebar-collapsed {
            flex-basis: 0;
            width: 0 !important;
            opacity: 0;
            overflow: hidden;
            border-left: none;
        }
        .lp-okru-sidebar::-webkit-scrollbar { width: 3px; }
        .lp-okru-sidebar::-webkit-scrollbar-thumb { background: #2e2e2e; border-radius: 2px; }

        /* bouton toggle */
        .lp-okru-toggle {
            position: absolute;
            top: 8px;
            right: 60px;
            z-index: 10;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0);
            border: none;
            border-radius: 50%;
            cursor: pointer;
            color: #fff;
            transition: opacity .15s;
            padding: 0;
            opacity: 0;
            pointer-events: none;
        }
        .lp-okru-wrap:has(.lp-okru-sidebar-collapsed):hover .lp-okru-toggle {
            opacity: 1;
            pointer-events: auto;
        }
        .lp-okru-wrap.lp-okru-toggle-visible .lp-okru-toggle {
            opacity: 1;
            pointer-events: auto;
        }
        .lp-okru-toggle:hover { opacity: 0.8; }
        .lp-okru-toggle svg {
            display: block;
            width: 18px;
            height: 18px;
            flex-shrink: 0;
        }
            
        `;
        document.head.appendChild(s);
    }

    function getSidebarWidth(labels) {
        const MAX_CHARS_PER_LINE = 28; // ~2 lignes confortables
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = '12px system-ui, sans-serif';

        // On mesure chaque label tronqué à MAX_CHARS_PER_LINE
        const maxPx = Math.max(...labels.map(l => {
            const truncated = l.length > MAX_CHARS_PER_LINE ? l.slice(0, MAX_CHARS_PER_LINE) : l;
            return ctx.measureText(truncated).width;
        }));

        const CHROME = 66; // num + gap + arrow + paddings
        const width = Math.min(Math.max(Math.ceil(maxPx) + CHROME, 176), 280);
        return `${width}px`;
    }

    // Sur tactile, le bouton toggle n'a pas de :hover fiable. On déclenche son
    // affichage temporaire au tap sur la zone iframe (quand la sidebar est
    // repliée), puis on le masque après un délai.
    function attachOkruToggleTouchReveal(wrap, iframeSlot) {
        if (!isTouchDevice()) return;
        let hideTimer = null;

        const reveal = () => {
            if (!wrap.querySelector('.lp-okru-sidebar-collapsed')) return;
            wrap.classList.add('lp-okru-toggle-visible');
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                wrap.classList.remove('lp-okru-toggle-visible');
            }, OKRU_TOGGLE_VISIBLE_DELAY);
        };

        iframeSlot.addEventListener('pointerdown', e => {
            // Ne pas intercepter un tap directement sur le bouton toggle lui-même.
            if (e.target.closest && e.target.closest('.lp-okru-toggle')) return;
            reveal();
        });
    }

    function buildOkruPlaylistLayout(iframeSrc, ids, okruBase) {
        injectOkruPlaylistStyles();

        const allIds = [ids.id, ...ids.playlistIds.filter(id => id !== ids.id)];
        const allLabels = ids.labels || [];

        const wrap = document.createElement('div');
        wrap.className = 'lp-okru-wrap';

        // — iframe slot
        const iframeSlot = document.createElement('div');
        iframeSlot.className = 'lp-okru-iframe-slot';
        iframeSlot.style.position = 'relative'; // pour le bouton toggle absolu

        const iframe = document.createElement('iframe');
        iframe.src = iframeSrc;
        iframe.title = 'Ok.ru player';
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
        iframe.setAttribute('allowfullscreen', '');
        iframeSlot.appendChild(iframe);

        // — sidebar
        const sidebar = document.createElement('div');
        sidebar.className = 'lp-okru-sidebar';
        if (allLabels.length > 0) {
            const sidebarWidth = getSidebarWidth(allLabels);
            sidebar.style.width = sidebarWidth;
            // sidebar.style.cssText += `flex-basis: ${sidebarWidth}; width: ${sidebarWidth};`;
        }

        const header = document.createElement('div');
        header.className = 'lp-okru-sidebar-header';
        header.innerHTML = `
            <span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#4a4a4a;font-family:system-ui,sans-serif;">Playlist</span>
            <span class="lp-okru-sidebar-collapse-btn" title="Hide playlist">
                <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M6 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </span>
        `;
        sidebar.appendChild(header);

        allIds.forEach((videoId, index) => {
            const item = document.createElement('div');
            item.className = 'lp-okru-item' + (videoId === ids.id ? ' lp-okru-active' : '');
            item.dataset.videoId = videoId;

            const num = document.createElement('span');
            num.className = 'lp-okru-num';
            num.textContent = String(index + 1).padStart(2, '0');

            const label = document.createElement('span');
            label.className = 'lp-okru-label';
            const textContent = allLabels.length > index ? allLabels[index] : `Video ${index + 1}`;
            label.textContent = textContent;
            item.title = textContent;

            const arrow = document.createElement('span');
            arrow.className = 'lp-okru-arrow';

            item.appendChild(num);
            item.appendChild(label);
            item.appendChild(arrow);

            item.addEventListener('click', () => {
                const newSrc = buildOkruEmbedSrc({ id: videoId }, false, okruBase);
                iframe.src = newSrc;
                sidebar.querySelectorAll('.lp-okru-item').forEach(el => el.classList.remove('lp-okru-active'));
                item.classList.add('lp-okru-active');
            });

            sidebar.appendChild(item);
        });

        // — bouton toggle (positionné sur l'iframe slot)
        const toggle = document.createElement('div');
        toggle.className = 'lp-okru-toggle';
        toggle.title = 'Show playlist';
        toggle.innerHTML = `
            <svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line x1="3" y1="5"  x2="15" y2="5"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <line x1="3" y1="9"  x2="15" y2="9"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <line x1="3" y1="13" x2="10" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        `;

        // collapse via header button
        header.querySelector('.lp-okru-sidebar-collapse-btn').addEventListener('click', () => {
            sidebar.classList.add('lp-okru-sidebar-collapsed');
            wrap.classList.remove('lp-okru-toggle-visible');
            // toggle devient visible au hover wrap (géré par CSS), ou au tap sur mobile
        });

        // expand via toggle
        toggle.addEventListener('click', () => {
            sidebar.classList.remove('lp-okru-sidebar-collapsed');
            wrap.classList.remove('lp-okru-toggle-visible');
        });

        iframeSlot.appendChild(toggle);

        wrap.appendChild(iframeSlot);
        wrap.appendChild(sidebar);

        attachOkruToggleTouchReveal(wrap, iframeSlot);

        return wrap;
    }


    // ─────────────────────────────────────────────────────────────────────────
    // LinkPlayer class
    // ─────────────────────────────────────────────────────────────────────────

    class LinkPlayer {
        constructor(options = {}) {
            this._options = options;
            this._scope = this._resolveScope(options.scope);
            this._okruBase = options.embedBaseUrl || 'https://ok.ru/videoembed/';
            this._tooltip = null;

            try {
                this.scan();
            } catch (err) {
                this._options.onError?.('LinkPlayer init failed: ' + err.message);
            }
        }

        // ── Private ───────────────────────────────────────────────────────────

        _resolveScope(scope) {
            if (scope instanceof HTMLElement) return scope;
            if (typeof scope === 'string') return document.querySelector(scope) || document.documentElement;
            return document.documentElement;
        }

        _resolveTargetContainer(link) {
            if (link.dataset.target) return document.getElementById(link.dataset.target);
            const next = link.nextElementSibling;
            if (next?.classList.contains('lp-inline-target')) return next;
            const div = document.createElement('div');
            div.className = 'lp-inline-target';
            link.insertAdjacentElement('afterend', div);
            return div;
        }

        _currentIframeSrc(container) {
            return container.querySelector('iframe')?.src ?? null;
        }

        _extractSrc(iframeHtml) {
            return iframeHtml.match(/src="([^"]+)"/)?.[1] ?? null;
        }

        _mountEmbed(container, link, autoplay) {
            const url = link.href;
            // ── Ok.ru with playlist ───────────────────────────────────────────
            if (isOkruUrl(url)) {
                const ids = parseOkruIds(url);
                if (ids.id && ids.playlistIds && ids.playlistIds.length > 0) {
                    const iframeSrc = buildOkruEmbedSrc(ids, autoplay, this._okruBase);
                    if (!iframeSrc) {
                        this._options.onError?.(`URL non supportée : ${url}`);
                        return;
                    }

                    // toggle : same first video → close
                    const currentIframe = container.querySelector('iframe');
                    if (currentIframe && currentIframe.src === iframeSrc) {
                        container.classList.remove('lp-okru-playlist-active');
                        container.innerHTML = '';
                        return;
                    }

                    container.classList.remove('lp-okru-playlist-active');
                    container.innerHTML = '';
                    container.classList.add('lp-okru-playlist-active');
                    container.classList.add('lp-okru-playlist-active');
                    const layout = buildOkruPlaylistLayout(iframeSrc, ids, this._okruBase);
                    container.appendChild(layout);
                    this._options.onChange?.(url, link);
                    return;
                }
            }

            // ── Standard embed (YouTube / Dailymotion / Ok.ru sans playlist) ─
            const iframeHtml = resolveEmbedHtml(url, autoplay, this._okruBase);
            if (!iframeHtml) {
                this._options.onError?.(`URL non supportée : ${url}`);
                return;
            }

            const newSrc = this._extractSrc(iframeHtml);
            const currentSrc = this._currentIframeSrc(container);

            if (newSrc && newSrc === currentSrc) {
                pauseIframe(container.querySelector('iframe'));
                container.classList.remove('lp-okru-playlist-active');
                container.innerHTML = '';
                return;
            }

            pauseIframe(container.querySelector('iframe'));
            container.classList.remove('lp-okru-playlist-active');
            container.innerHTML = this._options.wrapEmbed
                ? this._options.wrapEmbed(iframeHtml)
                : iframeHtml;

            this._options.onChange?.(url, link);
        }

        _attachTooltip(link) {
            if (this._options.tooltip === false) return;
            // Pas de tooltip de survol sur tactile : il n'y a pas de "hover" avant
            // le tap, et mouseenter/mouseleave ne se comportent pas de façon fiable.
            if (isTouchDevice()) return;

            if (!this._tooltip) this._tooltip = getTooltipEl();
            const tooltip = this._tooltip;
            attachTooltipOutsideTapHandler(tooltip);
            let timer = null;

            link.addEventListener('mouseenter', () => {
                timer = setTimeout(
                    () => showTooltip(tooltip, link.href, link.textContent.trim(), link.dataset.thumbnail),
                    TOOLTIP_SHOW_DELAY
                );
            });
            link.addEventListener('mousemove', e => positionTooltip(tooltip, e));
            link.addEventListener('mouseleave', () => { clearTimeout(timer); hideTooltip(tooltip); });
        }

        scan() {
            this._scope.querySelectorAll('a[data-link]').forEach(link => {
                const autoplay = link.hasAttribute('data-autoplay');

                if (link.hasAttribute('data-show-on-init')) {
                    const container = this._resolveTargetContainer(link);
                    if (container) this._mountEmbed(container, link, autoplay);
                }

                link.addEventListener('click', e => {
                    e.preventDefault();
                    const container = this._resolveTargetContainer(link);
                    if (container) this._mountEmbed(container, link, autoplay);
                });

                this._attachTooltip(link);
            });
        }
    }

    LinkPlayer._internal = {
        // device
        isTouchDevice,
        // detect
        isYouTubeUrl,
        isDailymotionUrl,
        isOkruUrl,
        // parsers
        parseYouTubeIds,
        parseDailymotionIds,
        parseOkruIds,
        // builders
        buildYouTubeEmbedSrc,
        buildDailymotionEmbedSrc,
        buildOkruEmbedSrc,
        buildIframe,
        // résolution
        resolveEmbedHtml,
        // thumbnails
        resolveYouTubeThumbnail,
        resolveDailymotionThumbnail,
        resolveOkruThumbnail,
        resolveThumbnail,
        resolveThumbnailCached,
        // cache
        thumbnailCache: _thumbCache,
    };

    return LinkPlayer;

}));