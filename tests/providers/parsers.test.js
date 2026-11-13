import {afterEach, describe, expect, it, vi} from "vitest";
import {YouTubeInfoParser} from "../../src/providers/youtube/YouTubeInfoParser.js";
import {OkruInfoParser} from "../../src/providers/okru/OkruInfoParser.js";
import {InfoParser} from "../../src/providers/InfoParser.js";
import {VideoInfo} from "../../src/models/VideoInfo.js";
import {VideoListInfo} from "../../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../../src/models/PlaylistInfo.js";
import {SrcInfo, UrlInfo} from "../../src/models/UrlInfo.js";
import {AUTOPLAY_MODES} from "../../src/utils/helpers.js";

// ───────────────────────── outils ─────────────────────────
// Pas de DOM nécessaire : de simples objets suffisent à simuler les éléments.

const V1 = "3HSKp9pVMKY";
const V2 = "m_luzarfbbM";
const V3 = "p8yXdbwFNgc";

const lien = (href, dataset = {}) => ({tagName: "A", href, dataset});
const iframe = (src, parentElement = {id: "player"}) => ({tagName: "IFRAME", src, parentElement, dataset: {}});
const expectSource = (info, url, element = undefined) => {
    expect(info.source).toEqual(expect.objectContaining({
        url,
        ...(element !== undefined ? { element } : {})
    }));
};

// Les BUG ci-dessous sont écrits avec `it` : le test décrit le comportement CORRECT et
// « échoue » tant que le bug existe (la suite reste verte). Une fois le bug corrigé, vitest
// indiquera que le test passe : remplacer alors `it` par `it`.

// ═════════════════════ InfoParser (classe de base) ═════════════════════

describe("InfoParser (base)", () => {
    const parser = new YouTubeInfoParser(); // n'importe quelle sous-classe donne accès aux méthodes communes

    describe("getValidUrl", () => {
        it("retourne une URL pour une adresse valide, en ignorant les espaces autour", () => {
            const u = parser.getValidUrl("  https://example.com/a?b=1  ");
            expect(u).toBeInstanceOf(URL);
            expect(u.hostname).toBe("example.com");
        });
        it("retourne null pour une adresse invalide", () => {
            expect(parser.getValidUrl("pas une url")).toBeNull();
            expect(parser.getValidUrl(undefined)).toBeNull();
        });
    });

    describe("getUrl", () => {
        it("lit href d'un lien, src d'une iframe, data-url sinon", () => {
            expect(parser.getUrl({tagName: "A", href: "https://a"})).toBe("https://a");
            expect(parser.getUrl({tagName: "IFRAME", src: "https://i"})).toBe("https://i");
            expect(parser.getUrl({tagName: "SPAN", dataset: {url: "https://d"}})).toBe("https://d");
            expect(parser.getUrl({tagName: "SPAN"})).toBeUndefined();
        });
    });

    describe("parseJsonAttribute", () => {
        it("absent => undefined", () => {
            expect(parser.parseJsonAttribute(undefined, "data-videos")).toBeUndefined();
        });
        it("tableau JSON valide", () => {
            expect(parser.parseJsonAttribute('[{"title":"a"}]', "data-videos")).toEqual([{title: "a"}]);
        });
        it("JSON invalide => erreur qui nomme l'attribut", () => {
            expect(() => parser.parseJsonAttribute("[oups", "data-videos")).toThrow(/Invalid JSON in data-videos/);
        });
        it("JSON valide mais pas un tableau => erreur", () => {
            expect(() => parser.parseJsonAttribute('{"a":1}', "data-videos")).toThrow(/must be a JSON array/);
        });
    });

    describe("readLinkData", () => {
        it("recopie les attributs data-* et convertit index / showOnInit / videos", () => {
            const data = parser.readLinkData({
                tagName: "A",
                dataset: {
                    autoplay: "click", start: "1m", title: "T", description: "D", channel: "C",
                    channelUrl: "U", thumbnail: "I", duration: "2m", index: "3", showOnInit: "",
                    key: "k", extra: "x", target: "player", videos: '[{"title":"a"}]'
                }
            });
            expect(data).toMatchObject({
                autoplay: "click", start: "1m", title: "T", index: 3, showOnInit: true,
                key: "k", extra: "x", target: "player", videos: [{title: "a"}], duration: "2m"
            });
        });

        it("valeurs par défaut : videos = [], showOnInit = false, index non défini", () => {
            const data = parser.readLinkData({tagName: "A", dataset: {}});
            expect(data.videos).toEqual([]);
            expect(data.showOnInit).toBe(false);
            expect(data.index).toBeUndefined();
        });

        it("pour une iframe sans data-target, la cible est l'id du parent", () => {
            const data = parser.readLinkData({tagName: "IFRAME", dataset: {}, parentElement: {id: "zone"}});
            expect(data.target).toBe("zone");
        });
    });

    describe("méthodes abstraites", () => {
        const base = new InfoParser();
        it.each(["parseUrl", "parseSrc", "buildUrl", "parseFromFrame", "parseDefinition"])(
            "%s() doit être implémentée par la sous-classe", (m) => {
                expect(() => base[m]({})).toThrow(/must be implemented/);
            });
    });

    describe("parseFromLink", () => {
        it("lève une erreur quand l'élément n'a aucune URL", () => {
            expect(() => parser.parseFromLink({tagName: "SPAN", dataset: {}})).toThrow(/No URL found/);
        });

        it("délègue à parseDefinition avec l'url et les données du lien", () => {
            class Espion extends InfoParser {
                parseDefinition(def) {
                    return def;
                }
            }
            const def = new Espion().parseFromLink(lien("https://x/y", {title: "T", target: "p"}));
            expect(def).toMatchObject({url: "https://x/y", title: "T", target: "p", videos: []});
        });
    });
});

