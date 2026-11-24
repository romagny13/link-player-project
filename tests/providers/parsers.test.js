import {afterEach, describe, expect, it, vi} from "vitest";
import {InfoParser} from "../../src/providers/InfoParser.js";
import {YouTubeInfoParser} from "../../src/providers/youtube/YouTubeInfoParser.js";
import {OkruInfoParser} from "../../src/providers/okru/OkruInfoParser.js";
import {VideoInfo} from "../../src/models/VideoInfo.js";
import {VideoListInfo} from "../../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../../src/models/PlaylistInfo.js";
import {SrcInfo, UrlInfo} from "../../src/models/UrlInfo.js";
import {AUTOPLAY_MODES,SOURCE_KINDS} from "../../src/utils/helpers.js";



// ---------------------------------------------------------------------------
// Faux éléments (pas de DOM : un objet avec les propriétés lues par les parsers)
// ---------------------------------------------------------------------------
const lien = (href, dataset = {}) => ({tagName: "A", href, dataset});
const divLien = (url, dataset = {}) => ({tagName: "DIV", dataset: {url, ...dataset}});
const iframe = (src, parent = {id: "hote"}) => ({tagName: "IFRAME", src, parentElement: parent, dataset: {}});

const ID_A = "aaaaaaaaaaa";
const ID_B = "bbbbbbbbbbb";
const ID_C = "ccccccccccc";
const ID_VIDEO = "dQw4w9WgXcQ";

afterEach(() => vi.restoreAllMocks());

// ===========================================================================
// InfoParser (classe de base)
// ===========================================================================
describe("InfoParser", () => {
    const parser = new InfoParser();

    describe("méthodes abstraites", () => {
        it.each([
            ["parseUrl", () => parser.parseUrl("x")],
            ["parseSrc", () => parser.parseSrc("x")],
            ["buildUrl", () => parser.buildUrl({})],
            ["parseFromFrame", () => parser.parseFromFrame({})],
            ["parseDefinition", () => parser.parseDefinition({})]
        ])("%s() doit être implémentée par la sous-classe", (nom, appel) => {
            expect(appel).toThrow(`${nom}() must be implemented`);
        });
    });

    describe("getUrl", () => {
        it("lit href sur un <a>", () => {
            expect(parser.getUrl(lien("https://youtu.be/x"))).toBe("https://youtu.be/x");
        });

        it("lit src sur une <iframe>", () => {
            expect(parser.getUrl(iframe("https://www.youtube.com/embed/x"))).toBe("https://www.youtube.com/embed/x");
        });

        it("lit data-url sur n'importe quel autre élément", () => {
            expect(parser.getUrl(divLien("https://ok.ru/video/1"))).toBe("https://ok.ru/video/1");
        });

        it("retourne undefined sans data-url, et sans dataset du tout", () => {
            expect(parser.getUrl({tagName: "DIV", dataset: {}})).toBeUndefined();
            expect(parser.getUrl({tagName: "DIV"})).toBeUndefined();
        });
    });

    describe("getValidUrl", () => {
        it("retourne un objet URL", () => {
            expect(parser.getValidUrl("https://a.b/c?d=1").pathname).toBe("/c");
        });

        it("ignore les espaces autour", () => {
            expect(parser.getValidUrl("  https://a.b/c  ").hostname).toBe("a.b");
        });

        it("retourne null quand ce n'est pas une URL", () => {
            expect(parser.getValidUrl("pas une url")).toBeNull();
            expect(parser.getValidUrl("")).toBeNull();
            expect(parser.getValidUrl(undefined)).toBeNull();
        });
    });

    describe("parseJsonAttribute", () => {
        it("undefined => undefined (attribut absent)", () => {
            expect(parser.parseJsonAttribute(undefined, "data-videos")).toBeUndefined();
        });

        it("lit un tableau JSON", () => {
            expect(parser.parseJsonAttribute('[{"title":"A"}]', "data-videos")).toEqual([{title: "A"}]);
        });

        it("JSON invalide => erreur qui nomme l'attribut", () => {
            expect(() => parser.parseJsonAttribute("{pas du json", "data-videos")).toThrow(/Invalid JSON in data-videos/);
        });

        it("chaîne vide => JSON invalide", () => {
            expect(() => parser.parseJsonAttribute("", "data-videos")).toThrow(/Invalid JSON in data-videos/);
        });

        it("JSON valide mais pas un tableau => erreur", () => {
            expect(() => parser.parseJsonAttribute('{"a":1}', "data-videos")).toThrow("data-videos must be a JSON array");
            expect(() => parser.parseJsonAttribute("42", "data-videos")).toThrow("must be a JSON array");
        });
    });

    describe("readLinkData", () => {
        it("lit tous les attributs data-* (valeurs brutes pour start et duration)", () => {
            const data = parser.readLinkData(lien("https://youtu.be/x", {
                autoplay: "click", start: "1m30s", title: "T", description: "D", channel: "C",
                channelUrl: "https://c", thumbnail: "https://t", duration: "2h", index: "3",
                target: "lecteur", showOnInit: "", key: "ma-cle", extra: "{}",
                videos: '[{"title":"V1"}]'
            }));
            expect(data).toEqual({
                autoplay: "click", start: "1m30s", title: "T", description: "D", channel: "C",
                channelUrl: "https://c", thumbnail: "https://t", duration: "2h", index: 3,
                target: "lecteur", showOnInit: true, key: "ma-cle", extra: "{}",
                videos: [{title: "V1"}]
            });
        });

        it("valeurs par défaut quand aucun attribut n'est présent", () => {
            const data = parser.readLinkData(lien("https://youtu.be/x"));
            expect(data.videos).toEqual([]);
            expect(data.showOnInit).toBe(false);
            expect(data.index).toBeUndefined();
            expect(data.target).toBeUndefined();
            expect(data.autoplay).toBeUndefined();
        });

        it("data-show-on-init : présent, vide ou \"true\" => true ; \"false\", \"0\", \"no\" => false", () => {
            const lire = (v) => parser.readLinkData(lien("u", {showOnInit: v})).showOnInit;
            expect(lire("")).toBe(true);
            expect(lire("true")).toBe(true);
            expect(lire("false")).toBe(false);
            expect(lire("0")).toBe(false);
            expect(lire("no")).toBe(false);
        });

        it("data-index non numérique => undefined", () => {
            expect(parser.readLinkData(lien("u", {index: "abc"})).index).toBeUndefined();
        });

        it("pour une iframe sans data-target, la cible est l'id du parent", () => {
            expect(parser.readLinkData(iframe("u", {id: "parent"})).target).toBe("parent");
        });

        it("data-target prime sur l'id du parent, et un parent absent donne undefined", () => {
            const f = iframe("u", {id: "parent"});
            f.dataset.target = "explicite";
            expect(parser.readLinkData(f).target).toBe("explicite");
            expect(parser.readLinkData(iframe("u", null)).target).toBeUndefined();
        });

        it("le parent n'est utilisé que pour les iframes, pas pour un lien", () => {
            expect(parser.readLinkData({tagName: "A", dataset: {}, parentElement: {id: "p"}}).target).toBeUndefined();
        });

        it("propage l'erreur d'un data-videos invalide", () => {
            expect(() => parser.readLinkData(lien("u", {videos: "oups"}))).toThrow(/data-videos/);
        });
    });

    describe("parseFromLink", () => {
        class Espion extends InfoParser {
            parseDefinition(def, element) {
                return {def, element};
            }
        }

        it("passe l'url, les données du lien ET l'élément à parseDefinition", () => {
            const el = lien("https://youtu.be/x", {title: "T", target: "t"});
            const {def, element} = new Espion().parseFromLink(el);
            expect(def).toMatchObject({url: "https://youtu.be/x", title: "T", target: "t"});
            expect(element).toBe(el);
        });

        it("fonctionne avec un élément quelconque portant data-url", () => {
            const el = divLien("https://ok.ru/video/1");
            expect(new Espion().parseFromLink(el).def.url).toBe("https://ok.ru/video/1");
        });

        it("erreur claire quand l'élément n'a aucune URL", () => {
            expect(() => new Espion().parseFromLink({tagName: "DIV", dataset: {}})).toThrow(/No URL found/);
        });
    });
});

