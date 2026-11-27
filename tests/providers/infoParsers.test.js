// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { InfoParser } from "../../src/providers/InfoParser.js";
import { YouTubeInfoParser } from "../../src/providers/youtube/YouTubeInfoParser.js";
import { OkruInfoParser } from "../../src/providers/okru/OkruInfoParser.js";
import { VideoInfo } from "../../src/models/VideoInfo.js";
import { VideoListInfo } from "../../src/models/VideoListInfo.js";
import { PlaylistInfo } from "../../src/models/PlaylistInfo.js";
import { UrlInfo, SrcInfo } from "../../src/models/UrlInfo.js";

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

// ───────────────────────── helpers de test ─────────────────────────
// IDs YouTube valides (11 caractères) tirés des exemples
const V1 = "69iUWLA0oVc", V2 = "z2sv_RsNwM4", V3 = "-xiF9YIIUk4", V4 = "s11CNT_hQTg", V5 = "C_dEl2cMCEA";
const PL = "PLYALQE76y6LQ";

/** <a href=… data-…> ; les clés de `data` sont en kebab-case ("channel-url"). */
function link(href, data = {}) {
    const a = document.createElement("a");
    if (href) a.setAttribute("href", href);
    for (const [k, v] of Object.entries(data)) a.setAttribute(`data-${k}`, v);
    return a;
}

/** Iframe dans un conteneur (id optionnel), rattaché au document. */
function frameIn(src, hostId = "host") {
    const host = document.createElement("div");
    if (hostId) host.id = hostId;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", src);
    host.append(iframe);
    document.body.append(host);
    return iframe;
}

// ───────────────────────── InfoParser (base) ─────────────────────────
describe("InfoParser (classe de base)", () => {
    const p = new InfoParser();

    it("getUrl : href d'un <a>, src d'une <iframe>, data-url sinon", () => {
        expect(p.getUrl(link("https://a.test/x"))).toBe("https://a.test/x");
        expect(p.getUrl(frameIn("https://a.test/embed"))).toBe("https://a.test/embed");
        const div = document.createElement("div");
        div.dataset.url = "https://a.test/d";
        expect(p.getUrl(div)).toBe("https://a.test/d");
        expect(p.getUrl(document.createElement("span"))).toBeUndefined();
    });

    it("parseJsonAttribute : undefined, tableau, JSON invalide, non-tableau", () => {
        expect(p.parseJsonAttribute(undefined, "data-videos")).toBeUndefined();
        expect(p.parseJsonAttribute('[{"a":1}]', "data-videos")).toEqual([{ a: 1 }]);
        expect(() => p.parseJsonAttribute("{nope", "data-videos")).toThrow(/Invalid JSON in data-videos/);
        expect(() => p.parseJsonAttribute('{"a":1}', "data-videos")).toThrow(/must be a JSON array/);
    });

    it("getValidUrl : URL ou null (avec trim)", () => {
        expect(p.getValidUrl("  https://a.test/x  ").href).toBe("https://a.test/x");
        expect(p.getValidUrl("pas une url")).toBeNull();
    });

    it("méthodes abstraites", () => {
        expect(() => p.parseUrl("x")).toThrow(/must be implemented/);
        expect(() => p.parseSrc("x")).toThrow(/must be implemented/);
        expect(() => p.buildUrl({})).toThrow(/must be implemented/);
        expect(() => p.parseFromFrame({})).toThrow(/must be implemented/);
        expect(() => p.parseDefinition({})).toThrow(/must be implemented/);
    });

    it("readLinkData : lit les data-* (kebab → camelCase), data-videos en JSON", () => {
        const a = link("https://a.test/x", {
            autoplay: "click", start: "1m", title: "T", description: "D", channel: "C", "channel-url": "https://c",
            thumbnail: "https://t", duration: "2m", index: "3", target: "player", "show-on-init": "", key: "k",
            extra: "ex", format: "shorts", mute: "", videos: '[{"title":"A"}]'
        });
        expect(p.readLinkData(a)).toEqual({
            autoplay: "click", start: "1m", title: "T", description: "D", channel: "C", channelUrl: "https://c",
            thumbnail: "https://t", duration: "2m", videos: [{ title: "A" }], index: 3, target: "player",
            showOnInit: true, key: "k", extra: "ex", format: "shorts", mute: ""
        });
    });

    it("readLinkData : valeurs par défaut", () => {
        const d = p.readLinkData(link("https://a.test/x"));
        expect(d.videos).toEqual([]);
        expect(d.index).toBeUndefined();
        expect(d.showOnInit).toBe(false);
        expect(d.target).toBeUndefined();
    });

    it("readLinkData : pour une iframe, la cible par défaut est l'id du parent", () => {
        expect(p.readLinkData(frameIn("https://a.test/e", "mon-conteneur")).target).toBe("mon-conteneur");
    });
});