// ═════════════════════ YouTubeInfoParser ═════════════════════

describe("YouTubeInfoParser", () => {
    const miniature = {getThumbnailUrl: (id) => `miniature:${id}`};
    const parser = new YouTubeInfoParser({thumbnailUrlBuilder: miniature});

    describe("isValidVideoId", () => {
        it("accepte exactement 11 caractères [A-Za-z0-9_-]", () => {
            expect(parser.isValidVideoId(V1)).toBe(true);
            expect(parser.isValidVideoId(V2)).toBe(true);
        });
        it("refuse le reste", () => {
            for (const v of ["", "court", "troplongtroplong", "caractère!!", null, undefined, 12345678901])
                expect(parser.isValidVideoId(v)).toBe(false);
        });
    });

    describe("parseUrl", () => {
        it("youtu.be/ID => vidéo", () => {
            const info = parser.parseUrl(`https://youtu.be/${V1}`);
            expect(info).toBeInstanceOf(UrlInfo);
            expect(info).toMatchObject({kind: "video", videoId: V1, playlistId: null, startSeconds: null});
        });

        it("youtu.be/ID?t=1m30s => temps de départ en secondes", () => {
            expect(parser.parseUrl(`https://youtu.be/${V1}?t=1m30s`).startSeconds).toBe(90);
        });

        it("youtu.be/ID?list=PL => playlist", () => {
            expect(parser.parseUrl(`https://youtu.be/${V1}?list=PL1`)).toMatchObject({
                kind: "playlist", videoId: V1, playlistId: "PL1"
            });
        });

        it("youtu.be avec un id invalide => erreur", () => {
            expect(() => parser.parseUrl("https://youtu.be/abc")).toThrow(/Invalid video ID/);
        });

        it("watch?v=ID => vidéo (avec www., m. ou sans)", () => {
            for (const hote of ["www.youtube.com", "youtube.com", "m.youtube.com"]) {
                expect(parser.parseUrl(`https://${hote}/watch?v=${V1}`)).toMatchObject({kind: "video", videoId: V1});
            }
        });

        it("watch?v=ID&t=90 => startSeconds", () => {
            expect(parser.parseUrl(`https://www.youtube.com/watch?v=${V1}&t=90`).startSeconds).toBe(90);
        });

        it("watch?v=ID&list=PL&index=2 => playlist avec la vidéo de départ et l'index", () => {
            expect(parser.parseUrl(`https://www.youtube.com/watch?v=${V1}&list=PL1&index=2`)).toMatchObject({
                kind: "playlist", videoId: V1, playlistId: "PL1", index: 2
            });
        });

        it("watch?list=PL (sans v) => playlist sans vidéo de départ", () => {
            expect(parser.parseUrl("https://www.youtube.com/watch?list=PL1")).toMatchObject({
                kind: "playlist", videoId: null, playlistId: "PL1", index: null
            });
        });

        it("watch sans v ni list => erreur", () => {
            expect(() => parser.parseUrl("https://www.youtube.com/watch")).toThrow(/Missing video ID or playlist/);
        });

        it("watch avec un v invalide => erreur", () => {
            expect(() => parser.parseUrl("https://www.youtube.com/watch?v=trop-court")).toThrow(/Invalid video ID/);
        });

        it("watch_videos => liste de vidéos, ids invalides ignorés", () => {
            const info = parser.parseUrl(`https://www.youtube.com/watch_videos?video_ids=${V1},nope,${V2}&index=1`);
            expect(info).toMatchObject({kind: "videoList", videoIds: [V1, V2], videoId: V1, index: 1});
        });

        it("watch_videos sans video_ids, ou sans id valide => erreur", () => {
            expect(() => parser.parseUrl("https://www.youtube.com/watch_videos")).toThrow(/Missing video_ids/);
            expect(() => parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=a,b")).toThrow(/No valid video IDs/);
        });

        it("garde l'URL d'origine dans source", () => {
            const url = `https://youtu.be/${V1}`;
            expect(parser.parseUrl(url).source).toBe(url);
        });

        it("URL invalide, autre site ou chemin non géré => erreur", () => {
            expect(() => parser.parseUrl("pas une url")).toThrow(/Invalid URL/);
            expect(() => parser.parseUrl("https://vimeo.com/123")).toThrow(/Unsupported YouTube URL/);
            expect(() => parser.parseUrl("https://www.youtube.com/playlist?list=PL1")).toThrow(/Unsupported YouTube URL/);
            expect(() => parser.parseUrl(`https://www.youtube.com/shorts/${V1}`)).toThrow(/Unsupported YouTube URL/);
        });

        it("refuse un faux domaine qui se termine par « youtube.com » (evilyoutube.com)", () => {
            expect(() => parser.parseUrl(`https://evilyoutube.com/watch?v=${V1}`)).toThrow();
        });
    });

    describe("parseSrc (adresse d'une iframe embed)", () => {
        it("embed/ID => vidéo", () => {
            const info = parser.parseSrc(`https://www.youtube.com/embed/${V1}`);
            expect(info).toBeInstanceOf(SrcInfo);
            expect(info).toMatchObject({
                kind: "video", videoId: V1, videoIds: null, playlistId: null,
                startSeconds: null, index: null, autoplay: null, mute: null
            });
        });

        it("lit start, autoplay, mute et index", () => {
            const info = parser.parseSrc(`https://www.youtube.com/embed/${V1}?start=30&autoplay=1&mute=0&index=2`);
            expect(info).toMatchObject({startSeconds: 30, autoplay: true, mute: false, index: 2});
        });

        it("embed/ID?playlist=a,b,c => liste de vidéos, la première est dans le chemin", () => {
            expect(parser.parseSrc(`https://www.youtube.com/embed/${V1}?playlist=${V1},${V2},${V3}&index=2`)).toMatchObject({
                kind: "videoList", videoId: V1, videoIds: [V1, V2, V3], index: 2
            });
        });

        it("embed/?playlist=... (sans id dans le chemin) => liste sans videoId", () => {
            expect(parser.parseSrc(`https://www.youtube.com/embed/?playlist=${V1},${V2}`)).toMatchObject({
                kind: "videoList", videoId: null, videoIds: [V1, V2]
            });
        });

        it("ignore les ids invalides de playlist", () => {
            expect(parser.parseSrc(`https://www.youtube.com/embed/?playlist=${V1},zzz,${V3}`).videoIds).toEqual([V1, V3]);
        });

        it("embed/videoseries?list=PL => playlist sans videoId", () => {
            expect(parser.parseSrc("https://www.youtube.com/embed/videoseries?list=PL1")).toMatchObject({
                kind: "playlist", videoId: null, playlistId: "PL1"
            });
        });

        it("embed/ID?list=PL => playlist avec videoId", () => {
            expect(parser.parseSrc(`https://www.youtube.com/embed/${V1}?list=PL1`)).toMatchObject({
                kind: "playlist", videoId: V1, playlistId: "PL1"
            });
        });

        it("accepte youtube-nocookie.com, avec ou sans www.", () => {
            for (const hote of ["www.youtube-nocookie.com", "youtube-nocookie.com"])
                expect(parser.parseSrc(`https://${hote}/embed/${V1}`).videoId).toBe(V1);
        });

        it("garde l'adresse d'origine dans source", () => {
            const src = `https://www.youtube.com/embed/${V1}`;
            expect(parser.parseSrc(src).source).toBe(src);
        });

        it("erreurs : URL invalide, hôte inconnu, chemin non embed, embed vide", () => {
            expect(() => parser.parseSrc("nope")).toThrow(/Invalid URL/);
            expect(() => parser.parseSrc(`https://vimeo.com/embed/${V1}`)).toThrow(/Invalid embed host/);
            expect(() => parser.parseSrc(`https://www.youtube.com/watch?v=${V1}`)).toThrow(/Invalid embed URL/);
            expect(() => parser.parseSrc("https://www.youtube.com/embed/")).toThrow(/Invalid embed URL/);
            expect(() => parser.parseSrc("https://www.youtube.com/embed/trop-court")).toThrow(/Invalid embed URL/);
        });

        it("refuse un faux domaine qui se termine par « youtube.com »", () => {
            expect(() => parser.parseSrc(`https://evilyoutube.com/embed/${V1}`)).toThrow();
        });
    });

    describe("parseFromFrame", () => {
        it("refuse un élément qui n'est pas une iframe", () => {
            expect(() => parser.parseFromFrame({tagName: "DIV"})).toThrow(/Expected an IFRAME element, but received: <div>/);
        });

        it("refuse une iframe dont l'adresse n'est pas un embed YouTube", () => {
            expect(() => parser.parseFromFrame(iframe("https://vimeo.com/x"))).toThrow(/Invalid embed host/);
        });

        it("refuse une iframe sans parent", () => {
            expect(() => parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${V1}`, null))).toThrow(/no parent element/);
        });

        it("vidéo seule => VideoInfo YouTube dont la cible est l'id du parent", () => {
            const frame = iframe(`https://www.youtube.com/embed/${V1}?start=30&autoplay=1`, {id: "zone"});
            const info = parser.parseFromFrame(frame);

            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({
                provider: "youtube",
                target: "zone",
                videoId: V1,
                autoplay: AUTOPLAY_MODES.INIT,
                startSeconds: 30
            });
            expect(info.source.url).toContain(`/embed/${V1}`);
            expect(info.source.element).toBe(frame);   // si tu le renseignes
        });

        it("autoplay absent ou à 0 => NONE", () => {
            expect(parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${V1}`)).autoplay).toBe(AUTOPLAY_MODES.NONE);
            expect(parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${V1}?autoplay=0`)).autoplay).toBe(AUTOPLAY_MODES.NONE);
        });

        it("donne un id au parent quand il n'en a pas (effet de bord), et le garde sinon", () => {
            const sansId = {id: ""};
            const info = parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${V1}`, sansId));
            expect(sansId.id).toMatch(/^host:/);
            expect(info.target).toBe(sansId.id);

            const avecId = {id: "existant"};
            parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${V1}`, avecId));
            expect(avecId.id).toBe("existant");
        });
        it("iframe avec ?playlist=a,b,c => VideoListInfo (et non undefined)", () => {
            const info = parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${V1}?playlist=${V1},${V2},${V3}`));
            expect(info).toBeInstanceOf(VideoListInfo);
            expect(info.videoIds).toEqual([V1, V2, V3]);
        });

        it("iframe avec ?list=PL => PlaylistInfo (et non undefined)", () => {
            const info = parser.parseFromFrame(iframe("https://www.youtube.com/embed/videoseries?list=PL1"));
            expect(info).toBeInstanceOf(PlaylistInfo);
            expect(info.playlistId).toBe("PL1");
        });
    });

    describe("parseDefinition", () => {
        const def = (url, extra = {}) => ({url, target: "player", ...extra});

        it("vidéo : copie les métadonnées et la miniature par défaut", () => {
            const url = `https://www.youtube.com/watch?v=${V1}`;
            const info = parser.parseDefinition(def(url, {
                autoplay: "click", start: "1m", title: "T", description: "D", channel: "C",
                channelUrl: "U", duration: "2m", showOnInit: true, key: "k", extra: "x"
            }));

            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({
                provider: "youtube",
                target: "player",
                videoId: V1,
                autoplay: AUTOPLAY_MODES.CLICK,
                startSeconds: 60,
                title: "T",
                description: "D",
                channel: "C",
                channelUrl: "U",
                duration: 120,
                thumbnail: `miniature:${V1}`,
                showOnInit: true,
                key: "k",
                extra: "x",
                source: expect.objectContaining({ url })
            });
        });

        it("vidéo : valeurs par défaut (textes vides, pas d'autoplay) et clé calculée", () => {
            const info = parser.parseDefinition(def(`https://youtu.be/${V1}`));
            expect(info).toMatchObject({title: "", description: "", channel: "", autoplay: AUTOPLAY_MODES.NONE});
            expect(info.key).toBe(`youtube:${V1}`);
        });

        it("vidéo : le temps de départ du lien sert quand def.start est absent, et def.start a priorité", () => {
            expect(parser.parseDefinition(def(`https://www.youtube.com/watch?v=${V1}&t=45`)).startSeconds).toBe(45);
            expect(parser.parseDefinition(def(`https://www.youtube.com/watch?v=${V1}&t=45`, {start: "10"})).startSeconds).toBe(10);
        });

        it("vidéo : def.thumbnail remplace la miniature calculée", () => {
            expect(parser.parseDefinition(def(`https://youtu.be/${V1}`, {thumbnail: "mienne.jpg"})).thumbnail).toBe("mienne.jpg");
        });

        it("liste de vidéos : une vidéo par id, métadonnées prises dans def.videos", () => {
            const url = `https://www.youtube.com/watch_videos?video_ids=${V1},${V2}`;
            const liste = parser.parseDefinition(def(url, {
                autoplay: "click",
                videos: [{title: "Un", start: "10"}, {title: "Deux", thumbnail: "d.jpg"}]
            }));
            expect(liste).toBeInstanceOf(VideoListInfo);
            expect(liste.videoIds).toEqual([V1, V2]);
            expect(liste.key).toBe(`youtube:list:${V1},${V2}`);
            expect(liste.videos.map((v) => v.title)).toEqual(["Un", "Deux"]);
            expect(liste.videos[0]).toMatchObject({startSeconds: 10, thumbnail: `miniature:${V1}`});
            expect(liste.videos[1].thumbnail).toBe("d.jpg");
        });

        it("liste de vidéos : chaque vidéo reprend l'autoplay du lien, sauf si elle a le sien", () => {
            const url = `https://www.youtube.com/watch_videos?video_ids=${V1},${V2}`;
            const liste = parser.parseDefinition(def(url, {autoplay: "click", videos: [{}, {autoplay: "true"}]}));
            expect(liste.videos.map((v) => v.autoplay)).toEqual([AUTOPLAY_MODES.CLICK, AUTOPLAY_MODES.INIT]);
        });

        it("liste de vidéos : l'index de l'URL prime sur def.index", () => {
            const url = `https://www.youtube.com/watch_videos?video_ids=${V1},${V2}`;
            expect(parser.parseDefinition(def(`${url}&index=1`, {index: 5})).index).toBe(1);
            expect(parser.parseDefinition(def(url, {index: 5})).index).toBe(5);
        });

        it("liste de vidéos : sans def.videos, les vidéos existent quand même (métadonnées vides)", () => {
            const liste = parser.parseDefinition(def(`https://www.youtube.com/watch_videos?video_ids=${V1},${V2}`));
            expect(liste.videos).toHaveLength(2);
            expect(liste.videos[0].title).toBe("");
        });

        it("playlist : id de playlist et vidéo de départ", () => {
            const playlist = parser.parseDefinition(def(`https://www.youtube.com/watch?list=PL1&v=${V1}`));
            expect(playlist).toBeInstanceOf(PlaylistInfo);
            expect(playlist).toMatchObject({playlistId: "PL1", videoId: V1, target: "player"});
            expect(playlist.key).toBe("youtube:playlist:PL1");
            expect(playlist.videos).toHaveLength(0);
        });

        it("playlist : les vidéos de def.videos sont ajoutées avec leur miniature", () => {
            const playlist = parser.parseDefinition(def("https://www.youtube.com/watch?list=PL1", {
                videos: [{videoId: V2, title: "Deux"}, {videoId: V3, thumbnail: "t.jpg"}]
            }));
            expect(playlist.videos.map((v) => v.videoId)).toEqual([V2, V3]);
            expect(playlist.videos[0].thumbnail).toBe(`miniature:${V2}`);
            expect(playlist.videos[1].thumbnail).toBe("t.jpg");
        });

        it("playlist : une vidéo sans videoId est refusée", () => {
            expect(() => parser.parseDefinition(def("https://www.youtube.com/watch?list=PL1", {videos: [{title: "sans id"}]}))).toThrow();
        });

        it("refuse un def.videos qui n'est pas un tableau, ou une URL invalide", () => {
            expect(() => parser.parseDefinition(def(`https://youtu.be/${V1}`, {videos: "x"}))).toThrow(/videos must be an array/);
            expect(() => parser.parseDefinition(def("nope"))).toThrow();
        });

        // `new VideoListInfo(..., def.key, urlInfos.source)` : le constructeur attend
        // (..., key, extra, source). L'URL arrive donc dans `extra`, `source` reste vide et
        // def.extra est perdu. Même chose pour PlaylistInfo (et pour OkruInfoParser).
        it("VideoListInfo.source contient l'URL d'origine", () => {
            const url = `https://www.youtube.com/watch_videos?video_ids=${V1},${V2}`;
            expect(parser.parseDefinition(def(url)).source.url).toBe(url);
        });

        it("VideoListInfo.extra reprend def.extra", () => {
            const url = `https://www.youtube.com/watch_videos?video_ids=${V1},${V2}`;
            expect(parser.parseDefinition(def(url, {extra: "mon extra"})).extra).toBe("mon extra");
        });

        it("PlaylistInfo.source contient l'URL d'origine", () => {
            const url = "https://www.youtube.com/watch?list=PL1";
            expect(parser.parseDefinition(def(url)).source.url).toBe(url);
        });

        it("PlaylistInfo.extra reprend def.extra", () => {
            expect(parser.parseDefinition(def("https://www.youtube.com/watch?list=PL1", {extra: "mon extra"})).extra).toBe("mon extra");
        });

        // l'autoplay du lien n'est pas conservé sur la liste / la playlist elle-même, seulement
        // sur les vidéos d'une liste. Or LinkPlayer lit `info.autoplay` : il vaut undefined, donc
        // l'autoplay au clic ou à l'init ne fonctionne jamais pour une liste ou une playlist.
        it("une liste de vidéos conserve l'autoplay du lien", () => {
            const url = `https://www.youtube.com/watch_videos?video_ids=${V1},${V2}`;
            expect(parser.parseDefinition(def(url, {autoplay: "true"})).autoplay).toBe(AUTOPLAY_MODES.INIT);
        });

        it("une playlist conserve l'autoplay du lien", () => {
            expect(parser.parseDefinition(def("https://www.youtube.com/watch?list=PL1", {autoplay: "true"})).autoplay).toBe(AUTOPLAY_MODES.INIT);
        });
    });

    describe("parseFromLink", () => {
        it("lien classique => VideoInfo construite à partir de l'URL et des data-*", () => {
            const el = lien(`https://youtu.be/${V1}`, {
                autoplay: "", start: "90", title: "T", target: "player"
            });
            const info = parser.parseFromLink(el);

            expect(info).toMatchObject({
                videoId: V1,
                autoplay: AUTOPLAY_MODES.INIT,
                startSeconds: 90,
                title: "T",
                target: "player"
            });
            expect(info.source.url).toBe(`https://youtu.be/${V1}`);
            expect(info.source.element).toBe(el);   // si tu le renseignes dans le parser
        });

        it("data-videos (JSON) fournit les métadonnées d'une liste", () => {
            const info = parser.parseFromLink(lien(`https://www.youtube.com/watch_videos?video_ids=${V1},${V2}`, {
                target: "player", videos: '[{"title":"Un"},{"title":"Deux"}]'
            }));
            expect(info.videos.map((v) => v.title)).toEqual(["Un", "Deux"]);
        });
    });

    describe("buildUrl", () => {
        it("vidéo seule, avec temps de départ", () => {
            expect(parser.buildUrl({videoId: V1, start: 30})).toBe(`https://www.youtube.com/watch?v=${V1}&t=30`);
        });
        it("playlist, avec ou sans vidéo de départ", () => {
            expect(parser.buildUrl({playlistId: "PL1"})).toBe("https://www.youtube.com/watch?list=PL1");
            expect(parser.buildUrl({playlistId: "PL1", videoId: V1})).toBe(`https://www.youtube.com/watch?list=PL1&v=${V1}`);
        });
        it("liste de vidéos, avec ou sans index (0 est un index valable)", () => {
            const base = "https://www.youtube.com/watch_videos?video_ids=";
            expect(parser.buildUrl({videoIds: [V1, V2]})).toBe(`${base}${V1}%2C${V2}`);
            expect(parser.buildUrl({videoIds: [V1], index: 0})).toBe(`${base}${V1}&index=0`);
        });
        it("la playlist prime sur la liste, qui prime sur la vidéo seule", () => {
            expect(parser.buildUrl({playlistId: "PL1", videoIds: [V1], videoId: V2})).toContain("list=PL1");
            expect(parser.buildUrl({videoIds: [V1], videoId: V2})).toContain("watch_videos");
        });
        it("erreurs : définition absente ou sans rien à construire", () => {
            expect(() => parser.buildUrl()).toThrow(TypeError);
            expect(() => parser.buildUrl({})).toThrow(/need playlistId, videoIds, or videoId/);
        });
    });

    it("construit par défaut sans options (vraie fabrique de miniatures)", () => {
        expect(() => new YouTubeInfoParser()).not.toThrow();
    });
});