// ===========================================================================
// YouTubeInfoParser
// ===========================================================================
describe("YouTubeInfoParser", () => {
    const parser = new YouTubeInfoParser();

    describe("isValidVideoId", () => {
        it("accepte 11 caractères [a-zA-Z0-9_-]", () => {
            expect(parser.isValidVideoId(ID_VIDEO)).toBe(true);
            expect(parser.isValidVideoId("a_b-c_d-e_f")).toBe(true);
        });

        it("refuse les autres longueurs, caractères et types", () => {
            for (const v of ["", "court", "trop-long-123456", "avec espace", "caractère é!!", null, undefined, 12345678901])
                expect(parser.isValidVideoId(v)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    describe("parseUrl", () => {
        it("youtu.be/ID => vidéo, retourne un UrlInfo", () => {
            const info = parser.parseUrl(`https://youtu.be/${ID_VIDEO}`);
            expect(info).toBeInstanceOf(UrlInfo);
            expect(info).toMatchObject({kind: "video", videoId: ID_VIDEO, playlistId: null, source: `https://youtu.be/${ID_VIDEO}`});
        });

        it("youtu.be/ID?t= : accepte secondes et format 1m30s", () => {
            expect(parser.parseUrl(`https://youtu.be/${ID_VIDEO}?t=90`).startSeconds).toBe(90);
            expect(parser.parseUrl(`https://youtu.be/${ID_VIDEO}?t=1m30s`).startSeconds).toBe(90);
        });

        it("youtu.be/ID?list= => playlist avec la vidéo de départ", () => {
            expect(parser.parseUrl(`https://youtu.be/${ID_VIDEO}?list=PL1`)).toMatchObject({kind: "playlist", videoId: ID_VIDEO, playlistId: "PL1"});
        });

        it("youtu.be : slash final toléré, identifiant invalide refusé", () => {
            expect(parser.parseUrl(`https://youtu.be/${ID_VIDEO}/`).videoId).toBe(ID_VIDEO);
            expect(() => parser.parseUrl("https://youtu.be/court")).toThrow("Invalid video ID");
            expect(() => parser.parseUrl("https://youtu.be/")).toThrow("Invalid video ID");
        });

        it("watch?v=ID => vidéo", () => {
            expect(parser.parseUrl(`https://www.youtube.com/watch?v=${ID_VIDEO}`)).toMatchObject({kind: "video", videoId: ID_VIDEO});
        });

        it("watch?v=ID&t=... => vidéo avec temps de départ", () => {
            expect(parser.parseUrl(`https://www.youtube.com/watch?v=${ID_VIDEO}&t=2m`).startSeconds).toBe(120);
        });

        it("watch?list=PL => playlist sans vidéo de départ, avec index", () => {
            expect(parser.parseUrl("https://www.youtube.com/watch?list=PL1&index=2"))
                .toMatchObject({kind: "playlist", playlistId: "PL1", videoId: null, index: 2});
        });

        it("watch?v=ID&list=PL => playlist avec vidéo de départ", () => {
            expect(parser.parseUrl(`https://www.youtube.com/watch?v=${ID_VIDEO}&list=PL1`))
                .toMatchObject({kind: "playlist", playlistId: "PL1", videoId: ID_VIDEO});
        });

        it("watch avec un identifiant invalide => erreur, même avec une playlist", () => {
            expect(() => parser.parseUrl("https://www.youtube.com/watch?v=court")).toThrow("Invalid video ID");
            expect(() => parser.parseUrl("https://www.youtube.com/watch?v=court&list=PL1")).toThrow("Invalid video ID");
        });

        it("watch sans v ni list => erreur", () => {
            expect(() => parser.parseUrl("https://www.youtube.com/watch")).toThrow("Missing video ID or playlist");
        });

        it("watch_videos => liste de vidéos, première vidéo exposée, index lu", () => {
            const info = parser.parseUrl(`https://www.youtube.com/watch_videos?video_ids=${ID_A},${ID_B},${ID_C}&index=1`);
            expect(info).toMatchObject({kind: "videoList", videoIds: [ID_A, ID_B, ID_C], videoId: ID_A, index: 1});
        });

        it("watch_videos : ignore les identifiants invalides et les espaces", () => {
            const info = parser.parseUrl(`https://www.youtube.com/watch_videos?video_ids=${ID_A}, invalide ,${ID_B}`);
            expect(info.videoIds).toEqual([ID_A, ID_B]);
        });

        it("watch_videos : erreur si video_ids absent ou sans identifiant valide", () => {
            expect(() => parser.parseUrl("https://www.youtube.com/watch_videos")).toThrow("Missing video_ids");
            expect(() => parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=x,y")).toThrow("No valid video IDs");
        });

        it("accepte m.youtube.com et music.youtube.com, sans tenir compte de la casse du domaine", () => {
            expect(parser.parseUrl(`https://m.youtube.com/watch?v=${ID_VIDEO}`).videoId).toBe(ID_VIDEO);
            expect(parser.parseUrl(`https://music.youtube.com/watch?v=${ID_VIDEO}`).videoId).toBe(ID_VIDEO);
            expect(parser.parseUrl(`https://YOUTUBE.com/watch?v=${ID_VIDEO}`).videoId).toBe(ID_VIDEO);
        });

        it("refuse les autres sites et les chemins non gérés", () => {
            expect(() => parser.parseUrl(`https://vimeo.com/watch?v=${ID_VIDEO}`)).toThrow("Unsupported YouTube URL");
            expect(() => parser.parseUrl(`https://www.youtube.com/shorts/${ID_VIDEO}`)).toThrow("Unsupported YouTube URL");
            expect(() => parser.parseUrl(`https://notyoutube.com/watch?v=${ID_VIDEO}`)).toThrow("Unsupported YouTube URL");
        });

        it("URL invalide => erreur (contrairement à OK.ru qui retourne null)", () => {
            expect(() => parser.parseUrl("pas une url")).toThrow("Invalid URL");
        });
    });

    // -----------------------------------------------------------------------
    describe("parseSrc", () => {
        it("embed/ID => SrcInfo vidéo", () => {
            const info = parser.parseSrc(`https://www.youtube.com/embed/${ID_VIDEO}`);
            expect(info).toBeInstanceOf(SrcInfo);
            expect(info).toMatchObject({kind: "video", videoId: ID_VIDEO, playlistId: null, videoIds: null});
            expect(info.source).toBe(`https://www.youtube.com/embed/${ID_VIDEO}`);
        });

        it("autoplay et mute : 1 => true, 0 => false, absent ou autre => null", () => {
            const lire = (qs) => parser.parseSrc(`https://www.youtube.com/embed/${ID_VIDEO}${qs}`);
            expect(lire("?autoplay=1&mute=1")).toMatchObject({autoplay: true, mute: true});
            expect(lire("?autoplay=0&mute=0")).toMatchObject({autoplay: false, mute: false});
            expect(lire("")).toMatchObject({autoplay: null, mute: null});
            expect(lire("?autoplay=true")).toMatchObject({autoplay: null});
        });

        it("start et index", () => {
            const info = parser.parseSrc(`https://www.youtube.com/embed/${ID_VIDEO}?start=30&index=2`);
            expect(info).toMatchObject({startSeconds: 30, index: 2});
        });

        it("embed?playlist=a,b => liste de vidéos (identifiants invalides ignorés)", () => {
            const info = parser.parseSrc(`https://www.youtube.com/embed?playlist=${ID_A},nope,${ID_B}`);
            expect(info).toMatchObject({kind: "videoList", videoIds: [ID_A, ID_B], videoId: null});
        });

        it("embed/ID?playlist=b,c => liste de vidéos, la vidéo du chemin est conservée", () => {
            const info = parser.parseSrc(`https://www.youtube.com/embed/${ID_A}?playlist=${ID_B},${ID_C}`);
            expect(info).toMatchObject({kind: "videoList", videoId: ID_A, videoIds: [ID_B, ID_C]});
        });

        it("embed/videoseries?list=PL => playlist, sans vidéo", () => {
            const info = parser.parseSrc("https://www.youtube.com/embed/videoseries?list=PL1");
            expect(info).toMatchObject({kind: "playlist", playlistId: "PL1", videoId: null});
        });

        it("embed/ID?list=PL => playlist avec vidéo de départ (list prime sur playlist=)", () => {
            const info = parser.parseSrc(`https://www.youtube.com/embed/${ID_A}?list=PL1&playlist=${ID_B}`);
            expect(info).toMatchObject({kind: "playlist", playlistId: "PL1", videoId: ID_A});
        });

        it("accepte youtube-nocookie.com, avec ou sans www", () => {
            expect(parser.parseSrc(`https://www.youtube-nocookie.com/embed/${ID_VIDEO}`).videoId).toBe(ID_VIDEO);
            expect(parser.parseSrc(`https://youtube-nocookie.com/embed/${ID_VIDEO}`).videoId).toBe(ID_VIDEO);
        });

        it("slash final toléré", () => {
            expect(parser.parseSrc(`https://www.youtube.com/embed/${ID_VIDEO}/`).videoId).toBe(ID_VIDEO);
        });

        it("refuse un autre domaine", () => {
            expect(() => parser.parseSrc(`https://example.com/embed/${ID_VIDEO}`)).toThrow("Invalid embed host");
            expect(() => parser.parseSrc(`https://notyoutube.com/embed/${ID_VIDEO}`)).toThrow("Invalid embed host");
        });

        it("refuse un chemin qui n'est pas /embed (y compris /embedded)", () => {
            expect(() => parser.parseSrc(`https://www.youtube.com/watch?v=${ID_VIDEO}`)).toThrow("Invalid embed URL");
            expect(() => parser.parseSrc(`https://www.youtube.com/embedded/${ID_VIDEO}`)).toThrow("Invalid embed URL");
        });

        it("refuse un embed sans vidéo ni liste ni playlist", () => {
            expect(() => parser.parseSrc("https://www.youtube.com/embed")).toThrow("Invalid embed URL");
            expect(() => parser.parseSrc("https://www.youtube.com/embed/videoseries")).toThrow("Invalid embed URL");
            expect(() => parser.parseSrc("https://www.youtube.com/embed/court")).toThrow("Invalid embed URL");
        });

        it("URL invalide => erreur", () => {
            expect(() => parser.parseSrc("pas une url")).toThrow("Invalid URL");
            expect(() => parser.parseSrc("")).toThrow("Invalid URL");
        });
    });

    // -----------------------------------------------------------------------
    describe("parseFromFrame", () => {
        it("vidéo : la cible est l'id du parent, la source décrit l'iframe", () => {
            const f = iframe(`https://www.youtube.com/embed/${ID_VIDEO}?start=10`, {id: "hote"});
            const info = parser.parseFromFrame(f);
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({provider: "youtube", target: "hote", videoId: ID_VIDEO, startSeconds: 10});
            expect(info.source).toEqual({url: f.src, element: f, kind: SOURCE_KINDS.FRAME});
            expect(info.source.element).toBe(f);
        });

        it("autoplay=1 => INIT ; autoplay=0 ou absent => NONE", () => {
            const lire = (qs) => parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${ID_VIDEO}${qs}`)).autoplay;
            expect(lire("?autoplay=1")).toBe(AUTOPLAY_MODES.INIT);
            expect(lire("?autoplay=0")).toBe(AUTOPLAY_MODES.NONE);
            expect(lire("")).toBe(AUTOPLAY_MODES.NONE);
        });

        it("génère et mémorise un id `host:` quand le parent n'en a pas", () => {
            const parent = {id: ""};
            const info = parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${ID_VIDEO}`, parent));
            expect(info.target).toMatch(/^host:/);
            expect(parent.id).toBe(info.target);
        });

        it("réutilise l'id existant du parent sans le modifier", () => {
            const parent = {id: "deja-la"};
            parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${ID_VIDEO}`, parent));
            expect(parent.id).toBe("deja-la");
        });

        it("liste de vidéos => VideoListInfo avec index et autoplay", () => {
            const f = iframe(`https://www.youtube.com/embed?playlist=${ID_A},${ID_B}&index=1&autoplay=1`);
            const info = parser.parseFromFrame(f);
            expect(info).toBeInstanceOf(VideoListInfo);
            expect(info).toMatchObject({videoIds: [ID_A, ID_B], index: 1, autoplay: AUTOPLAY_MODES.INIT, target: "hote"});
            expect(info.source.kind).toBe(SOURCE_KINDS.FRAME);
        });

        it("playlist => PlaylistInfo avec vidéo de départ et autoplay", () => {
            const info = parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${ID_A}?list=PL1&autoplay=1`));
            expect(info).toBeInstanceOf(PlaylistInfo);
            expect(info).toMatchObject({playlistId: "PL1", videoId: ID_A, autoplay: AUTOPLAY_MODES.INIT});
        });

        it("refuse un élément qui n'est pas une iframe, ou absent", () => {
            expect(() => parser.parseFromFrame(lien("https://youtu.be/x"))).toThrow("Expected an IFRAME element, but received: <a>");
            expect(() => parser.parseFromFrame(null)).toThrow("Expected an IFRAME element");
            expect(() => parser.parseFromFrame(undefined)).toThrow("Expected an IFRAME element");
        });

        it("refuse une iframe qui n'est pas un embed YouTube", () => {
            expect(() => parser.parseFromFrame(iframe("https://ok.ru/videoembed/1"))).toThrow("Invalid embed host");
            expect(() => parser.parseFromFrame(iframe(""))).toThrow("Invalid URL");
        });

        it("refuse une iframe détachée du DOM (sans parent)", () => {
            expect(() => parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${ID_VIDEO}`, null)))
                .toThrow("Iframe has no parent element");
        });
    });

    // -----------------------------------------------------------------------
    describe("parseDefinition", () => {
        const def = (url, extra = {}) => ({url, target: "lecteur", ...extra});

        describe("vidéo seule", () => {
            it("recopie les champs de la définition", () => {
                const info = parser.parseDefinition(def(`https://youtu.be/${ID_VIDEO}`, {
                    title: "T", description: "D", channel: "C", channelUrl: "https://c",
                    thumbnail: "https://t", duration: "1m", start: "30", autoplay: "click",
                    showOnInit: true, key: "ma-cle", extra: {a: 1}
                }));
                expect(info).toBeInstanceOf(VideoInfo);
                expect(info).toMatchObject({
                    provider: "youtube", target: "lecteur", videoId: ID_VIDEO, title: "T", description: "D",
                    channel: "C", channelUrl: "https://c", thumbnail: "https://t", duration: 60,
                    startSeconds: 30, autoplay: AUTOPLAY_MODES.CLICK, showOnInit: true, key: "ma-cle", extra: {a: 1}
                });
            });

            it("valeurs par défaut : textes vides, clé provider:id, vignette calculée", () => {
                const info = parser.parseDefinition(def(`https://youtu.be/${ID_VIDEO}`));
                expect(info).toMatchObject({
                    title: "", description: "", channel: "", channelUrl: "",
                    autoplay: AUTOPLAY_MODES.NONE, key: `youtube:${ID_VIDEO}`
                });
                expect(info.thumbnail).toContain(ID_VIDEO);
            });

            it("le temps de départ de la définition prime sur celui de l'URL, sinon on prend celui de l'URL", () => {
                expect(parser.parseDefinition(def(`https://youtu.be/${ID_VIDEO}?t=10`, {start: "20"})).startSeconds).toBe(20);
                expect(parser.parseDefinition(def(`https://youtu.be/${ID_VIDEO}?t=10`)).startSeconds).toBe(10);
            });

            it("durée : 90, \"1m30s\" ou invalide => null", () => {
                const lire = (d) => parser.parseDefinition(def(`https://youtu.be/${ID_VIDEO}`, {duration: d})).duration;
                expect(lire("90")).toBe(90);
                expect(lire("1m30s")).toBe(90);
                expect(lire("n'importe quoi")).toBeNull();
            });

            it("un vidéo sans cible lève une erreur", () => {
                expect(() => parser.parseDefinition({url: `https://youtu.be/${ID_VIDEO}`})).toThrow(/target/);
            });

            it("une URL invalide ou non YouTube lève une erreur", () => {
                expect(() => parser.parseDefinition(def("pas une url"))).toThrow("Invalid URL");
                expect(() => parser.parseDefinition(def("https://vimeo.com/1"))).toThrow("Unsupported YouTube URL");
            });

            it("`videos` doit être un tableau", () => {
                expect(() => parser.parseDefinition(def(`https://youtu.be/${ID_VIDEO}`, {videos: "x"}))).toThrow("videos must be an array");
            });
        });

        describe("source (d'où vient l'info ?)", () => {
            it("sans élément => DEFINITION, sans élément", () => {
                const info = parser.parseDefinition(def(`https://youtu.be/${ID_VIDEO}`));
                expect(info.source).toEqual({url: `https://youtu.be/${ID_VIDEO}`, element: undefined, kind: SOURCE_KINDS.DEFINITION});
            });

            it("avec un élément (n'importe quel tag) => LINK + l'élément", () => {
                const el = divLien(`https://youtu.be/${ID_VIDEO}`);
                const info = parser.parseDefinition(def(`https://youtu.be/${ID_VIDEO}`), el);
                expect(info.source.kind).toBe(SOURCE_KINDS.LINK);
                expect(info.source.element).toBe(el);
                expect(info.source.url).toBe(`https://youtu.be/${ID_VIDEO}`);
            });

            it("parseFromLink produit une source LINK avec le lien lui-même", () => {
                const el = lien(`https://youtu.be/${ID_VIDEO}`, {target: "lecteur", title: "Via lien"});
                const info = parser.parseFromLink(el);
                expect(info.title).toBe("Via lien");
                expect(info.source.kind).toBe(SOURCE_KINDS.LINK);
                expect(info.source.element).toBe(el);
            });

            it("la même règle vaut pour les listes et les playlists", () => {
                const el = lien("x");
                const liste = parser.parseDefinition(def(`https://www.youtube.com/watch_videos?video_ids=${ID_A},${ID_B}`), el);
                const playlist = parser.parseDefinition(def("https://www.youtube.com/watch?list=PL1"));
                expect(liste.source).toMatchObject({kind: SOURCE_KINDS.LINK, element: el});
                expect(playlist.source).toMatchObject({kind: SOURCE_KINDS.DEFINITION, element: undefined});
            });
        });

        describe("liste de vidéos", () => {
            const urlListe = `https://www.youtube.com/watch_videos?video_ids=${ID_A},${ID_B},${ID_C}`;

            it("construit une VideoListInfo avec un VideoInfo par identifiant", () => {
                const liste = parser.parseDefinition(def(urlListe, {key: "k", showOnInit: true, autoplay: "true", extra: 1}));
                expect(liste).toBeInstanceOf(VideoListInfo);
                expect(liste).toMatchObject({
                    provider: "youtube", target: "lecteur", videoIds: [ID_A, ID_B, ID_C],
                    key: "k", showOnInit: true, autoplay: AUTOPLAY_MODES.INIT, extra: 1
                });
                expect(liste.videos.map((v) => v.videoId)).toEqual([ID_A, ID_B, ID_C]);
            });

            it("l'index de l'URL prime sur celui de la définition", () => {
                expect(parser.parseDefinition(def(`${urlListe}&index=2`, {index: 0})).index).toBe(2);
                expect(parser.parseDefinition(def(urlListe, {index: 1})).index).toBe(1);
            });

            it("les infos de `videos` sont attribuées à chaque vidéo, par position", () => {
                const liste = parser.parseDefinition(def(urlListe, {
                    videos: [{title: "Un", start: "10", duration: "1m"}, {title: "Deux", key: "cle-2"}]
                }));
                expect(liste.videos[0]).toMatchObject({title: "Un", startSeconds: 10, duration: 60});
                expect(liste.videos[1]).toMatchObject({title: "Deux", key: "cle-2"});
                expect(liste.videos[2]).toMatchObject({title: "", startSeconds: null});
            });

            it("les vidéos supplémentaires de `videos` sont ignorées", () => {
                const liste = parser.parseDefinition(def(urlListe, {videos: [{}, {}, {}, {title: "en trop"}]}));
                expect(liste.videos).toHaveLength(3);
            });

            it("l'autoplay d'une vidéo reprend celui de la définition, sauf valeur propre", () => {
                const liste = parser.parseDefinition(def(urlListe, {autoplay: "click", videos: [{autoplay: "init"}]}));
                expect(liste.videos[0].autoplay).toBe(AUTOPLAY_MODES.INIT);
                expect(liste.videos[1].autoplay).toBe(AUTOPLAY_MODES.CLICK);
            });

            it("le temps de départ de la définition n'est PAS appliqué à toutes les vidéos", () => {
                const liste = parser.parseDefinition(def(urlListe, {start: "99"}));
                expect(liste.videos.every((v) => v.startSeconds === null)).toBe(true);
            });

            it("la vignette par défaut est calculée pour chaque vidéo", () => {
                const liste = parser.parseDefinition(def(urlListe));
                expect(liste.videos[1].thumbnail).toContain(ID_B);
            });
        });

        describe("playlist", () => {
            const urlPlaylist = `https://www.youtube.com/watch?v=${ID_A}&list=PL1`;

            it("construit une PlaylistInfo", () => {
                const p = parser.parseDefinition(def(urlPlaylist, {key: "k", showOnInit: true, autoplay: "click"}));
                expect(p).toBeInstanceOf(PlaylistInfo);
                expect(p).toMatchObject({
                    provider: "youtube", target: "lecteur", playlistId: "PL1", videoId: ID_A,
                    key: "k", showOnInit: true, autoplay: AUTOPLAY_MODES.CLICK
                });
                expect(p.videos).toEqual([]);
            });

            it("clé par défaut provider:playlist:id", () => {
                expect(parser.parseDefinition(def(urlPlaylist)).key).toBe("youtube:playlist:PL1");
            });

            it("les vidéos viennent de `videos` (champ videoId obligatoire)", () => {
                const p = parser.parseDefinition(def(urlPlaylist, {
                    videos: [{videoId: ID_A, title: "A", start: "5"}, {videoId: ID_B}]
                }));
                expect(p.videos.map((v) => v.videoId)).toEqual([ID_A, ID_B]);
                expect(p.videos[0]).toMatchObject({title: "A", startSeconds: 5});
                expect(p.videos[1].thumbnail).toContain(ID_B);
            });

            it("une vidéo de playlist reprend l'autoplay de la définition, comme dans une liste", () => {
                const p = parser.parseDefinition(def(urlPlaylist, {autoplay: "click", videos: [{videoId: ID_A}, {videoId: ID_B, autoplay: "init"}]}));
                expect(p.videos[0].autoplay).toBe(AUTOPLAY_MODES.CLICK);
                expect(p.videos[1].autoplay).toBe(AUTOPLAY_MODES.INIT);
            });

            // it("une vidéo de playlist sans videoId lève une erreur", () => {
            //     expect(() => parser.parseDefinition(def(urlPlaylist, {videos: [{title: "sans id"}]}))).toThrow(/videoId/);
            // });

            it("sans videoId de départ : playlist seule, vignette vide si l'id est inconnu", () => {
                const p = parser.parseDefinition(def("https://www.youtube.com/watch?list=PL1"));
                expect(p.videoId).toBeNull();
            });
        });

        describe("vignettes personnalisées", () => {
            it("utilise le constructeur de vignettes fourni", () => {
                const custom = new YouTubeInfoParser({thumbnailUrlBuilder: {getThumbnailUrl: (id) => `https://img/${id}.png`}});
                expect(custom.parseDefinition(def(`https://youtu.be/${ID_VIDEO}`)).thumbnail).toBe(`https://img/${ID_VIDEO}.png`);
            });
        });
    });

    // -----------------------------------------------------------------------
    describe("buildUrl", () => {
        it("vidéo : watch?v=", () => {
            expect(parser.buildUrl({videoId: ID_VIDEO})).toBe(`https://www.youtube.com/watch?v=${ID_VIDEO}`);
        });

        it("vidéo avec temps de départ : &t=", () => {
            expect(parser.buildUrl({videoId: ID_VIDEO, start: 90})).toBe(`https://www.youtube.com/watch?v=${ID_VIDEO}&t=90`);
        });

        it("playlist, avec ou sans vidéo de départ", () => {
            expect(parser.buildUrl({playlistId: "PL1"})).toBe("https://www.youtube.com/watch?list=PL1");
            expect(parser.buildUrl({playlistId: "PL1", videoId: ID_A})).toBe(`https://www.youtube.com/watch?list=PL1&v=${ID_A}`);
        });

        it("liste de vidéos : watch_videos, index 0 conservé", () => {
            expect(parser.buildUrl({videoIds: [ID_A, ID_B], index: 0}))
                .toBe(`https://www.youtube.com/watch_videos?video_ids=${ID_A}%2C${ID_B}&index=0`);
        });

        it("la playlist prime sur la liste, qui prime sur la vidéo seule", () => {
            expect(parser.buildUrl({playlistId: "PL1", videoIds: [ID_A], videoId: ID_B})).toContain("list=PL1");
            expect(parser.buildUrl({videoIds: [ID_A], videoId: ID_B})).toContain("watch_videos");
        });

        it("erreur quand il manque tout, ou la définition elle-même", () => {
            expect(() => parser.buildUrl({})).toThrow("need playlistId, videoIds, or videoId");
            expect(() => parser.buildUrl(undefined)).toThrow("definition is required");
            expect(() => parser.buildUrl({videoIds: []})).toThrow("need playlistId, videoIds, or videoId");
        });

        it("aller-retour : parseUrl relit ce que buildUrl a écrit", () => {
            expect(parser.parseUrl(parser.buildUrl({videoId: ID_VIDEO, start: 90}))).toMatchObject({kind: "video", videoId: ID_VIDEO, startSeconds: 90});
            expect(parser.parseUrl(parser.buildUrl({videoIds: [ID_A, ID_B], index: 1}))).toMatchObject({kind: "videoList", videoIds: [ID_A, ID_B], index: 1});
            expect(parser.parseUrl(parser.buildUrl({playlistId: "PL1", videoId: ID_A}))).toMatchObject({kind: "playlist", playlistId: "PL1", videoId: ID_A});
        });
    });
});

// ===========================================================================
// OkruInfoParser
// ===========================================================================
describe("OkruInfoParser", () => {
    const parser = new OkruInfoParser();

    describe("parseUrl", () => {
        it("/video/ID => vidéo", () => {
            const info = parser.parseUrl("https://ok.ru/video/123456");
            expect(info).toBeInstanceOf(UrlInfo);
            expect(info).toMatchObject({kind: "video", videoId: "123456", source: "https://ok.ru/video/123456"});
        });

        it("/videoembed/ID => vidéo aussi", () => {
            expect(parser.parseUrl("https://ok.ru/videoembed/123456")).toMatchObject({kind: "video", videoId: "123456"});
        });

        it("un identifiant suivi d'une requête ou d'un slash est lu", () => {
            expect(parser.parseUrl("https://ok.ru/video/123456?x=1").videoId).toBe("123456");
            expect(parser.parseUrl("https://ok.ru/video/123456/").videoId).toBe("123456");
        });

        it("retourne null quand l'URL est invalide ou ne contient pas de vidéo", () => {
            expect(parser.parseUrl("pas une url")).toBeNull();
            expect(parser.parseUrl("https://ok.ru/")).toBeNull();
            expect(parser.parseUrl("https://ok.ru/video/abc")).toBeNull();
            expect(parser.parseUrl("https://ok.ru/profile/123")).toBeNull();
        });

        describe("liste (video_ids=…&labels=…)", () => {
            it("lit les identifiants, l'index et les titres", () => {
                const info = parser.parseUrl("https://ok.ru/video?video_ids=1,2,3&index=1&labels=Un,Deux,Trois");
                expect(info).toMatchObject({kind: "videoList", videoIds: ["1", "2", "3"], index: 1, labels: ["Un", "Deux", "Trois"]});
            });

            it("découpe les titres AVANT de décoder : %2C est une virgule du titre", () => {
                const info = parser.parseUrl("https://ok.ru/video?video_ids=1,2&labels=Bonjour%2C%20monde,Salut");
                expect(info.labels).toEqual(["Bonjour, monde", "Salut"]);
            });

            it("décode les identifiants et les titres, et retire les espaces", () => {
                const info = parser.parseUrl("https://ok.ru/video?video_ids=%201%20,2&labels=%20A%20,B");
                expect(info.videoIds).toEqual(["1", "2"]);
                expect(info.labels).toEqual(["A", "B"]);
            });

            it("un titre vide garde sa place (positionnel)", () => {
                const info = parser.parseUrl("https://ok.ru/video?video_ids=1,2,3&labels=A,,C");
                expect(info.labels).toEqual(["A", "", "C"]);
            });

            it("sans labels => liste vide", () => {
                expect(parser.parseUrl("https://ok.ru/video?video_ids=1,2").labels).toEqual([]);
            });

            it("séquence % mal formée : conservée telle quelle", () => {
                const info = parser.parseUrl("https://ok.ru/video?video_ids=1&labels=100%");
                expect(info.labels).toEqual(["100%"]);
            });

            it("video_ids vide ou composé de virgules => null", () => {
                expect(parser.parseUrl("https://ok.ru/video?video_ids=")).toBeNull();
                expect(parser.parseUrl("https://ok.ru/video?video_ids=,,")).toBeNull();
            });

            it("video_ids prime sur un identifiant dans le chemin", () => {
                expect(parser.parseUrl("https://ok.ru/video/999?video_ids=1,2").kind).toBe("videoList");
            });

            it("une clé dont le nom ressemble (xvideo_ids) n'est pas confondue", () => {
                expect(parser.parseUrl("https://ok.ru/video/5?xvideo_ids=1,2")).toMatchObject({kind: "video", videoId: "5"});
            });
        });
    });

    // -----------------------------------------------------------------------
    describe("parseSrc", () => {
        it("videoembed/ID => SrcInfo vidéo", () => {
            const info = parser.parseSrc("https://ok.ru/videoembed/123456");
            expect(info).toBeInstanceOf(SrcInfo);
            expect(info).toMatchObject({kind: "video", videoId: "123456", autoplay: null, source: "https://ok.ru/videoembed/123456"});
        });

        it("autoplay : 1 => true, 0 => false, absent => null", () => {
            expect(parser.parseSrc("https://ok.ru/videoembed/1?autoplay=1").autoplay).toBe(true);
            expect(parser.parseSrc("https://ok.ru/videoembed/1?autoplay=0").autoplay).toBe(false);
            expect(parser.parseSrc("https://ok.ru/videoembed/1").autoplay).toBeNull();
        });

        it("accepte www., m. et odnoklassniki.ru", () => {
            for (const h of ["www.ok.ru", "m.ok.ru", "odnoklassniki.ru"])
                expect(parser.parseSrc(`https://${h}/videoembed/1`).videoId).toBe("1");
        });

        it("slash final toléré", () => {
            expect(parser.parseSrc("https://ok.ru/videoembed/1/").videoId).toBe("1");
        });

        it("refuse un autre domaine", () => {
            expect(() => parser.parseSrc("https://example.com/videoembed/1")).toThrow("Invalid OK.ru embed host: 'example.com'");
            expect(() => parser.parseSrc("https://fake-ok.ru/videoembed/1")).toThrow("Invalid OK.ru embed host");
        });

        it("refuse un chemin qui n'est pas /videoembed/ID (une page /video/ID n'est pas un embed)", () => {
            expect(() => parser.parseSrc("https://ok.ru/video/1")).toThrow("Invalid OK.ru embed path");
            expect(() => parser.parseSrc("https://ok.ru/videoembed/abc")).toThrow("Invalid OK.ru embed path");
            expect(() => parser.parseSrc("https://ok.ru/videoembed/1/extra")).toThrow("Invalid OK.ru embed path");
        });

        it("URL invalide => erreur", () => {
            expect(() => parser.parseSrc("pas une url")).toThrow("Invalid URL");
            expect(() => parser.parseSrc("")).toThrow("Invalid URL");
        });
    });

    // -----------------------------------------------------------------------
    describe("parseFromFrame", () => {
        it("vidéo : cible = id du parent, source décrit l'iframe", () => {
            const f = iframe("https://ok.ru/videoembed/123?autoplay=1", {id: "hote"});
            const info = parser.parseFromFrame(f);
            expect(info).toBeInstanceOf(VideoInfo);
            expect(info).toMatchObject({provider: "okru", target: "hote", videoId: "123", autoplay: AUTOPLAY_MODES.INIT});
            expect(info.source).toEqual({url: f.src, element: f, kind: SOURCE_KINDS.FRAME});
        });

        it("autoplay absent => NONE", () => {
            expect(parser.parseFromFrame(iframe("https://ok.ru/videoembed/123")).autoplay).toBe(AUTOPLAY_MODES.NONE);
        });

        it("génère un id `host:` quand le parent n'en a pas, et le mémorise", () => {
            const parent = {id: ""};
            const info = parser.parseFromFrame(iframe("https://ok.ru/videoembed/123", parent));
            expect(info.target).toMatch(/^host:/);
            expect(parent.id).toBe(info.target);
        });

        it("refuse un élément qui n'est pas une iframe, ou absent", () => {
            expect(() => parser.parseFromFrame(lien("https://ok.ru/video/1"))).toThrow("Expected an IFRAME element, but received: <a>");
            expect(() => parser.parseFromFrame(null)).toThrow("Expected an IFRAME element");
        });

        it("refuse une iframe qui n'est pas un embed OK.ru", () => {
            expect(() => parser.parseFromFrame(iframe(`https://www.youtube.com/embed/${ID_VIDEO}`))).toThrow("Invalid OK.ru embed host");
        });

        it("refuse une iframe sans parent", () => {
            expect(() => parser.parseFromFrame(iframe("https://ok.ru/videoembed/1", null))).toThrow("Iframe has no parent element");
        });
    });

    // -----------------------------------------------------------------------
    describe("parseDefinition", () => {
        const def = (url, extra = {}) => ({url, target: "lecteur", ...extra});

        describe("vidéo seule", () => {
            it("recopie les champs de la définition", () => {
                const info = parser.parseDefinition(def("https://ok.ru/video/123", {
                    title: "T", description: "D", channel: "C", channelUrl: "https://c", thumbnail: "https://t",
                    duration: "1m", start: "30", autoplay: "click", showOnInit: true, key: "k", extra: 5
                }));
                expect(info).toBeInstanceOf(VideoInfo);
                expect(info).toMatchObject({
                    provider: "okru", target: "lecteur", videoId: "123", title: "T", description: "D",
                    channel: "C", channelUrl: "https://c", thumbnail: "https://t", duration: 60,
                    startSeconds: 30, autoplay: AUTOPLAY_MODES.CLICK, showOnInit: true, key: "k", extra: 5
                });
            });

            it("valeurs par défaut : textes vides, vignette vide, clé okru:id", () => {
                const info = parser.parseDefinition(def("https://ok.ru/video/123"));
                expect(info).toMatchObject({title: "", thumbnail: "", autoplay: AUTOPLAY_MODES.NONE, key: "okru:123"});
            });

            it("URL invalide ou non reconnue => erreur", () => {
                expect(() => parser.parseDefinition(def("pas une url"))).toThrow("Invalid URL: 'pas une url'");
                expect(() => parser.parseDefinition(def("https://ok.ru/profile/1"))).toThrow("Invalid URL");
            });

            it("`videos` doit être un tableau", () => {
                expect(() => parser.parseDefinition(def("https://ok.ru/video/1", {videos: {}}))).toThrow("videos must be an array");
            });

            it("sans cible => erreur", () => {
                expect(() => parser.parseDefinition({url: "https://ok.ru/video/1"})).toThrow(/target/);
            });
        });

        describe("source (d'où vient l'info ?)", () => {
            it("sans élément => DEFINITION", () => {
                const info = parser.parseDefinition(def("https://ok.ru/video/1"));
                expect(info.source).toEqual({url: "https://ok.ru/video/1", element: undefined, kind: SOURCE_KINDS.DEFINITION});
            });

            it("avec un élément => LINK + l'élément", () => {
                const el = divLien("https://ok.ru/video/1");
                const info = parser.parseDefinition(def("https://ok.ru/video/1"), el);
                expect(info.source).toEqual({url: "https://ok.ru/video/1", element: el, kind: SOURCE_KINDS.LINK});
            });

            it("parseFromLink : source LINK avec le lien", () => {
                const el = lien("https://ok.ru/video/1", {target: "lecteur"});
                expect(parser.parseFromLink(el).source).toMatchObject({kind: SOURCE_KINDS.LINK, element: el});
            });

            it("la liste porte la même source", () => {
                const el = lien("x");
                expect(parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2"), el).source)
                    .toMatchObject({kind: SOURCE_KINDS.LINK, element: el});
                expect(parser.parseDefinition(def("https://ok.ru/video?video_ids=1,2")).source.kind).toBe(SOURCE_KINDS.DEFINITION);
            });
        });

        describe("liste de vidéos", () => {
            const urlListe = "https://ok.ru/video?video_ids=1,2,3";

            it("construit une VideoListInfo", () => {
                const liste = parser.parseDefinition(def(urlListe, {key: "k", showOnInit: true, autoplay: "true", extra: 1}));
                expect(liste).toBeInstanceOf(VideoListInfo);
                expect(liste).toMatchObject({
                    provider: "okru", target: "lecteur", videoIds: ["1", "2", "3"],
                    key: "k", showOnInit: true, autoplay: AUTOPLAY_MODES.INIT, extra: 1
                });
                expect(liste.videos.map((v) => v.videoId)).toEqual(["1", "2", "3"]);
            });

            it("clé par défaut okru:list:ids", () => {
                expect(parser.parseDefinition(def(urlListe)).key).toBe("okru:list:1,2,3");
            });

            it("les titres viennent de labels= quand `videos` est absent", () => {
                const liste = parser.parseDefinition(def(`${urlListe}&labels=Un,Deux,Trois`));
                expect(liste.videos.map((v) => v.title)).toEqual(["Un", "Deux", "Trois"]);
            });

            it("`videos` prime sur labels=", () => {
                const liste = parser.parseDefinition(def(`${urlListe}&labels=Un,Deux,Trois`, {videos: [{title: "Premier"}, {title: "Second"}, {}]}));
                expect(liste.videos.map((v) => v.title)).toEqual(["Premier", "Second", ""]);
            });

            it("`videos` plus courte que la liste : les vidéos restantes ont des valeurs par défaut", () => {
                const liste = parser.parseDefinition(def(urlListe, {videos: [{title: "Seul"}]}));
                expect(liste.videos).toHaveLength(3);
                expect(liste.videos[2]).toMatchObject({title: "", startSeconds: null});
            });

            it("sans labels ni videos : titres vides", () => {
                const liste = parser.parseDefinition(def(urlListe));
                expect(liste.videos.map((v) => v.title)).toEqual(["", "", ""]);
            });

            it("avertit quand le nombre de titres ne correspond pas", () => {
                const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
                parser.parseDefinition(def(`${urlListe}&labels=A,B`));
                expect(warn).toHaveBeenCalledOnce();
                expect(warn.mock.calls[0][0]).toContain("2 labels for 3 videos");
            });

            it("n'avertit pas quand le compte est bon, ni sans labels", () => {
                const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
                parser.parseDefinition(def(`${urlListe}&labels=A,B,C`));
                parser.parseDefinition(def(urlListe));
                expect(warn).not.toHaveBeenCalled();
            });

            it("l'index de l'URL prime sur celui de la définition", () => {
                expect(parser.parseDefinition(def(`${urlListe}&index=2`, {index: 0})).index).toBe(2);
                expect(parser.parseDefinition(def(urlListe, {index: 1})).index).toBe(1);
            });

            it("l'autoplay d'une vidéo reprend celui de la définition, sauf valeur propre", () => {
                const liste = parser.parseDefinition(def(urlListe, {autoplay: "click", videos: [{autoplay: "init"}]}));
                expect(liste.videos[0].autoplay).toBe(AUTOPLAY_MODES.INIT);
                expect(liste.videos[1].autoplay).toBe(AUTOPLAY_MODES.CLICK);
            });

            it("copie les champs d'une vidéo de `videos`", () => {
                const liste = parser.parseDefinition(def(urlListe, {
                    videos: [{title: "T", description: "D", channel: "C", channelUrl: "u", thumbnail: "t", duration: "1m", start: "5", key: "k1", extra: 9}]
                }));
                expect(liste.videos[0]).toMatchObject({
                    title: "T", description: "D", channel: "C", channelUrl: "u", thumbnail: "t",
                    duration: 60, startSeconds: 5, key: "k1", extra: 9
                });
            });
        });
    });

    // -----------------------------------------------------------------------
    describe("buildUrl", () => {
        it("vidéo : /video/ID", () => {
            expect(parser.buildUrl({videoId: "123"})).toBe("https://ok.ru/video/123");
        });

        it("liste : utilise la première vidéo (OK.ru ne gère qu'une vidéo par URL)", () => {
            expect(parser.buildUrl({videoIds: ["5", "6"]})).toBe("https://ok.ru/video/5?video_ids=5,6");
        });

        it("playlist non supportée, définition absente ou sans vidéo => erreur", () => {
            expect(() => parser.buildUrl({playlistId: "PL1"})).toThrow("buildUrl(): playlists are not supported");
            expect(() => parser.buildUrl(undefined)).toThrow("buildUrl(): a definition object is required");
            expect(() => parser.buildUrl({})).toThrow("buildUrl(): either videoId or a non-empty videoIds array is required");
        });

        it("aller-retour : parseUrl relit l'URL construite", () => {
            expect(parser.parseUrl(parser.buildUrl({videoId: "123"}))).toMatchObject({kind: "video", videoId: "123"});
        });
    });
});