// ═════════════════════════ YouTube ═════════════════════════
describe("YouTubeInfoParser", () => {
    const yt = new YouTubeInfoParser();

    describe("isValidVideoId", () => {
        it("11 caractères [a-zA-Z0-9_-]", () => {
            expect(yt.isValidVideoId(V1)).toBe(true);
            expect(yt.isValidVideoId(V3)).toBe(true);   // commence par '-'
            expect(yt.isValidVideoId("court")).toBe(false);
            expect(yt.isValidVideoId("trop-long-12345")).toBe(false);
            expect(yt.isValidVideoId("abc$efghijk")).toBe(false);
            expect(yt.isValidVideoId(null)).toBe(false);
            expect(yt.isValidVideoId(12345678901)).toBe(false);
        });
    });

    // ───────── parseUrl ─────────
    describe("parseUrl", () => {
        it("watch?v= : vidéo seule", () => {
            const u = yt.parseUrl(`https://www.youtube.com/watch?v=${V1}`);
            expect(u).toBeInstanceOf(UrlInfo);
            expect(u).toMatchObject({ kind: "video", videoId: V1, source: `https://www.youtube.com/watch?v=${V1}` });
            expect(u.startSeconds).toBeNull();
        });

        it("start via t= (secondes ou 1h2m3s)", () => {
            expect(yt.parseUrl(`https://www.youtube.com/watch?v=${V1}&t=2712s`).startSeconds).toBe(2712);
            expect(yt.parseUrl(`https://www.youtube.com/watch?v=${V1}&t=90`).startSeconds).toBe(90);
            expect(yt.parseUrl(`https://www.youtube.com/watch?v=${V1}&t=1h2m3s`).startSeconds).toBe(3723);
        });

        it("hôtes acceptés : sans www, m., music.", () => {
            for (const host of ["youtube.com", "m.youtube.com", "music.youtube.com"]) {
                expect(yt.parseUrl(`https://${host}/watch?v=${V1}`).videoId).toBe(V1);
            }
        });

        it("youtu.be : vidéo, avec t, avec list", () => {
            expect(yt.parseUrl(`https://youtu.be/${V1}`)).toMatchObject({ kind: "video", videoId: V1 });
            expect(yt.parseUrl(`https://youtu.be/${V1}?t=30`).startSeconds).toBe(30);
            expect(yt.parseUrl(`https://youtu.be/${V1}?list=${PL}`)).toMatchObject({ kind: "playlist", videoId: V1, playlistId: PL });
            expect(() => yt.parseUrl("https://youtu.be/pasvalide")).toThrow(/Invalid video ID/);
        });

        it("playlist : avec vidéo de départ, sans, avec index", () => {
            expect(yt.parseUrl(`https://www.youtube.com/watch?v=${V4}&list=${PL}`))
                .toMatchObject({ kind: "playlist", videoId: V4, playlistId: PL });
            expect(yt.parseUrl(`https://www.youtube.com/watch?list=${PL}`))
                .toMatchObject({ kind: "playlist", videoId: null, playlistId: PL });
            expect(yt.parseUrl(`https://www.youtube.com/watch?v=${V4}&list=${PL}&index=3`).index).toBe(3);
        });

        it("watch : erreurs", () => {
            expect(() => yt.parseUrl("https://www.youtube.com/watch?v=trop-court")).toThrow(/Invalid video ID/);
            expect(() => yt.parseUrl("https://www.youtube.com/watch")).toThrow(/Missing video ID or playlist/);
        });

        it("watch_videos : liste de vidéos + index", () => {
            const u = yt.parseUrl(`https://www.youtube.com/watch_videos?video_ids=${V2},${V3}&index=1`);
            expect(u).toMatchObject({ kind: "videoList", videoIds: [V2, V3], videoId: V2, index: 1 });
        });

        it("watch_videos : ids invalides ignorés, erreurs", () => {
            expect(yt.parseUrl(`https://www.youtube.com/watch_videos?video_ids=${V2},bad,${V3}`).videoIds).toEqual([V2, V3]);
            expect(() => yt.parseUrl("https://www.youtube.com/watch_videos?video_ids=bad,worse")).toThrow(/No valid video IDs/);
            expect(() => yt.parseUrl("https://www.youtube.com/watch_videos")).toThrow(/Missing video_ids/);
        });

        it("shorts : vidéo au format portrait", () => {
            const u = yt.parseUrl(`https://www.youtube.com/shorts/${V1}?t=5`);
            expect(u).toMatchObject({ kind: "video", videoId: V1, format: "portrait", startSeconds: 5 });
            expect(() => yt.parseUrl("https://www.youtube.com/shorts/nope")).toThrow(/Invalid video ID/);
        });

        it("URL invalide ou non supportée", () => {
            expect(() => yt.parseUrl("pas une url")).toThrow(/Invalid URL/);
            expect(() => yt.parseUrl("https://vimeo.com/123")).toThrow(/Unsupported YouTube URL/);
            expect(() => yt.parseUrl("https://www.youtube.com/channel/abc")).toThrow(/Unsupported YouTube URL/);
        });
    });

    // ───────── parseSrc (iframes) ─────────
    describe("parseSrc", () => {
        it("embed/ID : vidéo, avec start / autoplay / mute", () => {
            const s = yt.parseSrc(`https://www.youtube.com/embed/${V1}?start=60&autoplay=1&mute=1`);
            expect(s).toBeInstanceOf(SrcInfo);
            expect(s).toMatchObject({ kind: "video", videoId: V1, startSeconds: 60, autoplay: true, mute: true });
        });

        it("autoplay=0 → false ; absent → null", () => {
            expect(yt.parseSrc(`https://www.youtube.com/embed/${V1}?autoplay=0`).autoplay).toBe(false);
            expect(yt.parseSrc(`https://www.youtube.com/embed/${V1}`).autoplay).toBeNull();
            expect(yt.parseSrc(`https://www.youtube.com/embed/${V1}`).mute).toBeNull();
        });

        it("embed/videoseries?list= : playlist sans vidéo de départ", () => {
            expect(yt.parseSrc(`https://www.youtube.com/embed/videoseries?list=${PL}`))
                .toMatchObject({ kind: "playlist", playlistId: PL, videoId: null });
        });

        it("embed/ID?list= : playlist avec vidéo de départ", () => {
            expect(yt.parseSrc(`https://www.youtube.com/embed/${V4}?list=${PL}`))
                .toMatchObject({ kind: "playlist", playlistId: PL, videoId: V4 });
        });

        it("embed/?playlist=a,b&index=2 : liste de vidéos", () => {
            const s = yt.parseSrc(`https://www.youtube.com/embed/?playlist=${V2},${V3}&index=2`);
            expect(s).toMatchObject({ kind: "videoList", videoIds: [V2, V3], index: 2, videoId: null });
        });

        it("playlist= prime sur l'id du chemin", () => {
            expect(yt.parseSrc(`https://www.youtube.com/embed/${V2}?playlist=${V2},${V3}`).kind).toBe("videoList");
        });

        it("youtube-nocookie.com et www. acceptés", () => {
            expect(yt.parseSrc(`https://www.youtube-nocookie.com/embed/${V1}`).videoId).toBe(V1);
            expect(yt.parseSrc(`https://youtube-nocookie.com/embed/${V1}`).videoId).toBe(V1);
        });

        it("erreurs : URL, hôte, chemin, contenu", () => {
            expect(() => yt.parseSrc("nope")).toThrow(/Invalid URL/);
            expect(() => yt.parseSrc(`https://vimeo.com/embed/${V1}`)).toThrow(/Invalid embed host/);
            expect(() => yt.parseSrc(`https://www.youtube.com/watch?v=${V1}`)).toThrow(/Invalid embed URL/);
            expect(() => yt.parseSrc("https://www.youtube.com/embed/")).toThrow(/Invalid embed URL/);
            expect(() => yt.parseSrc("https://www.youtube.com/embed/videoseries")).toThrow(/Invalid embed URL/);
        });
    });

    // ───────── parseFromFrame ─────────
    describe("parseFromFrame", () => {
        it("vidéo : cible = id du parent, source = frame", () => {
            const f = frameIn(`https://www.youtube.com/embed/${V1}?start=30&autoplay=1&mute=1`, "mon-lecteur");
            const info = yt.parseFromFrame(f);
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({ provider: "youtube", target: "mon-lecteur", videoId: V1, startSeconds: 30, autoplay: "init", mute: true });
            expect(info.source).toMatchObject({ kind: "frame", element: f });
        });

        it("autoplay absent → 'none'", () => {
            expect(yt.parseFromFrame(frameIn(`https://www.youtube.com/embed/${V1}`)).autoplay).toBe("none");
        });

        it("liste de vidéos", () => {
            const info = yt.parseFromFrame(frameIn(`https://www.youtube.com/embed/?playlist=${V2},${V3}&index=1`));
            expect(info).toBeInstanceOf(VideoListInfo);
            expect(info.videoIds).toEqual([V2, V3]);
            expect(info.index).toBe(1);
        });

        it("playlist", () => {
            const info = yt.parseFromFrame(frameIn(`https://www.youtube.com/embed/videoseries?list=${PL}`));
            expect(info).toBeInstanceOf(PlaylistInfo);
            expect(info.playlistId).toBe(PL);
        });

        it("parent sans id : un id host:<uuid> est généré et posé sur le parent", () => {
            const f = frameIn(`https://www.youtube.com/embed/${V1}`, null);
            const info = yt.parseFromFrame(f);
            expect(info.target).toMatch(/^host:/);
            expect(f.parentElement.id).toBe(info.target);
        });

        it("erreurs : pas une iframe, src invalide, pas de parent", () => {
            expect(() => yt.parseFromFrame(document.createElement("div"))).toThrow(/Expected an IFRAME/);
            expect(() => yt.parseFromFrame(null)).toThrow(/Expected an IFRAME/);
            expect(() => yt.parseFromFrame(frameIn("https://vimeo.com/x"))).toThrow(/Invalid embed host/);
            const orphan = document.createElement("iframe");
            orphan.setAttribute("src", `https://www.youtube.com/embed/${V1}`);
            expect(() => yt.parseFromFrame(orphan)).toThrow(/no parent element/);
        });
    });

    // ───────── parseDefinition ─────────
    describe("parseDefinition", () => {
        const url = `https://www.youtube.com/watch?v=${V1}`;

        it("vidéo : tous les champs, start/duration en notation 1h2m3s", () => {
            const info = yt.parseDefinition({
                url, target: "player", key: "maldives", title: "Maldives", description: "D", channel: "MyTranquilitee",
                channelUrl: "https://www.youtube.com/@MyTranquilitee", thumbnail: "https://t/x.jpg", duration: "6h6m46s",
                start: "1h20m3s", autoplay: "click", showOnInit: true, extra: { a: 1 }
            });
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({
                provider: "youtube", target: "player", videoId: V1, key: "maldives", title: "Maldives", description: "D",
                channel: "MyTranquilitee", channelUrl: "https://www.youtube.com/@MyTranquilitee", thumbnail: "https://t/x.jpg",
                duration: 22006, startSeconds: 4803, autoplay: "click", showOnInit: true
            });
            expect(info.extra).toEqual({ a: 1 });
        });

        it("vidéo : valeurs par défaut (textes vides, miniature YouTube)", () => {
            const info = yt.parseDefinition({ url, target: "p" });
            expect(info).toMatchObject({ title: "", description: "", channel: "", channelUrl: "", autoplay: "none", key: `youtube:${V1}` });
            expect(info.thumbnail).toBe(`https://i.ytimg.com/vi/${V1}/mqdefault.jpg`);
            expect(info.duration).toBeNull();
            expect(info.startSeconds).toBeNull();
        });

        it("vidéo : start de la définition prime sur t= de l'URL, sinon t= est utilisé", () => {
            expect(yt.parseDefinition({ url: `${url}&t=10`, target: "p", start: "1m" }).startSeconds).toBe(60);
            expect(yt.parseDefinition({ url: `${url}&t=10`, target: "p" }).startSeconds).toBe(10);
        });

        it("vidéo : format de la définition, sinon celui de l'URL (shorts)", () => {
            expect(yt.parseDefinition({ url, target: "p", format: "square" }).format).toBe("square");
            expect(yt.parseDefinition({ url: `https://www.youtube.com/shorts/${V1}`, target: "p" }).format).toBe("portrait");
        });

        it("target obligatoire", () => {
            expect(() => yt.parseDefinition({ url })).toThrow(/target/);
        });

        it("source : kind 'link' avec élément, 'definition' sans", () => {
            const a = link(url);
            expect(yt.parseDefinition({ url, target: "p" }, a).source).toMatchObject({ kind: "link", element: a, url });
            expect(yt.parseDefinition({ url, target: "p" }).source).toMatchObject({ kind: "definition", url });
        });

        it("thumbnailUrlBuilder injectable", () => {
            const custom = new YouTubeInfoParser({ thumbnailUrlBuilder: { getThumbnailUrl: (id) => `custom/${id}` } });
            expect(custom.parseDefinition({ url, target: "p" }).thumbnail).toBe(`custom/${V1}`);
        });

        it("liste de vidéos : infos positionnelles, miniatures par défaut", () => {
            const list = yt.parseDefinition({
                url: `https://www.youtube.com/watch_videos?video_ids=${V2},${V3}`, target: "p", autoplay: "click", key: "trip",
                videos: [{ title: "ASMR", start: "30", duration: "5m1s" }, { title: "Trains", channel: "Me", start: "1m" }]
            });
            expect(list).toBeInstanceOf(VideoListInfo);
            expect(list.key).toBe("trip");
            expect(list.videoIds).toEqual([V2, V3]);
            expect(list.videos).toHaveLength(2);
            expect(list.videos[0]).toMatchObject({ videoId: V2, title: "ASMR", startSeconds: 30, duration: 301, autoplay: "click" });
            expect(list.videos[1]).toMatchObject({ videoId: V3, title: "Trains", channel: "Me", startSeconds: 60 });
            expect(list.videos[0].thumbnail).toBe(`https://i.ytimg.com/vi/${V2}/mqdefault.jpg`);
        });

        it("liste de vidéos : sans infos → vidéos aux champs vides ; moins d'infos que d'ids", () => {
            const list = yt.parseDefinition({ url: `https://www.youtube.com/watch_videos?video_ids=${V2},${V3}`, target: "p", videos: [{ title: "A" }] });
            expect(list.videos.map((v) => v.title)).toEqual(["A", ""]);
        });

        it("liste de vidéos : index de l'URL prime sur celui de la définition", () => {
            const base = `https://www.youtube.com/watch_videos?video_ids=${V2},${V3}`;
            expect(yt.parseDefinition({ url: base, target: "p", index: 1 }).index).toBe(1);
            expect(yt.parseDefinition({ url: `${base}&index=0`, target: "p", index: 1 }).index).toBe(0);
        });

        it("playlist : vidéo de départ, infos des vidéos", () => {
            const pl = yt.parseDefinition({
                url: `https://www.youtube.com/watch?v=${V5}&list=${PL}`, target: "p", channel: "ReTime Clips",
                videos: [{ videoId: V4, title: "V1" }, { videoId: V5, title: "V2", thumbnail: "https://t" }]
            });
            expect(pl).toBeInstanceOf(PlaylistInfo);
            expect(pl).toMatchObject({ playlistId: PL, videoId: V5, key: `youtube:playlist:${PL}` });
            expect(pl.videos.map((v) => v.videoId)).toEqual([V4, V5]);
            expect(pl.videos[0].thumbnail).toBe(`https://i.ytimg.com/vi/${V4}/mqdefault.jpg`);
            expect(pl.videos[1].thumbnail).toBe("https://t");
        });

        it("playlist : sans videos → vide ; sans videoId → id de remplacement et pas de miniature", () => {
            const url2 = `https://www.youtube.com/watch?list=${PL}`;
            expect(yt.parseDefinition({ url: url2, target: "p" }).videos).toEqual([]);
            const pl = yt.parseDefinition({ url: url2, target: "p", videos: [{ title: "Sans id" }] });
            expect(pl.videos[0].videoId).toBe(`${PL}#0`);
            expect(pl.videos[0].thumbnail).toBe("");
            expect(pl.videoId).toBeNull();
        });

        it("videos doit être un tableau ; url invalide → erreur", () => {
            expect(() => yt.parseDefinition({ url, target: "p", videos: "nope" })).toThrow(/videos must be an array/);
            expect(() => yt.parseDefinition({ url: "nope", target: "p" })).toThrow(/Invalid URL/);
        });
    });

    // ───────── parseFromLink ─────────
    describe("parseFromLink", () => {
        it("lit les data-* du lien", () => {
            const a = link(`https://www.youtube.com/watch?v=${V1}`, {
                target: "player", key: "maldives", title: "Maldives", description: "D", channel: "MyTranquilitee",
                "channel-url": "https://www.youtube.com/@MyTranquilitee", thumbnail: "https://t", duration: "6h6m46s",
                start: "1h20m3s", autoplay: "click", "show-on-init": "", extra: "info libre"
            });
            const info = yt.parseFromLink(a);
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({
                target: "player", key: "maldives", title: "Maldives", channel: "MyTranquilitee",
                channelUrl: "https://www.youtube.com/@MyTranquilitee", duration: 22006, startSeconds: 4803,
                autoplay: "click", showOnInit: true, extra: "info libre"
            });
            expect(info.source).toMatchObject({ kind: "link", element: a });
        });

        it("sans showOnInit ni autoplay : false / 'none'", () => {
            const info = yt.parseFromLink(link(`https://www.youtube.com/watch?v=${V1}`, { target: "p" }));
            expect(info.showOnInit).toBe(false);
            expect(info.autoplay).toBe("none");
        });

        it("data-videos pour une liste", () => {
            const a = link(`https://www.youtube.com/watch_videos?video_ids=${V2},${V3}`, {
                target: "p", videos: '[{"title":"ASMR","start":"30"},{"title":"Trains","start":"1m"}]'
            });
            const list = yt.parseFromLink(a);
            expect(list).toBeInstanceOf(VideoListInfo);
            expect(list.videos.map((v) => [v.title, v.startSeconds])).toEqual([["ASMR", 30], ["Trains", 60]]);
        });

        it("data-index sert d'index pour une liste", () => {
            const a = link(`https://www.youtube.com/watch_videos?video_ids=${V2},${V3}`, { target: "p", index: "1" });
            expect(yt.parseFromLink(a).index).toBe(1);
        });

        it("data-videos pour une playlist (videoId)", () => {
            const a = link(`https://www.youtube.com/watch?v=${V5}&list=${PL}`, {
                target: "p", videos: `[{"videoId":"${V4}","title":"A"},{"videoId":"${V5}","title":"B"}]`
            });
            const pl = yt.parseFromLink(a);
            expect(pl).toBeInstanceOf(PlaylistInfo);
            expect(pl.videos.map((v) => v.videoId)).toEqual([V4, V5]);
        });

        it("erreurs : pas de target, pas d'URL, JSON invalide", () => {
            expect(() => yt.parseFromLink(link(`https://www.youtube.com/watch?v=${V1}`))).toThrow(/target/);
            expect(() => yt.parseFromLink(link(null, { target: "p" }))).toThrow(/No URL found/);
            expect(() => yt.parseFromLink(link(`https://www.youtube.com/watch?v=${V1}`, { target: "p", videos: "{nope" })))
                .toThrow(/Invalid JSON in data-videos/);
        });

        it("accepte un élément quelconque avec data-url", () => {
            const div = document.createElement("div");
            div.dataset.url = `https://www.youtube.com/watch?v=${V1}`;
            div.dataset.target = "p";
            expect(yt.parseFromLink(div).videoId).toBe(V1);
        });
    });

    // ───────── buildUrl ─────────
    describe("buildUrl", () => {
        const parse = (s) => { const u = new URL(s); return { path: u.pathname, q: Object.fromEntries(u.searchParams) }; };

        it("vidéo seule (avec start → t)", () => {
            expect(parse(yt.buildUrl({ videoId: V1 }))).toEqual({ path: "/watch", q: { v: V1 } });
            expect(parse(yt.buildUrl({ videoId: V1, start: 90 })).q).toEqual({ v: V1, t: "90" });
        });
        it("liste de vidéos (avec index)", () => {
            expect(parse(yt.buildUrl({ videoIds: [V2, V3] }))).toEqual({ path: "/watch_videos", q: { video_ids: `${V2},${V3}` } });
            expect(parse(yt.buildUrl({ videoIds: [V2, V3], index: 1 })).q.index).toBe("1");
        });
        it("playlist (avec ou sans vidéo de départ)", () => {
            expect(parse(yt.buildUrl({ playlistId: PL })).q).toEqual({ list: PL });
            expect(parse(yt.buildUrl({ playlistId: PL, videoId: V4 })).q).toEqual({ list: PL, v: V4 });
        });
        it("playlistId prime, puis videoIds, puis videoId", () => {
            expect(parse(yt.buildUrl({ playlistId: PL, videoIds: [V2], videoId: V1 })).q.list).toBe(PL);
            expect(parse(yt.buildUrl({ videoIds: [V2], videoId: V1 })).path).toBe("/watch_videos");
        });
        it("erreurs", () => {
            expect(() => yt.buildUrl()).toThrow(TypeError);
            expect(() => yt.buildUrl({})).toThrow(/need playlistId, videoIds, or videoId/);
        });
        it("l'URL construite est relue par parseUrl", () => {
            expect(yt.parseUrl(yt.buildUrl({ videoIds: [V2, V3], index: 1 }))).toMatchObject({ kind: "videoList", videoIds: [V2, V3], index: 1 });
        });
    });
});