// ═════════════════════ OkruInfoParser ═════════════════════

describe("OkruInfoParser", () => {
    const parser = new OkruInfoParser();
    const def = (url, extra = {}) => ({url, target: "player", ...extra});

    describe("parseUrl", () => {
        it("/video/ID et /videoembed/ID => vidéo", () => {
            expect(parser.parseUrl("https://ok.ru/video/123456")).toMatchObject({kind: "video", videoId: "123456"});
            expect(parser.parseUrl("https://ok.ru/videoembed/987")).toMatchObject({kind: "video", videoId: "987"});
        });

        it("garde l'URL d'origine dans source", () => {
            const url = "https://ok.ru/video/1";
            expect(parser.parseUrl(url).source).toBe(url);
        });

        it("?video_ids=1,2,3 => liste, avec index", () => {
            expect(parser.parseUrl("https://ok.ru/video?video_ids=1,2,3&index=1")).toMatchObject({
                kind: "videoList", videoIds: ["1", "2", "3"], index: 1
            });
        });

        it("décode les ids et retire les espaces", () => {
            expect(parser.parseUrl("https://ok.ru/video?video_ids=1,%202").videoIds).toEqual(["1", "2"]);
        });

        it("labels : on coupe AVANT de décoder (%2C est une virgule dans le titre)", () => {
            const info = parser.parseUrl("https://ok.ru/video?video_ids=1,2,3&labels=A,B%2C%20C,D");
            expect(info.labels).toEqual(["A", "B, C", "D"]);
        });

        it("labels : un titre vide garde sa place, et l'absence de labels donne []", () => {
            expect(parser.parseUrl("https://ok.ru/video?video_ids=1,2,3&labels=A,,C").labels).toEqual(["A", "", "C"]);
            expect(parser.parseUrl("https://ok.ru/video?video_ids=1,2").labels).toEqual([]);
        });

        it("séquence de pourcentage mal formée : conservée telle quelle", () => {
            expect(parser.parseUrl("https://ok.ru/video?video_ids=1,2&labels=100%,B").labels).toEqual(["100%", "B"]);
        });

        it("retourne null (et non une erreur) quand l'adresse est inutilisable", () => {
            expect(parser.parseUrl("pas une url")).toBeNull();
            expect(parser.parseUrl("https://ok.ru/video?video_ids=")).toBeNull();
            expect(parser.parseUrl("https://ok.ru/autre/123")).toBeNull();
            expect(parser.parseUrl("https://ok.ru/video/abc")).toBeNull();
        });
    });

    describe("parseSrc", () => {
        it("refuse une URL invalide, un hôte inconnu et un chemin non embed", () => {
            expect(() => parser.parseSrc("nope")).toThrow(/Invalid URL/);
            expect(() => parser.parseSrc("https://youtube.com/videoembed/123")).toThrow(/Invalid OK.ru embed host/);
            expect(() => parser.parseSrc("https://ok.ru/video/123")).toThrow(/Invalid OK.ru embed path/);
            expect(() => parser.parseSrc("https://ok.ru/videoembed/abc")).toThrow(/Invalid OK.ru embed path/);
        });

        // `SrcInfo` n'est pas importé dans OkruInfoParser.js (seul UrlInfo l'est) : toute
        // adresse valide provoque une ReferenceError. Corriger : import {SrcInfo, UrlInfo} from ...
        it("une adresse embed valide retourne une SrcInfo (ReferenceError : SrcInfo non importé)", () => {
            const info = parser.parseSrc("https://www.ok.ru/videoembed/123?autoplay=1");
            expect(info).toMatchObject({kind: "video", videoId: "123", autoplay: true});
        });
    });

    describe("parseFromFrame", () => {
        it("refuse un élément qui n'est pas une iframe", () => {
            expect(() => parser.parseFromFrame({tagName: "DIV"})).toThrow(/Expected an IFRAME element/);
        });

        it("refuse une iframe dont l'adresse n'est pas un embed OK.ru", () => {
            expect(() => parser.parseFromFrame(iframe("https://youtube.com/embed/x"))).toThrow(/Invalid OK.ru embed host/);
        });

        // Ces deux cas sont bloqués par le bug de SrcInfo ci-dessus (la ReferenceError survient avant).
        it("iframe OK.ru valide => VideoInfo okru", () => {
            const info = parser.parseFromFrame(iframe("https://ok.ru/videoembed/123?autoplay=1", {id: "zone"}));
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({provider: "okru", target: "zone", videoId: "123", autoplay: AUTOPLAY_MODES.INIT});
        });

        it("iframe OK.ru sans parent => erreur « no parent element »", () => {
            expect(() => parser.parseFromFrame(iframe("https://ok.ru/videoembed/123", null))).toThrow(/no parent element/);
        });
    });

    describe("parseDefinition", () => {
        afterEach(() => vi.restoreAllMocks());

        it("vidéo : copie les métadonnées, miniature vide par défaut", () => {
            const url = "https://ok.ru/video/123";
            const info = parser.parseDefinition(def(url, {
                autoplay: "click", start: "30", title: "T", description: "D", channel: "C",
                duration: "1m", showOnInit: true, key: "k"
            }));
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({
                provider: "okru", target: "player", videoId: "123", autoplay: AUTOPLAY_MODES.CLICK,
                startSeconds: 30, title: "T", description: "D", channel: "C", duration: 60,
                thumbnail: "", showOnInit: true, key: "k", source: expect.objectContaining({ url })
            });
        });

        it("refuse une URL inutilisable, et un def.videos qui n'est pas un tableau", () => {
            expect(() => parser.parseDefinition(def("https://ok.ru/autre"))).toThrow(/Invalid URL/);
            expect(() => parser.parseDefinition(def("https://ok.ru/video/1", {videos: "x"}))).toThrow(/videos must be an array/);
        });

        it("liste : les titres viennent de labels= quand def.videos est absent", () => {
            const liste = parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2&labels=Un,Deux"));
            expect(liste).toBeInstanceOf(VideoListInfo);
            expect(liste.videoIds).toEqual(["1", "2"]);
            expect(liste.videos.map((v) => v.title)).toEqual(["Un", "Deux"]);
            expect(liste.key).toBe("okru:list:1,2");
        });

        it("liste : def.videos prime sur labels=", () => {
            const liste = parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2&labels=Un,Deux", {
                videos: [{title: "A"}, {title: "B"}]
            }));
            expect(liste.videos.map((v) => v.title)).toEqual(["A", "B"]);
        });

        it("liste : moins de def.videos que d'ids => les vidéos manquantes ont des métadonnées vides", () => {
            const liste = parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2", {videos: [{title: "A"}]}));
            expect(liste.videos.map((v) => v.title)).toEqual(["A", ""]);
        });

        it("liste : avertit quand le nombre de labels ne correspond pas au nombre d'ids", () => {
            const avertir = vi.spyOn(console, "warn").mockImplementation(() => {});
            parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2,3&labels=Un,Deux"));
            expect(avertir).toHaveBeenCalledWith(expect.stringContaining("2 labels for 3 videos"));
        });

        it("liste : l'index de l'URL prime sur def.index", () => {
            expect(parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2&index=1", {index: 5})).index).toBe(1);
            expect(parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2", {index: 5})).index).toBe(5);
        });

        it("liste : chaque vidéo reprend l'autoplay du lien", () => {
            const liste = parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2", {autoplay: "click"}));
            expect(liste.videos.map((v) => v.autoplay)).toEqual([AUTOPLAY_MODES.CLICK, AUTOPLAY_MODES.CLICK]);
        });

        it("VideoListInfo.source contient l'URL d'origine (elle arrive dans `extra`)", () => {
            const url = "https://ok.ru/video?video_ids=1,2";
            expect(parser.parseDefinition(def(url)).source.url).toBe(url);
        });

        it("VideoListInfo.extra reprend def.extra", () => {
            expect(parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2", {extra: "mon extra"})).extra).toBe("mon extra");
        });

        it("une liste de vidéos conserve l'autoplay du lien", () => {
            expect(parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2", {autoplay: "true"})).autoplay).toBe(AUTOPLAY_MODES.INIT);
        });
    });

    describe("parseFromLink", () => {
        it("lien classique => VideoInfo okru", () => {
            const info = parser.parseFromLink(lien("https://ok.ru/video/123", {autoplay: "click", target: "player"}));
            expect(info).toMatchObject({provider: "okru", videoId: "123", autoplay: AUTOPLAY_MODES.CLICK});
        });

        it("élément avec data-url (pas un <a>)", () => {
            const info = parser.parseFromLink({tagName: "BUTTON", dataset: {url: "https://ok.ru/video/9", target: "player"}});
            expect(info.videoId).toBe("9");
        });
    });

    describe("buildUrl", () => {
        it("construit l'adresse d'une vidéo, ou de la première d'une liste", () => {
            expect(parser.buildUrl({videoId: "123"})).toBe("https://ok.ru/video/123");
            expect(parser.buildUrl({videoIds: ["7", "8"]})).toBe("https://ok.ru/video/7");
        });
        it("erreurs : définition absente, playlist non gérée, rien à construire", () => {
            expect(() => parser.buildUrl()).toThrow(TypeError);
            expect(() => parser.buildUrl({playlistId: "PL1"})).toThrow(/playlist not supported/);
            expect(() => parser.buildUrl({})).toThrow(/need videoId or videoIds/);
        });
    });
});
