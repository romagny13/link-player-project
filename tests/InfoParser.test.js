import {afterEach, describe, expect, it, vi} from "vitest";
import {InfoParser} from "../src/providers/InfoParser.js";
import {YouTubeInfoParser} from "../src/providers/youtube/YouTubeInfoParser.js";
import {OkruInfoParser} from "../src/providers/okru/OkruInfoParser.js";
import {VideoInfo} from "../src/models/VideoInfo.js";
import {VideoListInfo} from "../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../src/models/PlaylistInfo.js";
import {AUTOPLAY_MODES} from "../src/utils/helpers.js";

// ───────── outils ─────────

/** Faux élément DOM : pas besoin de jsdom, le parser ne lit que ces propriétés. */
const element = (tagName, {href, src, dataset = {}, parentElement} = {}) => ({
    tagName, href, src, dataset, parentElement
});

/** Lit des getters d'un objet (les champs des modèles sont privés). */
const pick = (obj, ...keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

afterEach(() => vi.restoreAllMocks());

// ═════════════════════════════════════════════
// InfoParser (classe de base)
// ═════════════════════════════════════════════
describe("InfoParser", () => {
    const parser = new InfoParser();

    describe("getUrl", () => {
        it("lit href pour un lien <a>", () => {
            expect(parser.getUrl(element("A", {href: "https://a.test/x"}))).toBe("https://a.test/x");
        });

        it("lit src pour une <iframe>", () => {
            expect(parser.getUrl(element("IFRAME", {src: "https://a.test/embed"}))).toBe("https://a.test/embed");
        });

        it("lit data-url pour les autres éléments", () => {
            expect(parser.getUrl(element("DIV", {dataset: {url: "https://a.test/d"}}))).toBe("https://a.test/d");
        });

        it("renvoie undefined quand il n'y a aucune URL", () => {
            expect(parser.getUrl({tagName: "DIV"})).toBeUndefined();
        });
    });

    describe("parseTime", () => {
        it.each([
            ["120", 120],
            ["0", 0],
            ["90s", 90],
            ["2m", 120],
            ["1m30s", 90],
            ["1h2m3s", 3723],
            ["1H2M3S", 3723]
        ])("convertit %s en %i secondes", (input, expected) => {
            expect(parser.parseTime(input)).toBe(expected);
        });

        it.each([[undefined], [null], [""], ["abc"], ["1x"], ["h"], ["1m1h"]])(
            "renvoie undefined pour la valeur invalide %j",
            (input) => {
                expect(parser.parseTime(input)).toBeUndefined();
            }
        );
    });

    describe("parseJsonAttribute", () => {
        it("renvoie undefined quand l'attribut est absent", () => {
            expect(parser.parseJsonAttribute(undefined, "data-videos")).toBeUndefined();
        });

        it("parse un tableau JSON valide", () => {
            expect(parser.parseJsonAttribute('[{"videoId":"a"}]', "data-videos")).toEqual([{videoId: "a"}]);
        });

        it("lève une erreur explicite pour un JSON invalide", () => {
            expect(() => parser.parseJsonAttribute("[oups", "data-videos")).toThrow(/Invalid JSON in data-videos/);
        });

        it("lève une erreur quand le JSON n'est pas un tableau", () => {
            expect(() => parser.parseJsonAttribute('{"a":1}', "data-videos")).toThrow(/must be a JSON array/);
        });
    });

    describe("readLinkData", () => {
        it("lit les attributs data-* et convertit les types", () => {
            const el = element("A", {
                dataset: {
                    autoplay: "click",
                    start: "1m30s",
                    title: "Titre",
                    description: "Desc",
                    channel: "Chaîne",
                    channelUrl: "https://c.test",
                    thumbnail: "https://t.test/i.jpg",
                    duration: "5m",
                    videos: '[{"videoId":"a"}]',
                    index: "2",
                    target: "player",
                    showOnInit: "",
                    key: "ma-cle",
                    extra: "plus"
                }
            });

            expect(parser.readLinkData(el)).toEqual({
                autoplay: "click",
                start: "1m30s", // brut : parseTime le convertit plus tard
                title: "Titre",
                description: "Desc",
                channel: "Chaîne",
                channelUrl: "https://c.test",
                thumbnail: "https://t.test/i.jpg",
                duration: "5m",
                videos: [{videoId: "a"}],
                index: 2,
                target: "player",
                showOnInit: true,
                key: "ma-cle",
                extra: "plus"
            });
        });

        it("applique les valeurs par défaut quand les attributs sont absents", () => {
            const data = parser.readLinkData(element("A"));
            expect(data.videos).toEqual([]);
            expect(data.index).toBeUndefined();
            expect(data.showOnInit).toBe(false);
            expect(data.target).toBeUndefined();
        });

        it("prend l'id du parent comme cible pour une iframe sans data-target", () => {
            const el = element("IFRAME", {parentElement: {id: "zone"}});
            expect(parser.readLinkData(el).target).toBe("zone");
        });

        it("préfère data-target à l'id du parent", () => {
            const el = element("IFRAME", {dataset: {target: "autre"}, parentElement: {id: "zone"}});
            expect(parser.readLinkData(el).target).toBe("autre");
        });

        it("ne déduit pas la cible du parent pour un lien <a>", () => {
            const el = element("A", {parentElement: {id: "zone"}});
            expect(parser.readLinkData(el).target).toBeUndefined();
        });

        it("traite data-show-on-init=false comme faux", () => {
            expect(parser.readLinkData(element("A", {dataset: {showOnInit: "false"}})).showOnInit).toBe(false);
        });
    });

    describe("méthodes abstraites", () => {
        it.each([
            ["parseUrl", /parseUrl\(\) must be implemented/],
            ["buildUrl", /buildUrl\(\) must be implemented/],
            ["parseDefinition", /parseDefinition\(\) must be implemented/]
        ])("%s lève une erreur tant qu'elle n'est pas implémentée", (method, message) => {
            expect(() => parser[method]({})).toThrow(message);
        });
    });

    describe("parseFromElement (avec le parser YouTube)", () => {
        const yt = new YouTubeInfoParser();

        it("construit la définition depuis un lien <a> et ses data-*", () => {
            const el = element("A", {
                href: "https://www.youtube.com/watch?v=abc123",
                dataset: {target: "box", title: "Ma vidéo", start: "1m30s"}
            });
            const info = yt.parseFromElement(el);

            expect(info).toBeInstanceOf(VideoInfo);
            expect(pick(info, "videoId", "target", "title", "startSeconds"))
                .toEqual({videoId: "abc123", target: "box", title: "Ma vidéo", startSeconds: 90});
        });

        it("utilise le parent de l'iframe comme cible", () => {
            const el = element("IFRAME", {
                src: "https://www.youtube.com/embed/abc123",
                parentElement: {id: "zone"}
            });
            expect(yt.parseFromElement(el).target).toBe("zone");
        });

        it("gère une iframe d'embed avec ?playlist= (liste de vidéos)", () => {
            const el = element("IFRAME", {
                src: "https://www.youtube.com/embed/?playlist=z2sv_RsNwM4,-xiF9YIIUk4",
                parentElement: {id: "zone"}
            });
            const info = yt.parseFromElement(el);

            expect(info).toBeInstanceOf(VideoListInfo);
            expect(info.videoIds).toEqual(["z2sv_RsNwM4", "-xiF9YIIUk4"]);
        });

        it("lève une erreur quand l'élément n'a pas d'URL", () => {
            expect(() => yt.parseFromElement(element("DIV"))).toThrow(/No URL found/);
        });
    });
});

// ═════════════════════════════════════════════
// YouTubeInfoParser
// ═════════════════════════════════════════════
describe("YouTubeInfoParser", () => {
    const parser = new YouTubeInfoParser();

    describe("buildUrl", () => {
        it("lève une erreur sans définition", () => {
            expect(() => parser.buildUrl(null)).toThrow(TypeError);
        });

        it("construit l'URL d'une vidéo", () => {
            expect(parser.buildUrl({videoId: "abc"})).toBe("https://www.youtube.com/watch?v=abc");
        });

        it("ajoute le temps de départ", () => {
            const url = new URL(parser.buildUrl({videoId: "abc", start: "90"}));
            expect(url.searchParams.get("t")).toBe("90");
        });

        it("construit l'URL d'une playlist, avec ou sans vidéo de départ", () => {
            expect(parser.buildUrl({playlistId: "PL1"})).toBe("https://www.youtube.com/watch?list=PL1");
            const url = new URL(parser.buildUrl({playlistId: "PL1", videoId: "abc"}));
            expect(url.searchParams.get("list")).toBe("PL1");
            expect(url.searchParams.get("v")).toBe("abc");
        });

        it("construit l'URL d'une liste de vidéos avec index", () => {
            const url = new URL(parser.buildUrl({videoIds: ["a", "b"], index: 1}));
            expect(url.pathname).toBe("/watch_videos");
            expect(url.searchParams.get("video_ids")).toBe("a,b");
            expect(url.searchParams.get("index")).toBe("1");
        });

        it("garde un index égal à 0", () => {
            const url = new URL(parser.buildUrl({videoIds: ["a"], index: 0}));
            expect(url.searchParams.get("index")).toBe("0");
        });

        it("donne la priorité à la playlist sur la liste de vidéos", () => {
            const url = new URL(parser.buildUrl({playlistId: "PL1", videoIds: ["a"]}));
            expect(url.searchParams.get("list")).toBe("PL1");
            expect(url.searchParams.has("video_ids")).toBe(false);
        });

        it("lève une erreur quand rien ne permet de construire l'URL", () => {
            expect(() => parser.buildUrl({})).toThrow(TypeError);
        });
    });

    describe("parseUrl", () => {
        it.each([
            ["watch?v=", "https://www.youtube.com/watch?v=abc123"],
            ["youtu.be", "https://youtu.be/abc123"],
            ["/embed/", "https://www.youtube.com/embed/abc123"],
            ["/shorts/", "https://www.youtube.com/shorts/abc123"],
            ["/live/", "https://www.youtube.com/live/abc123"]
        ])("reconnaît une vidéo au format %s", (_, url) => {
            const info = parser.parseUrl(url);
            expect(pick(info, "kind", "videoId")).toEqual({kind: "video", videoId: "abc123"});
        });

        it("lit le temps de départ (t ou start)", () => {
            expect(parser.parseUrl("https://www.youtube.com/watch?v=a&t=1m30s").startSeconds).toBe(90);
            expect(parser.parseUrl("https://youtu.be/a?t=30").startSeconds).toBe(30);
            expect(parser.parseUrl("https://www.youtube.com/embed/a?start=45").startSeconds).toBe(45);
        });

        it("reconnaît une playlist avec vidéo de départ", () => {
            const info = parser.parseUrl("https://www.youtube.com/watch?v=abc&list=PL1");
            expect(pick(info, "kind", "playlistId", "videoId")).toEqual({kind: "playlist", playlistId: "PL1", videoId: "abc"});
        });

        it("reconnaît une playlist sans vidéo de départ", () => {
            const info = parser.parseUrl("https://www.youtube.com/playlist?list=PL1");
            expect(pick(info, "kind", "playlistId", "videoId")).toEqual({kind: "playlist", playlistId: "PL1", videoId: null});
        });

        it("ignore 'videoseries' comme identifiant de vidéo", () => {
            const info = parser.parseUrl("https://www.youtube.com/embed/videoseries?list=PL1");
            expect(pick(info, "kind", "playlistId", "videoId")).toEqual({kind: "playlist", playlistId: "PL1", videoId: null});
        });

        it("reconnaît une liste de vidéos watch_videos, avec nettoyage des espaces et valeurs vides", () => {
            const info = parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=a, b,,c&index=2");
            expect(pick(info, "kind", "videoIds", "index")).toEqual({kind: "videoList", videoIds: ["a", "b", "c"], index: 2});
        });

        it("renvoie null quand video_ids est vide", () => {
            expect(parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=,")).toBeNull();
        });

        it("reconnaît l'embed /embed/ID?playlist=b,c (l'ID du chemin passe en premier)", () => {
            const info = parser.parseUrl("https://www.youtube.com/embed/a?playlist=b,c");
            expect(pick(info, "kind", "videoIds")).toEqual({kind: "videoList", videoIds: ["a", "b", "c"]});
        });

        it("reconnaît l'embed sans ID dans le chemin : /embed/?playlist=a,b", () => {
            const info = parser.parseUrl("https://www.youtube.com/embed/?playlist=z2sv_RsNwM4,-xiF9YIIUk4");
            expect(pick(info, "kind", "videoIds")).toEqual({kind: "videoList", videoIds: ["z2sv_RsNwM4", "-xiF9YIIUk4"]});
        });

        it("ignore un index non numérique", () => {
            const info = parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=a,b&index=abc");
            expect(info.index).toBeUndefined();
        });

        it("lève une erreur quand l'URL ne contient ni vidéo ni playlist", () => {
            expect(() => parser.parseUrl("https://www.youtube.com/watch")).toThrow(/Invalid URL/);
        });

        it("lève une erreur pour une chaîne qui n'est pas une URL", () => {
            expect(() => parser.parseUrl("pas une url")).toThrow();
        });
    });

    describe("parseDefinition", () => {
        const base = {target: "player"};

        describe("vidéo seule", () => {
            it("construit un VideoInfo avec les valeurs par défaut", () => {
                const info = parser.parseDefinition({...base, url: "https://www.youtube.com/watch?v=abc123"});

                expect(info).toBeInstanceOf(VideoInfo);
                expect(pick(info, "provider", "target", "videoId", "autoplay", "title", "description", "channel", "channelUrl", "thumbnail", "key"))
                    .toEqual({
                        provider: "youtube",
                        target: "player",
                        videoId: "abc123",
                        autoplay: AUTOPLAY_MODES.NONE,
                        title: "",
                        description: "",
                        channel: "",
                        channelUrl: "",
                        thumbnail: thumb("abc123"),
                        key: "youtube:abc123"
                    });
                expect(info.isPlaylist).toBe(false);
            });

            it("utilise les métadonnées de la définition", () => {
                const info = parser.parseDefinition({
                    ...base,
                    url: "https://www.youtube.com/watch?v=abc123",
                    title: "Titre",
                    description: "Desc",
                    channel: "Chaîne",
                    channelUrl: "https://c.test",
                    thumbnail: "https://t.test/i.jpg",
                    duration: "1m",
                    autoplay: "click",
                    showOnInit: true,
                    key: "ma-cle",
                    extra: "plus"
                });

                expect(pick(info, "title", "description", "channel", "channelUrl", "thumbnail", "duration", "autoplay", "showOnInit", "key", "extra"))
                    .toEqual({
                        title: "Titre",
                        description: "Desc",
                        channel: "Chaîne",
                        channelUrl: "https://c.test",
                        thumbnail: "https://t.test/i.jpg",
                        duration: 60,
                        autoplay: AUTOPLAY_MODES.CLICK,
                        showOnInit: true,
                        key: "ma-cle",
                        extra: "plus"
                    });
            });

            it("convertit l'autoplay (vide = init)", () => {
                const url = "https://www.youtube.com/watch?v=abc123";
                expect(parser.parseDefinition({...base, url, autoplay: ""}).autoplay).toBe(AUTOPLAY_MODES.INIT);
                expect(parser.parseDefinition({...base, url, autoplay: "false"}).autoplay).toBe(AUTOPLAY_MODES.NONE);
            });

            it("prend le départ de l'URL, et celui de la définition s'il existe", () => {
                const url = "https://www.youtube.com/watch?v=abc123&t=30";
                expect(parser.parseDefinition({...base, url}).startSeconds).toBe(30);
                expect(parser.parseDefinition({...base, url, start: "1m"}).startSeconds).toBe(60);
            });

            it("lève une erreur sans cible", () => {
                expect(() => parser.parseDefinition({url: "https://www.youtube.com/watch?v=abc123"})).toThrow();
            });

            it("lève une erreur quand videos n'est pas un tableau", () => {
                expect(() => parser.parseDefinition({...base, url: "https://www.youtube.com/watch?v=a", videos: "x"}))
                    .toThrow(/videos must be an array/);
            });
        });

        describe("liste de vidéos", () => {
            const url = "https://www.youtube.com/watch_videos?video_ids=a,b,c";

            it("construit un VideoListInfo avec une vidéo par identifiant", () => {
                const list = parser.parseDefinition({...base, url});

                expect(list).toBeInstanceOf(VideoListInfo);
                expect(list.isPlaylist).toBe(true);
                expect(list.videoIds).toEqual(["a", "b", "c"]);
                expect(list.key).toBe("youtube:list:a,b,c");
                expect(list.videos.map((v) => v.videoId)).toEqual(["a", "b", "c"]);
                expect(list.videos.map((v) => v.thumbnail)).toEqual([thumb("a"), thumb("b"), thumb("c")]);
            });

            it("répartit les métadonnées de data-videos par position", () => {
                const list = parser.parseDefinition({
                    ...base,
                    url,
                    videos: [{title: "Un", duration: "30"}, {title: "Deux", thumbnail: "https://t.test/2.jpg"}]
                });

                expect(list.videos[0].title).toBe("Un");
                expect(list.videos[0].duration).toBe(30);
                expect(list.videos[1].thumbnail).toBe("https://t.test/2.jpg");
                expect(list.videos[2].title).toBe(""); // pas de métadonnées pour la troisième
            });

            it("reprend l'autoplay du lien quand la vidéo n'en précise pas", () => {
                const list = parser.parseDefinition({...base, url, autoplay: "click", videos: [{autoplay: ""}]});
                expect(list.videos[0].autoplay).toBe(AUTOPLAY_MODES.INIT);
                expect(list.videos[1].autoplay).toBe(AUTOPLAY_MODES.CLICK);
            });

            it("n'applique pas le start du lien aux vidéos de la liste", () => {
                const list = parser.parseDefinition({...base, url, start: "1m"});
                expect(list.videos.every((v) => v.startSeconds === undefined)).toBe(true);
            });

            it("donne la priorité à l'index de l'URL, sinon celui de la définition", () => {
                expect(parser.parseDefinition({...base, url: `${url}&index=2`, index: 1}).index).toBe(2);
                expect(parser.parseDefinition({...base, url, index: 1}).index).toBe(1);
            });

            it("accepte une iframe d'embed ?playlist= sans ID dans le chemin", () => {
                const list = parser.parseDefinition({
                    ...base,
                    url: "https://www.youtube.com/embed/?playlist=z2sv_RsNwM4,-xiF9YIIUk4"
                });
                expect(list.videoIds).toEqual(["z2sv_RsNwM4", "-xiF9YIIUk4"]);
            });
        });

        describe("playlist", () => {
            const url = "https://www.youtube.com/playlist?list=PL1";

            it("construit un PlaylistInfo", () => {
                const playlist = parser.parseDefinition({...base, url, showOnInit: true});

                expect(playlist).toBeInstanceOf(PlaylistInfo);
                expect(playlist.isPlaylist).toBe(true);
                expect(pick(playlist, "provider", "target", "playlistId", "videoId", "showOnInit", "key"))
                    .toEqual({
                        provider: "youtube",
                        target: "player",
                        playlistId: "PL1",
                        videoId: null,
                        showOnInit: true,
                        key: "youtube:playlist:PL1"
                    });
                expect(playlist.videos).toEqual([]);
            });

            it("garde la vidéo de départ", () => {
                const playlist = parser.parseDefinition({...base, url: "https://www.youtube.com/watch?v=abc&list=PL1"});
                expect(playlist.videoId).toBe("abc");
            });

            it("construit les vidéos de repli depuis data-videos", () => {
                const playlist = parser.parseDefinition({
                    ...base,
                    url,
                    videos: [{videoId: "v1", title: "Un", duration: "1m", thumbnail: "https://t.test/1.jpg"}, {videoId: "v2"}]
                });

                expect(playlist.videos).toHaveLength(2);
                expect(pick(playlist.videos[0], "videoId", "title", "duration", "thumbnail", "autoplay"))
                    .toEqual({videoId: "v1", title: "Un", duration: 60, thumbnail: "https://t.test/1.jpg", autoplay: AUTOPLAY_MODES.NONE});
                expect(playlist.videos[1].title).toBe("");
            });

            // ⚠ Échoue tant que le code lit `v.id` au lieu de `v.videoId` pour la miniature par défaut.
            it("génère la miniature par défaut d'une vidéo de repli à partir de son videoId", () => {
                const playlist = parser.parseDefinition({...base, url, videos: [{videoId: "v1"}]});
                expect(playlist.videos[0].thumbnail).toBe(thumb("v1"));
            });
        });

        it("lève une erreur quand l'URL est invalide", () => {
            expect(() => parser.parseDefinition({...base, url: "https://www.youtube.com/watch"})).toThrow();
        });
    });

    describe("miniatures personnalisées", () => {
        it("utilise le constructeur de miniatures injecté", () => {
            const custom = new YouTubeInfoParser({thumbnailUrlBuilder: {getThumbnailUrl: (id) => `custom/${id}`}});
            const info = custom.parseDefinition({target: "p", url: "https://www.youtube.com/watch?v=abc"});
            expect(info.thumbnail).toBe("custom/abc");
        });
    });
});

// ═════════════════════════════════════════════
// OkruInfoParser
// ═════════════════════════════════════════════
describe("OkruInfoParser", () => {
    const parser = new OkruInfoParser();

    describe("parseUrl", () => {
        it.each([
            ["/video/", "https://ok.ru/video/123456"],
            ["/videoembed/", "https://ok.ru/videoembed/123456"]
        ])("reconnaît une vidéo au format %s", (_, url) => {
            const info = parser.parseUrl(url);
            expect(pick(info, "kind", "videoId")).toEqual({kind: "video", videoId: "123456"});
        });

        it("renvoie null pour une chaîne qui n'est pas une URL", () => {
            expect(parser.parseUrl("pas une url")).toBeNull();
        });

        it("renvoie null quand le chemin n'est pas une vidéo", () => {
            expect(parser.parseUrl("https://ok.ru/profile/123")).toBeNull();
            expect(parser.parseUrl("https://ok.ru/video/abc")).toBeNull(); // identifiant non numérique
        });

        it("reconnaît une liste de vidéos avec index", () => {
            const info = parser.parseUrl("https://ok.ru/video?video_ids=111,222,333&index=1");
            expect(pick(info, "kind", "videoIds", "index", "labels"))
                .toEqual({kind: "videoList", videoIds: ["111", "222", "333"], index: 1, labels: []});
        });

        it("ignore les valeurs vides dans video_ids", () => {
            const info = parser.parseUrl("https://ok.ru/video?video_ids=111,,222");
            expect(info.videoIds).toEqual(["111", "222"]);
        });

        it("renvoie null quand video_ids est vide", () => {
            expect(parser.parseUrl("https://ok.ru/video?video_ids=")).toBeNull();
        });

        it("lit les titres de labels= et les décode", () => {
            const info = parser.parseUrl("https://ok.ru/video?video_ids=1,2&labels=Titre%20un,Titre%20deux");
            expect(info.labels).toEqual(["Titre un", "Titre deux"]);
        });

        it("sépare les titres AVANT de décoder : %2C reste une virgule du titre", () => {
            const info = parser.parseUrl("https://ok.ru/video?video_ids=1,2&labels=Un%2C%20deux,Trois");
            expect(info.labels).toEqual(["Un, deux", "Trois"]);
        });

        it("garde la position d'un titre vide", () => {
            const info = parser.parseUrl("https://ok.ru/video?video_ids=1,2,3&labels=A,,C");
            expect(info.labels).toEqual(["A", "", "C"]);
        });

        it("garde tel quel un titre mal encodé", () => {
            const info = parser.parseUrl("https://ok.ru/video?video_ids=1&labels=100%");
            expect(info.labels).toEqual(["100%"]);
        });

        it("ignore un index non numérique", () => {
            expect(parser.parseUrl("https://ok.ru/video?video_ids=1,2&index=x").index).toBeUndefined();
        });
    });

    describe("buildUrl", () => {
        it("lève une erreur sans définition", () => {
            expect(() => parser.buildUrl(null)).toThrow(TypeError);
        });

        it("refuse les playlists", () => {
            expect(() => parser.buildUrl({playlistId: "PL1"})).toThrow(/playlist not supported/);
        });

        it("construit l'URL d'une vidéo", () => {
            expect(parser.buildUrl({videoId: "123"})).toBe("https://ok.ru/video/123");
        });

        it("utilise la première vidéo d'une liste", () => {
            expect(parser.buildUrl({videoIds: ["111", "222"]})).toBe("https://ok.ru/video/111");
        });

        it("lève une erreur sans identifiant", () => {
            expect(() => parser.buildUrl({})).toThrow(TypeError);
        });
    });

    describe("parseDefinition", () => {
        const base = {target: "player"};

        it("lève une erreur quand l'URL est invalide", () => {
            expect(() => parser.parseDefinition({...base, url: "pas une url"})).toThrow(/Invalid URL/);
        });

        it("lève une erreur quand videos n'est pas un tableau", () => {
            expect(() => parser.parseDefinition({...base, url: "https://ok.ru/video/1", videos: "x"}))
                .toThrow(/videos must be an array/);
        });

        describe("vidéo seule", () => {
            it("construit un VideoInfo avec les valeurs par défaut", () => {
                const info = parser.parseDefinition({...base, url: "https://ok.ru/video/123456"});

                expect(info).toBeInstanceOf(VideoInfo);
                expect(pick(info, "provider", "target", "videoId", "autoplay", "title", "thumbnail", "key"))
                    .toEqual({
                        provider: "okru",
                        target: "player",
                        videoId: "123456",
                        autoplay: AUTOPLAY_MODES.NONE,
                        title: "",
                        thumbnail: "", // pas de miniature générée pour ok.ru
                        key: "okru:123456"
                    });
            });

            it("utilise les métadonnées de la définition", () => {
                const info = parser.parseDefinition({
                    ...base,
                    url: "https://ok.ru/video/123456",
                    title: "Titre",
                    channel: "Chaîne",
                    start: "1m30s",
                    duration: "5m",
                    autoplay: "",
                    key: "ma-cle"
                });

                expect(pick(info, "title", "channel", "startSeconds", "duration", "autoplay", "key"))
                    .toEqual({title: "Titre", channel: "Chaîne", startSeconds: 90, duration: 300, autoplay: AUTOPLAY_MODES.INIT, key: "ma-cle"});
            });
        });

        describe("liste de vidéos", () => {
            const url = "https://ok.ru/video?video_ids=111,222,333";

            it("construit un VideoListInfo avec une vidéo par identifiant", () => {
                const list = parser.parseDefinition({...base, url});

                expect(list).toBeInstanceOf(VideoListInfo);
                expect(list.isPlaylist).toBe(true);
                expect(list.videoIds).toEqual(["111", "222", "333"]);
                expect(list.key).toBe("okru:list:111,222,333");
                expect(list.videos.map((v) => v.provider)).toEqual(["okru", "okru", "okru"]);
            });

            it("utilise labels= de l'URL comme titres", () => {
                const list = parser.parseDefinition({...base, url: `${url}&labels=Un,Deux,Trois`});
                expect(list.videos.map((v) => v.title)).toEqual(["Un", "Deux", "Trois"]);
            });

            it("donne la priorité à data-videos sur labels=", () => {
                const list = parser.parseDefinition({
                    ...base,
                    url: `${url}&labels=Un,Deux,Trois`,
                    videos: [{title: "A"}, {title: "B"}, {title: "C"}]
                });
                expect(list.videos.map((v) => v.title)).toEqual(["A", "B", "C"]);
            });

            it("laisse un titre vide quand data-videos est plus court que la liste", () => {
                const list = parser.parseDefinition({...base, url, videos: [{title: "A"}]});
                expect(list.videos.map((v) => v.title)).toEqual(["A", "", ""]);
            });

            it("avertit quand le nombre de labels ne correspond pas au nombre de vidéos", () => {
                const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
                parser.parseDefinition({...base, url: `${url}&labels=Un,Deux`});
                expect(warn).toHaveBeenCalledOnce();
            });

            it("n'avertit pas quand les labels correspondent ou sont absents", () => {
                const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
                parser.parseDefinition({...base, url: `${url}&labels=Un,Deux,Trois`});
                parser.parseDefinition({...base, url});
                expect(warn).not.toHaveBeenCalled();
            });

            it("reprend l'autoplay du lien quand la vidéo n'en précise pas", () => {
                const list = parser.parseDefinition({...base, url, autoplay: "click", videos: [{autoplay: ""}]});
                expect(list.videos[0].autoplay).toBe(AUTOPLAY_MODES.INIT);
                expect(list.videos[1].autoplay).toBe(AUTOPLAY_MODES.CLICK);
            });

            it("donne la priorité à l'index de l'URL, sinon celui de la définition", () => {
                expect(parser.parseDefinition({...base, url: `${url}&index=2`, index: 1}).index).toBe(2);
                expect(parser.parseDefinition({...base, url, index: 1}).index).toBe(1);
            });
        });
    });
});