// ═════════════════════════ OK.ru ═════════════════════════
describe("OkruInfoParser", () => {
    const ok = new OkruInfoParser();
    const ID1 = "17192094206594", ID2 = "17222095800962", ID3 = "17659571866242";

    // ───────── parseUrl ─────────
    describe("parseUrl", () => {
        it("/video/ID et /videoembed/ID : vidéo seule", () => {
            expect(ok.parseUrl(`https://ok.ru/video/${ID2}`)).toMatchObject({ kind: "video", videoId: ID2 });
            expect(ok.parseUrl(`https://ok.ru/videoembed/${ID2}`)).toMatchObject({ kind: "video", videoId: ID2 });
        });

        it("URL invalide ou chemin inconnu → null (pas d'exception)", () => {
            expect(ok.parseUrl("pas une url")).toBeNull();
            expect(ok.parseUrl("https://ok.ru/profile/910108373634")).toBeNull();
            expect(ok.parseUrl("https://ok.ru/video/abc")).toBeNull();
        });

        it("video_ids : liste (le chemin n'a pas d'importance)", () => {
            const u = ok.parseUrl(`https://ok.ru/video?video_ids=${ID1},${ID2},${ID3}`);
            expect(u).toMatchObject({ kind: "videoList", videoIds: [ID1, ID2, ID3], labels: [] });
            expect(u.index).toBeNull();
            expect(ok.parseUrl(`https://ok.ru/video/${ID1}?video_ids=${ID1},${ID2}`).videoIds).toEqual([ID1, ID2]);
        });

        it("video_ids : espaces retirés, vides ignorés, index lu", () => {
            expect(ok.parseUrl(`https://ok.ru/video?video_ids=${ID1}, ,${ID2}&index=1`))
                .toMatchObject({ videoIds: [ID1, ID2], index: 1 });
        });

        it("video_ids vide → null", () => {
            expect(ok.parseUrl("https://ok.ru/video?video_ids=")).toBeNull();
        });

        it("labels : on découpe AVANT de décoder (%2C = virgule dans un titre)", () => {
            const u = ok.parseUrl(`https://ok.ru/video/111?video_ids=111,222&labels=Titre%20A%2C%20suite,Titre%20B`);
            expect(u.labels).toEqual(["Titre A, suite", "Titre B"]);
        });

        it("labels : une étiquette vide reste à sa place (positionnel)", () => {
            expect(ok.parseUrl("https://ok.ru/video/111?video_ids=111,222,333&labels=A,,C").labels).toEqual(["A", "", "C"]);
        });

        it("ancienne version complète (Caverne de la Rose d'Or)", () => {
            const old = "https://ok.ru/video/3953767680692?video_ids=3953767680692,3953767877300&labels=La%20Caverne%20de%20la%20Rose%20d'Or%2C%20%C3%A9p.01%20-%20BluRay%20720p%20VF,La%20Caverne%20de%20la%20Rose%20d'Or%2C%20%C3%A9p.02%20-%20BluRay%20720p%20VF";
            const u = ok.parseUrl(old);
            expect(u.videoIds).toEqual(["3953767680692", "3953767877300"]);
            expect(u.labels).toEqual([
                "La Caverne de la Rose d'Or, ép.01 - BluRay 720p VF",
                "La Caverne de la Rose d'Or, ép.02 - BluRay 720p VF"
            ]);
        });

        it("encodage invalide dans un label : conservé tel quel", () => {
            expect(ok.parseUrl("https://ok.ru/video/1?video_ids=1&labels=100%").labels).toEqual(["100%"]);
        });
    });

    // ───────── parseSrc ─────────
    describe("parseSrc", () => {
        it("videoembed/ID", () => {
            const s = ok.parseSrc(`https://ok.ru/videoembed/${ID2}?autoplay=1`);
            expect(s).toBeInstanceOf(SrcInfo);
            expect(s).toMatchObject({ kind: "video", videoId: ID2, autoplay: true });
            expect(ok.parseSrc(`https://ok.ru/videoembed/${ID2}`).autoplay).toBeNull();
            expect(ok.parseSrc(`https://ok.ru/videoembed/${ID2}/`).videoId).toBe(ID2);
        });
        it("hôtes acceptés : www., m., odnoklassniki.ru", () => {
            for (const host of ["www.ok.ru", "m.ok.ru", "odnoklassniki.ru"]) {
                expect(ok.parseSrc(`https://${host}/videoembed/${ID2}`).videoId).toBe(ID2);
            }
        });
        it("erreurs : URL, hôte, chemin", () => {
            expect(() => ok.parseSrc("nope")).toThrow(/Invalid URL/);
            expect(() => ok.parseSrc(`https://youtube.com/videoembed/${ID2}`)).toThrow(/Invalid OK.ru embed host/);
            expect(() => ok.parseSrc(`https://ok.ru/video/${ID2}`)).toThrow(/Invalid OK.ru embed path/);
        });
    });

    // ───────── parseFromFrame ─────────
    describe("parseFromFrame", () => {
        it("vidéo adoptée : cible = id du parent", () => {
            const f = frameIn(`https://ok.ru/videoembed/${ID2}?autoplay=1`, "ok-host");
            const info = ok.parseFromFrame(f);
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({ provider: "okru", target: "ok-host", videoId: ID2, autoplay: "init" });
            expect(info.source).toMatchObject({ kind: "frame", element: f });
        });
        it("parent sans id : id généré", () => {
            expect(ok.parseFromFrame(frameIn(`https://ok.ru/videoembed/${ID2}`, null)).target).toMatch(/^host:/);
        });
        it("erreurs", () => {
            expect(() => ok.parseFromFrame(document.createElement("div"))).toThrow(/Expected an IFRAME/);
            expect(() => ok.parseFromFrame(frameIn("https://youtube.com/embed/x"))).toThrow(/Invalid OK.ru embed host/);
        });
    });

    // ───────── buildUrl ─────────
    describe("buildUrl", () => {
        it("vidéo seule", () => {
            expect(ok.buildUrl({ videoId: ID2 })).toBe(`https://ok.ru/video/${ID2}`);
        });
        it("liste (avec / sans index ; index 0 ignoré)", () => {
            expect(ok.buildUrl({ videoIds: [ID1, ID2] })).toBe(`https://ok.ru/video/${ID1}?video_ids=${ID1},${ID2}`);
            expect(ok.buildUrl({ videoIds: [ID1, ID2], index: 1 })).toBe(`https://ok.ru/video/${ID1}?video_ids=${ID1},${ID2}&index=1`);
            expect(ok.buildUrl({ videoIds: [ID1, ID2], index: 0 })).toBe(`https://ok.ru/video/${ID1}?video_ids=${ID1},${ID2}`);
        });
        it("erreurs", () => {
            expect(() => ok.buildUrl()).toThrow(TypeError);
            expect(() => ok.buildUrl({ playlistId: "x" })).toThrow(/playlists are not supported/);
            expect(() => ok.buildUrl({ videoIds: [] })).toThrow(/cannot be empty/);
            expect(() => ok.buildUrl({ videoIds: [null] })).toThrow(/first videoId/);
            expect(() => ok.buildUrl({})).toThrow(/videoId or a non-empty videoIds/);
        });
        it("l'URL construite est relue par parseUrl", () => {
            expect(ok.parseUrl(ok.buildUrl({ videoIds: [ID1, ID2], index: 1 }))).toMatchObject({ kind: "videoList", videoIds: [ID1, ID2], index: 1 });
        });
    });

    // ───────── parseDefinition ─────────
    describe("parseDefinition", () => {
        const url = `https://ok.ru/video/${ID2}`;

        it("vidéo : champs, start/duration en 1h2m3s", () => {
            const info = ok.parseDefinition({
                url, target: "p", key: "mg", title: "MacGyver", description: "D", channel: "Test channel",
                channelUrl: "https://ok.ru/profile/910108373634", thumbnail: "https://t", duration: "44m57s", start: "1m30s",
                autoplay: "click", showOnInit: true, extra: { a: 1 }
            });
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({
                provider: "okru", target: "p", videoId: ID2, key: "mg", title: "MacGyver", channel: "Test channel",
                thumbnail: "https://t", duration: 2697, startSeconds: 90, autoplay: "click", showOnInit: true
            });
        });

        it("vidéo : valeurs par défaut (pas de miniature par défaut chez OK.ru)", () => {
            const info = ok.parseDefinition({ url, target: "p" });
            expect(info).toMatchObject({ title: "", thumbnail: "", autoplay: "none", key: `okru:${ID2}` });
            expect(info.duration).toBeNull();
        });

        it("target obligatoire", () => {
            expect(() => ok.parseDefinition({ url })).toThrow(/target/);
        });

        it("source : link / definition", () => {
            const a = link(url);
            expect(ok.parseDefinition({ url, target: "p" }, a).source).toMatchObject({ kind: "link", element: a });
            expect(ok.parseDefinition({ url, target: "p" }).source.kind).toBe("definition");
        });

        it("liste : titres pris dans les labels de l'URL", () => {
            const list = ok.parseDefinition({ url: "https://ok.ru/video/111?video_ids=111,222&labels=Titre%20A%2C%20suite,Titre%20B", target: "p" });
            expect(list).toBeInstanceOf(VideoListInfo);
            expect(list.videos.map((v) => v.title)).toEqual(["Titre A, suite", "Titre B"]);
        });

        it("liste : def.videos prime sur les labels", () => {
            const list = ok.parseDefinition({
                url: "https://ok.ru/video/111?video_ids=111,222&labels=L1,L2", target: "p",
                videos: [{ title: "X", duration: "10s", start: "5" }, { title: "Y" }]
            });
            expect(list.videos.map((v) => v.title)).toEqual(["X", "Y"]);
            expect(list.videos[0]).toMatchObject({ duration: 10, startSeconds: 5 });
        });

        it("liste : moins de videos que d'ids → champs vides", () => {
            const list = ok.parseDefinition({ url: `https://ok.ru/video?video_ids=${ID1},${ID2}`, target: "p", videos: [{ title: "A" }] });
            expect(list.videos.map((v) => v.title)).toEqual(["A", ""]);
        });

        it("liste : avertit si labels et ids ne correspondent pas en nombre", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const list = ok.parseDefinition({ url: "https://ok.ru/video/111?video_ids=111,222&labels=Seul", target: "p" });
            expect(warn).toHaveBeenCalledOnce();
            expect(list.videos.map((v) => v.title)).toEqual(["Seul", ""]);
        });

        it("liste : pas d'avertissement quand tout correspond", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            ok.parseDefinition({ url: "https://ok.ru/video/111?video_ids=111,222&labels=A,B", target: "p" });
            expect(warn).not.toHaveBeenCalled();
        });

        it("liste : index (URL prime), autoplay hérité par les vidéos, key", () => {
            const base = `https://ok.ru/video?video_ids=${ID1},${ID2}`;
            expect(ok.parseDefinition({ url: base, target: "p", index: 1 }).index).toBe(1);
            expect(ok.parseDefinition({ url: `${base}&index=0`, target: "p", index: 1 }).index).toBe(0);
            const list = ok.parseDefinition({ url: base, target: "p", autoplay: "click", key: "k" });
            expect(list.key).toBe("k");
            expect(list.videos.every((v) => v.autoplay === "click")).toBe(true);
        });

        it("erreurs : URL non reconnue, videos non tableau", () => {
            expect(() => ok.parseDefinition({ url: "https://ok.ru/profile/1", target: "p" })).toThrow(/Invalid URL/);
            expect(() => ok.parseDefinition({ url, target: "p", videos: "nope" })).toThrow(/videos must be an array/);
        });
    });

    // ───────── parseFromLink ─────────
    describe("parseFromLink", () => {
        it("vidéo seule avec infos", () => {
            const a = link(url(ID2), {
                target: "player", title: "MacGyver S03E08 VF | Accident en Haute Montagne", channel: "Test channel",
                "channel-url": "https://ok.ru/profile/910108373634", duration: "44m57s", extra: "info libre"
            });
            const info = ok.parseFromLink(a);
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({
                provider: "okru", target: "player", videoId: ID2, title: "MacGyver S03E08 VF | Accident en Haute Montagne",
                channel: "Test channel", duration: 2697, extra: "info libre"
            });
            expect(info.source).toMatchObject({ kind: "link", element: a });
        });

        it("vidéo seule : autoplay et start", () => {
            const info = ok.parseFromLink(link(url(ID2), { target: "p", autoplay: "click", start: "1m30s" }));
            expect(info).toMatchObject({ autoplay: "click", startSeconds: 90 });
        });

        it("liste avec video_ids + data-videos", () => {
            const a = link(`https://ok.ru/video?video_ids=${ID1},${ID2},${ID3}`, {
                target: "p", videos: '[{"title":"E02"},{"title":"E08"},{"title":"E15"}]'
            });
            const list = ok.parseFromLink(a);
            expect(list).toBeInstanceOf(VideoListInfo);
            expect(list.videos.map((v) => v.title)).toEqual(["E02", "E08", "E15"]);
        });

        it("ancienne version : labels dans l'URL", () => {
            const list = ok.parseFromLink(link("https://ok.ru/video/111?video_ids=111,222&labels=A,B", { target: "p" }));
            expect(list.videos.map((v) => v.title)).toEqual(["A", "B"]);
        });

        it("erreurs : pas de target, pas d'URL", () => {
            expect(() => ok.parseFromLink(link(url(ID2)))).toThrow(/target/);
            expect(() => ok.parseFromLink(link(null, { target: "p" }))).toThrow(/No URL found/);
        });

        function url(id) { return `https://ok.ru/video/${id}`; }
    });
});
