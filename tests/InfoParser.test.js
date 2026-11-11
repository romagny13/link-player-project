import {afterEach, describe, expect, it, vi} from "vitest";

import {YouTubeInfoParser} from "../src/providers/youtube/YouTubeInfoParser.js";
import {YouTubeThumbnailUrlBuilder} from "../src/providers/youtube/YouTubeThumbnailUrlBuilder.js";
import {OkruInfoParser} from "../src/providers/okru/OkruInfoParser.js";
import {InfoParser} from "../src/providers/InfoParser.js";
import {VideoInfo} from "../src/models/VideoInfo.js";
import {VideoListInfo} from "../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../src/models/PlaylistInfo.js";

/* -------------------------------------------------------------------------- */
/* Outils de test : faux éléments DOM, instantanés, vignettes                  */
/* -------------------------------------------------------------------------- */

/** <a href=url data-*> */
const anchor = (url, dataset = {}) => ({tagName: "A", href: url, dataset});
/** <iframe src=url data-*> dans un parent d'id `parentId` */
const iframe = (url, dataset = {}, parentId) => ({
    tagName: "IFRAME",
    src: url,
    dataset,
    parentElement: parentId ? {id: parentId} : undefined
});
/** <div data-url=url data-*> */
const div = (url, dataset = {}) => ({tagName: "DIV", dataset: {...(url ? {url} : {}), ...dataset}});

const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/**
 * Les champs des modèles sont privés (#champ) : `toEqual` sur deux instances ne compare rien.
 * On compare donc des instantanés construits avec les getters.
 */
const snap = (v) => ({
    key: v.key,
    provider: v.provider,
    target: v.target,
    videoId: v.videoId,
    autoplay: v.autoplay,
    startSeconds: v.startSeconds,
    title: v.title,
    channel: v.channel,
    thumbnail: v.thumbnail,
    showOnInit: v.showOnInit
});
const snapList = (l) => ({
    key: l.key,
    provider: l.provider,
    target: l.target,
    videoIds: l.videoIds,
    index: l.index,
    showOnInit: l.showOnInit,
    videos: l.videos.map(snap)
});
const snapPlaylist = (p) => ({
    key: p.key,
    provider: p.provider,
    target: p.target,
    playlistId: p.playlistId,
    videoId: p.videoId,
    showOnInit: p.showOnInit,
    videos: p.videos.map(snap)
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* YouTubeThumbnailUrlBuilder                                                  */
/* -------------------------------------------------------------------------- */

describe("YouTubeThumbnailUrlBuilder", () => {
    it("construit l'URL mqdefault", () => {
        expect(new YouTubeThumbnailUrlBuilder().getThumbnailUrl("abc123"))
            .toBe("https://i.ytimg.com/vi/abc123/mqdefault.jpg");
    });

    it("lève une erreur si l'id est vide", () => {
        const b = new YouTubeThumbnailUrlBuilder();
        expect(() => b.getThumbnailUrl("")).toThrow();
        expect(() => b.getThumbnailUrl(null)).toThrow();
    });
});

/* -------------------------------------------------------------------------- */
/* InfoParser (classe de base)                                                 */
/* -------------------------------------------------------------------------- */

describe("InfoParser", () => {
    const parser = new InfoParser();

    describe("classe abstraite", () => {
        it("parseDefinition doit être implémenté par les classes filles", () => {
            expect(() => parser.parseDefinition({})).toThrow("must be implemented");
        });

        it("parseFromElement lève « No URL found » sans URL", () => {
            expect(() => parser.parseFromElement(div(null))).toThrow(/No URL found/);
        });

        it("parseFromElement délègue à parseDefinition avec l'url et les données du lien", () => {
            const child = new InfoParser();
            child.parseDefinition = vi.fn(() => "résultat");
            const result = child.parseFromElement(anchor("https://x.test/a", {target: "p", title: "T", start: "90"}));

            expect(result).toBe("résultat");
            expect(child.parseDefinition).toHaveBeenCalledTimes(1);
            expect(child.parseDefinition.mock.calls[0][0]).toMatchObject({
                url: "https://x.test/a",
                target: "p",
                title: "T",
                start: "90"
            });
        });
    });

    describe("getUrl", () => {
        it("lit href pour un <a>", () => {
            expect(parser.getUrl(anchor("https://x.test/a"))).toBe("https://x.test/a");
        });
        it("lit src pour un <iframe>", () => {
            expect(parser.getUrl(iframe("https://x.test/i"))).toBe("https://x.test/i");
        });
        it("lit data-url pour les autres éléments", () => {
            expect(parser.getUrl(div("https://x.test/d"))).toBe("https://x.test/d");
        });
        it("retourne undefined sans data-url ni dataset", () => {
            expect(parser.getUrl(div(null))).toBeUndefined();
            expect(parser.getUrl({tagName: "SPAN"})).toBeUndefined();
        });
    });

    describe("parseStartTime", () => {
        it.each([
            ["90", 90],
            ["0", 0],
            ["1m30s", 90],
            ["1h", 3600],
            ["0h", 0],
            ["1h2m3s", 3723],
            ["2M", 120],
            ["45s", 45],
        ])("parseStartTime(%j) -> %j", (entree, attendu) => {
            expect(parser.parseStartTime(entree)).toBe(attendu);
        });

        it.each([[undefined], [null], [""], ["abc"], ["1x"], ["1h30"], ["-5"]])(
            "parseStartTime(%j) -> undefined",
            (entree) => {
                expect(parser.parseStartTime(entree)).toBeUndefined();
            }
        );
    });

    describe("parseJsonAttribute", () => {
        it("retourne undefined si la valeur est undefined", () => {
            expect(parser.parseJsonAttribute(undefined, "data-videos")).toBeUndefined();
        });
        it("parse un tableau JSON", () => {
            expect(parser.parseJsonAttribute('[{"videoId":"a"}]', "data-videos")).toEqual([{videoId: "a"}]);
        });
        it("lève une erreur sur un JSON invalide, en nommant l'attribut", () => {
            expect(() => parser.parseJsonAttribute("{oops", "data-videos"))
                .toThrow(/Invalid JSON in data-videos/);
        });
        it("lève une erreur si ce n'est pas un tableau", () => {
            expect(() => parser.parseJsonAttribute('{"a":1}', "data-videos"))
                .toThrow("data-videos must be a JSON array");
        });
    });

    describe("readLinkData", () => {
        it("lit et convertit les data-*", () => {
            const data = parser.readLinkData(anchor("u", {
                autoplay: "click",
                start: "1m30s",
                title: "T",
                channel: "C",
                thumbnail: "th",
                videos: '[{"videoId":"a"}]',
                index: "3",
                target: "box",
                showOnInit: "",
                key: "k"
            }));
            expect(data).toEqual({
                autoplay: "click",
                start: "1m30s",
                title: "T",
                channel: "C",
                thumbnail: "th",
                videos: [{videoId: "a"}],
                index: 3,
                target: "box",
                showOnInit: true,
                key: "k"
            });
        });

        it("valeurs par défaut", () => {
            const data = parser.readLinkData(anchor("u"));
            expect(data.videos).toEqual([]);
            expect(data.index).toBeUndefined();
            expect(data.target).toBeUndefined();
            expect(data.showOnInit).toBe(false);
        });

        it("target retombe sur l'id du parent pour un <iframe>", () => {
            expect(parser.readLinkData(iframe("u", {}, "wrapper")).target).toBe("wrapper");
        });

        it("data-target prime sur le parent de l'iframe", () => {
            expect(parser.readLinkData(iframe("u", {target: "explicit"}, "wrapper")).target).toBe("explicit");
        });

        it("ne plante pas pour un iframe sans parent", () => {
            expect(parser.readLinkData(iframe("u", {})).target).toBeUndefined();
        });

        it("propage l'erreur d'un data-videos invalide", () => {
            expect(() => parser.readLinkData(anchor("u", {videos: "nope"}))).toThrow(/Invalid JSON/);
        });
    });
});

/* -------------------------------------------------------------------------- */
/* YouTubeInfoParser                                                           */
/* -------------------------------------------------------------------------- */

describe("YouTubeInfoParser", () => {
    const parser = new YouTubeInfoParser();

    describe("parseUrl", () => {
        describe("vidéo simple", () => {
            it.each([
                ["https://www.youtube.com/watch?v=abc123", "abc123"],
                ["https://youtube.com/watch?v=abc_-123", "abc_-123"],
                ["https://youtu.be/abc123", "abc123"],
                ["https://www.youtu.be/abc123", "abc123"],
                ["https://www.youtube.com/embed/abc123", "abc123"],
                ["https://www.youtube.com/shorts/abc123", "abc123"],
                ["https://www.youtube.com/live/abc123", "abc123"],
            ])("%s -> %s", (url, id) => {
                const info = parser.parseUrl(url);
                expect(info.kind).toBe("video");
                expect(info.videoId).toBe(id);
            });

            it.each([
                ["https://www.youtube.com/watch?v=a&t=90", 90],
                ["https://www.youtube.com/watch?v=a&t=1m30s", 90],
                ["https://www.youtube.com/watch?v=a&start=45", 45],
                ["https://youtu.be/a?t=1h", 3600],
            ])("temps de départ %s -> %s", (url, secondes) => {
                expect(parser.parseUrl(url).startSeconds).toBe(secondes);
            });

            it("t prime sur start", () => {
                expect(parser.parseUrl("https://youtube.com/watch?v=a&t=10&start=20").startSeconds).toBe(10);
            });

            it("pas de temps de départ -> undefined", () => {
                expect(parser.parseUrl("https://youtube.com/watch?v=a").startSeconds).toBeUndefined();
            });

            it("v= prime sur le chemin", () => {
                expect(parser.parseUrl("https://youtube.com/embed/path?v=query").videoId).toBe("query");
            });
        });

        describe("playlist", () => {
            const url = "https://youtube.com/watch?v=abc&list=PL1";
        
            it("crée un PlaylistInfo sans vidéos si data-videos est absent", () => {
                const p = parser.parseFromElement(anchor(url, {target: "p", showOnInit: "true", key: "k"}));
                expect(p).toBeInstanceOf(PlaylistInfo);
                expect(p.playlistId).toBe("PL1");
                expect(p.videoId).toBe("abc");
                expect(p.showOnInit).toBe(true);
                expect(p.key).toBe("k");
                expect(p.videos).toHaveLength(0);
            });
        
            it("clé par défaut", () => {
                expect(parser.parseFromElement(anchor(url, {target: "p"})).key).toBe("youtube:playlist:PL1");
            });
        
            it("data-videos fournit les vidéos de secours (champ videoId)", () => {
                const videos = JSON.stringify([
                    {videoId: "x", title: "X", channel: "CX", autoplay: "", start: "1m"},
                    {videoId: "y"}
                ]);
                const p = parser.parseFromElement(anchor(url, {target: "p", videos}));
                expect(p.videos).toHaveLength(2);
                expect(p.videos[0]).toMatchObject({
                    videoId: "x", title: "X", channel: "CX", autoplay: "init", startSeconds: 60
                });
                expect(p.videos[0].title).toBe("X");
            });
        
            it("une entrée data-videos sans videoId lève une erreur", () => {
                expect(() =>
                    parser.parseFromElement(anchor(url, {target: "p", videos: '[{"title":"sans id"}]'}))
                ).toThrow(/videoId/);
            });
        });

        describe("liste de vidéos", () => {
            it("video_ids=a,b,c (trim + filtre les vides)", () => {
                const info = parser.parseUrl("https://youtube.com/?video_ids=a, b ,,c&index=1");
                expect(info.kind).toBe("videoList");
                expect(info.videoIds).toEqual(["a", "b", "c"]);
                expect(info.index).toBe(1);
            });

            it("video_ids vide -> null", () => {
                expect(parser.parseUrl("https://youtube.com/?video_ids=")).toBeNull();
                expect(parser.parseUrl("https://youtube.com/?video_ids=,, ")).toBeNull();
            });

            it("video_ids prime sur tout le reste", () => {
                const info = parser.parseUrl("https://youtube.com/watch?v=x&list=PL&video_ids=a,b");
                expect(info.kind).toBe("videoList");
                expect(info.videoIds).toEqual(["a", "b"]);
            });

            it("/embed/ID?playlist=b,c -> [ID, b, c]", () => {
                const info = parser.parseUrl("https://youtube.com/embed/a?playlist=b,c&index=2");
                expect(info.kind).toBe("videoList");
                expect(info.videoIds).toEqual(["a", "b", "c"]);
                expect(info.index).toBe(2);
            });

            it("playlist= sans vidéo de départ", () => {
                const info = parser.parseUrl("https://youtube.com/watch?playlist=b,c");
                expect(info.videoIds).toEqual(["b", "c"]);
            });

            it("playlist= vide -> retombe sur la vidéo simple", () => {
                const info = parser.parseUrl("https://youtube.com/embed/a?playlist=");
                expect(info.kind).toBe("video");
                expect(info.videoId).toBe("a");
            });
        });

        describe("erreurs", () => {
            it("lève une erreur si aucun id de vidéo ni de playlist", () => {
                expect(() => parser.parseUrl("https://youtube.com/")).toThrow(/Invalid URL: no video or playlist id/);
            });

            it("/embed/videoseries sans list -> lève une erreur", () => {
                expect(() => parser.parseUrl("https://youtube.com/embed/videoseries")).toThrow();
            });

            it("URL malformée -> lève une erreur (TypeError de URL)", () => {
                expect(() => parser.parseUrl("pas une url")).toThrow();
            });
        });
    });

    describe("buildUrl", () => {
        it.each([
            [{videoId: "abc"}, "https://www.youtube.com/watch?v=abc"],
            [{videoId: "abc", start: 90}, "https://www.youtube.com/watch?v=abc&t=90"],
            [{playlistId: "PL1"}, "https://www.youtube.com/watch?list=PL1"],
            [{playlistId: "PL1", videoId: "abc"}, "https://www.youtube.com/watch?list=PL1&v=abc"],
            [{videoIds: ["a", "b"], index: 0}, "https://www.youtube.com/watch_videos?video_ids=a%2Cb&index=0"],
            [{videoIds: ["a", "b"]}, "https://www.youtube.com/watch_videos?video_ids=a%2Cb"],
        ])("%j -> %s", (def, url) => {
            expect(parser.buildUrl(def)).toBe(url);
        });

        it("playlistId prime sur videoIds, qui prime sur videoId", () => {
            expect(parser.buildUrl({playlistId: "P", videoIds: ["a"], videoId: "v"})).toContain("list=P");
            expect(parser.buildUrl({videoIds: ["a"], videoId: "v"})).toContain("video_ids=a");
        });

        it("lève une TypeError sans définition", () => {
            expect(() => parser.buildUrl()).toThrow(TypeError);
        });

        it("lève une TypeError sans aucun id", () => {
            expect(() => parser.buildUrl({})).toThrow("need playlistId");
        });

        it("l'URL construite se relit à l'identique", () => {
            const info = parser.parseUrl(parser.buildUrl({videoIds: ["a", "b"], index: 1}));
            expect([info.kind, info.videoIds, info.index]).toEqual(["videoList", ["a", "b"], 1]);

            const playlist = parser.parseUrl(parser.buildUrl({playlistId: "PL1", videoId: "abc"}));
            expect([playlist.kind, playlist.playlistId, playlist.videoId]).toEqual(["playlist", "PL1", "abc"]);
        });
    });

    describe("parseFromElement(element)", () => {
        describe("erreurs", () => {
            it("lève une erreur si aucune URL", () => {
                expect(() => parser.parseFromElement(div(null))).toThrow(/No URL found/);
            });

            it("lève une erreur si video_ids est vide (parseUrl -> null)", () => {
                expect(() => parser.parseFromElement(anchor("https://youtube.com/?video_ids=", {target: "p"})))
                    .toThrow(/Invalid URL/);
            });
        });

        describe("vidéo", () => {
            it("construit un VideoInfo avec les valeurs par défaut", () => {
                const v = parser.parseFromElement(anchor("https://youtube.com/watch?v=abc", {target: "player"}));
                expect(v).toBeInstanceOf(VideoInfo);
                expect(v).toMatchObject({
                    provider: "youtube",
                    target: "player",
                    videoId: "abc",
                    autoplay: "none",
                    startSeconds: undefined,
                    title: "",
                    channel: "",
                    thumbnail: thumb("abc"),
                    showOnInit: false,
                    key: "youtube:abc"
                });
            });

            it("utilise les data-* fournis", () => {
                const v = parser.parseFromElement(anchor("https://youtube.com/watch?v=abc", {
                    target: "player",
                    autoplay: "click",
                    title: "Titre",
                    channel: "Chaîne",
                    thumbnail: "custom.jpg",
                    showOnInit: "",
                    key: "ma-cle"
                }));
                expect(v).toMatchObject({
                    autoplay: "click",
                    title: "Titre",
                    channel: "Chaîne",
                    thumbnail: "custom.jpg",
                    showOnInit: true,
                    key: "ma-cle"
                });
            });

            it("départ : l'URL est utilisée, data-start la surcharge", () => {
                const url = "https://youtube.com/watch?v=abc&t=30";
                expect(parser.parseFromElement(anchor(url, {target: "p"})).startSeconds).toBe(30);
                expect(parser.parseFromElement(anchor(url, {target: "p", start: "1m"})).startSeconds).toBe(60);
            });

            it("fonctionne avec un <iframe> (target = id du parent)", () => {
                const v = parser.parseFromElement(iframe("https://youtube.com/embed/abc", {}, "wrapper"));
                expect(v.videoId).toBe("abc");
                expect(v.target).toBe("wrapper");
            });

            it("fonctionne avec data-url", () => {
                const v = parser.parseFromElement(div("https://youtu.be/abc", {target: "p"}));
                expect(v.videoId).toBe("abc");
            });

            it("lève une erreur si target est absent (validation du modèle)", () => {
                expect(() => parser.parseFromElement(anchor("https://youtube.com/watch?v=abc"))).toThrow();
            });
        });

        describe("liste de vidéos", () => {
            const url = "https://youtube.com/?video_ids=a,b&index=1";

            it("crée un VideoListInfo avec une vidéo par id", () => {
                const list = parser.parseFromElement(anchor(url, {target: "p", showOnInit: "", key: "k"}));
                expect(list).toBeInstanceOf(VideoListInfo);
                expect(list.isPlaylist).toBe(true);
                expect(list.provider).toBe("youtube");
                expect(list.videoIds).toEqual(["a", "b"]);
                expect(list.index).toBe(1);
                expect(list.showOnInit).toBe(true);
                expect(list.key).toBe("k");
                expect(list.videos.map((v) => v.videoId)).toEqual(["a", "b"]);
                expect(list.videos[0].thumbnail).toBe(thumb("a"));
                expect(list.videos[0].title).toBe("");
            });

            it("data-videos est lu par position", () => {
                const videos = JSON.stringify([
                    {title: "A", channel: "CA", thumbnail: "a.jpg", autoplay: "click", start: "10"},
                    {title: "B"}
                ]);
                const list = parser.parseFromElement(anchor(url, {target: "p", videos}));
                expect(list.videos[0]).toMatchObject({
                    title: "A", channel: "CA", thumbnail: "a.jpg", autoplay: "click", startSeconds: 10
                });
                expect(list.videos[1]).toMatchObject({
                    title: "B", thumbnail: thumb("b"), autoplay: "none"
                });
            });

            it("data-videos plus court que la liste : les manquants ont les valeurs par défaut", () => {
                const list = parser.parseFromElement(anchor(url, {target: "p", videos: '[{"title":"A"}]'}));
                expect(list.videos).toHaveLength(2);
                expect(list.videos[1].title).toBe("");
            });

            it("autoplay : la vidéo prime, sinon data-autoplay du lien", () => {
                const videos = JSON.stringify([{autoplay: "click"}, {}]);
                const list = parser.parseFromElement(anchor(url, {target: "p", autoplay: "", videos}));
                expect(list.videos.map((v) => v.autoplay)).toEqual(["click", "init"]);
            });

            it("data-start ne s'applique pas à toutes les vidéos de la liste", () => {
                const list = parser.parseFromElement(anchor(url, {target: "p", start: "20"}));
                expect(list.videos.map((v) => v.startSeconds)).toEqual([undefined, undefined]);
            });

            it("index : celui de l'URL, sinon data-index", () => {
                expect(parser.parseFromElement(anchor(url, {target: "p", index: "5"})).index).toBe(1);
                const sansIndex = "https://youtube.com/?video_ids=a,b";
                expect(parser.parseFromElement(anchor(sansIndex, {target: "p", index: "1"})).index).toBe(1);
                expect(parser.parseFromElement(anchor(sansIndex, {target: "p"})).index).toBeUndefined();
            });

            it("forme embed ?playlist=", () => {
                const list = parser.parseFromElement(iframe("https://youtube.com/embed/a?playlist=b,c", {}, "w"));
                expect(list.videoIds).toEqual(["a", "b", "c"]);
                expect(list.target).toBe("w");
            });
        });

        describe("playlist", () => {
            const url = "https://youtube.com/watch?v=abc&list=PL1";

            it("crée un PlaylistInfo sans vidéos si data-videos est absent", () => {
                const p = parser.parseFromElement(anchor(url, {target: "p", showOnInit: "true", key: "k"}));
                expect(p).toBeInstanceOf(PlaylistInfo);
                expect(p.playlistId).toBe("PL1");
                expect(p.videoId).toBe("abc");
                expect(p.showOnInit).toBe(true);
                expect(p.key).toBe("k");
                expect(p.videos).toHaveLength(0);
            });

            it("clé par défaut", () => {
                expect(parser.parseFromElement(anchor(url, {target: "p"})).key).toBe("youtube:playlist:PL1");
            });

        });

        describe("thumbnailUrlBuilder injectable", () => {
            it("utilise le builder fourni", () => {
                const builder = {getThumbnailUrl: vi.fn((id) => `cdn://${id}`)};
                const custom = new YouTubeInfoParser({thumbnailUrlBuilder: builder});
                const v = custom.parseFromElement(anchor("https://youtube.com/watch?v=abc", {target: "p"}));
                expect(builder.getThumbnailUrl).toHaveBeenCalledWith("abc");
                expect(v.thumbnail).toBe("cdn://abc");
            });

            it("data-thumbnail évite l'appel au builder", () => {
                const builder = {getThumbnailUrl: vi.fn()};
                const custom = new YouTubeInfoParser({thumbnailUrlBuilder: builder});
                custom.parseFromElement(anchor("https://youtube.com/watch?v=abc", {target: "p", thumbnail: "t.jpg"}));
                expect(builder.getThumbnailUrl).not.toHaveBeenCalled();
            });
        });

        it("un data-videos invalide lève une erreur explicite", () => {
            expect(() => parser.parseFromElement(anchor("https://youtube.com/watch?v=a", {target: "p", videos: "nope"})))
                .toThrow(/Invalid JSON in data-videos/);
        });
    });
});

/* -------------------------------------------------------------------------- */
/* OkruInfoParser                                                              */
/* -------------------------------------------------------------------------- */

describe("OkruInfoParser", () => {
    const parser = new OkruInfoParser();

    describe("parseUrl", () => {
        describe("vidéo simple", () => {
            it.each([
                ["https://ok.ru/video/12345", "12345"],
                ["https://ok.ru/videoembed/12345", "12345"],
                ["https://ok.ru/video/12345?autoplay=1", "12345"],
                ["https://m.ok.ru/video/98765", "98765"],
            ])("%s -> %s", (url, id) => {
                const info = parser.parseUrl(url);
                expect(info.kind).toBe("video");
                expect(info.videoId).toBe(id);
            });

            it.each([
                ["https://ok.ru/profile/123"],
                ["https://ok.ru/video/abc"],
                ["https://ok.ru/"],
            ])("%s -> null", (url) => {
                expect(parser.parseUrl(url)).toBeNull();
            });

            it("URL invalide -> null (pas d'exception)", () => {
                expect(parser.parseUrl("pas une url")).toBeNull();
            });
        });

        describe("liste de vidéos", () => {
            it("video_ids=a,b,c", () => {
                const info = parser.parseUrl("https://ok.ru/?video_ids=1,2,3&index=2");
                expect(info.kind).toBe("videoList");
                expect(info.videoIds).toEqual(["1", "2", "3"]);
                expect(info.index).toBe(2);
                expect(info.labels).toEqual([]);
            });

            it("trim et filtre les ids vides", () => {
                const info = parser.parseUrl("https://ok.ru/?video_ids=1,%20,%202%20,,3");
                expect(info.videoIds).toEqual(["1", "2", "3"]);
            });

            it.each([
                ["https://ok.ru/?video_ids="],
                ["https://ok.ru/?video_ids"],
                ["https://ok.ru/?video_ids=,,"],
            ])("ids vides -> null (%s)", (url) => {
                expect(parser.parseUrl(url)).toBeNull();
            });

            it("video_ids prime sur le chemin /video/ID", () => {
                const info = parser.parseUrl("https://ok.ru/video/999?video_ids=1,2");
                expect(info.kind).toBe("videoList");
                expect(info.videoIds).toEqual(["1", "2"]);
            });

            it("décode les ids encodés", () => {
                const info = parser.parseUrl("https://ok.ru/?video_ids=a%2Fb,c");
                expect(info.videoIds).toEqual(["a/b", "c"]);
            });

            it("un id malformé est gardé tel quel", () => {
                const info = parser.parseUrl("https://ok.ru/?video_ids=100%,2");
                expect(info.videoIds).toEqual(["100%", "2"]);
            });
        });

        describe("labels", () => {
            it("découpe AVANT de décoder : %2C reste dans le titre", () => {
                const info = parser.parseUrl("https://ok.ru/?video_ids=1,2&labels=Hello%2C%20World,Second");
                expect(info.labels).toEqual(["Hello, World", "Second"]);
            });

            it("un label vide reste à sa place (positionnel)", () => {
                const info = parser.parseUrl("https://ok.ru/?video_ids=1,2&labels=,Second");
                expect(info.labels).toEqual(["", "Second"]);
            });

            it("labels absent ou vide -> []", () => {
                expect(parser.parseUrl("https://ok.ru/?video_ids=1").labels).toEqual([]);
                expect(parser.parseUrl("https://ok.ru/?video_ids=1&labels=").labels).toEqual([]);
            });

            it("un label malformé est gardé tel quel", () => {
                const info = parser.parseUrl("https://ok.ru/?video_ids=1&labels=100%25,50%");
                expect(info.labels).toEqual(["100%", "50%"]);
            });

            it("trim les labels", () => {
                const info = parser.parseUrl("https://ok.ru/?video_ids=1,2&labels=%20A%20,B");
                expect(info.labels).toEqual(["A", "B"]);
            });
        });
    });

    describe("buildUrl", () => {
        it("construit l'URL d'une vidéo", () => {
            expect(parser.buildUrl({videoId: "123"})).toBe("https://ok.ru/video/123");
        });

        it("prend le premier id d'un videoIds", () => {
            expect(parser.buildUrl({videoIds: ["1", "2"]})).toBe("https://ok.ru/video/1");
        });

        it("lève une TypeError sans définition", () => {
            expect(() => parser.buildUrl()).toThrow(TypeError);
        });

        it("lève une TypeError pour une playlist (non supportée)", () => {
            expect(() => parser.buildUrl({playlistId: "PL1"})).toThrow("playlist not supported");
        });

        it("lève une TypeError sans id", () => {
            expect(() => parser.buildUrl({})).toThrow("need videoId or videoIds");
        });

        it("l'URL d'une vidéo se relit à l'identique", () => {
            const info = parser.parseUrl(parser.buildUrl({videoId: "123"}));
            expect([info.kind, info.videoId]).toEqual(["video", "123"]);
        });

        // Aujourd'hui seul le premier id est gardé : la liste devient une vidéo seule.
        it.fails("l'URL d'une liste se relit comme une liste (à corriger : video_ids=1,2)", () => {
            const info = parser.parseUrl(parser.buildUrl({videoIds: ["1", "2"]}));
            expect(info.kind).toBe("videoList");
        });
    });

    describe("parseFromElement(element)", () => {
        describe("erreurs", () => {
            it("lève une erreur si aucune URL", () => {
                expect(() => parser.parseFromElement(div(null))).toThrow(/No URL found/);
            });

            it("lève une erreur si l'URL n'est pas reconnue", () => {
                expect(() => parser.parseFromElement(anchor("https://ok.ru/profile/1", {target: "p"})))
                    .toThrow(/Invalid URL/);
            });
        });

        describe("vidéo", () => {
            it("construit un VideoInfo avec les valeurs par défaut", () => {
                const v = parser.parseFromElement(anchor("https://ok.ru/video/123", {target: "player"}));
                expect(v).toBeInstanceOf(VideoInfo);
                expect(v).toMatchObject({
                    provider: "okru",
                    target: "player",
                    videoId: "123",
                    autoplay: "none",
                    startSeconds: undefined,
                    title: "",
                    channel: "",
                    thumbnail: "",
                    showOnInit: false,
                    key: "okru:123"
                });
            });

            it("utilise les data-* fournis", () => {
                const v = parser.parseFromElement(anchor("https://ok.ru/video/123", {
                    target: "player",
                    autoplay: "",
                    start: "1m30s",
                    title: "T",
                    channel: "C",
                    thumbnail: "t.jpg",
                    showOnInit: "true",
                    key: "k"
                }));
                expect(v).toMatchObject({
                    autoplay: "init",
                    startSeconds: 90,
                    title: "T",
                    channel: "C",
                    thumbnail: "t.jpg",
                    showOnInit: true,
                    key: "k"
                });
            });

            it("fonctionne avec un <iframe>", () => {
                const v = parser.parseFromElement(iframe("https://ok.ru/videoembed/123", {}, "wrapper"));
                expect(v.videoId).toBe("123");
                expect(v.target).toBe("wrapper");
            });
        });

        describe("liste de vidéos", () => {
            it("crée un VideoListInfo (sans labels ni data-videos)", () => {
                const list = parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2&index=1", {
                    target: "p", showOnInit: "", key: "k"
                }));
                expect(list).toBeInstanceOf(VideoListInfo);
                expect(list.provider).toBe("okru");
                expect(list.videoIds).toEqual(["1", "2"]);
                expect(list.index).toBe(1);
                expect(list.showOnInit).toBe(true);
                expect(list.key).toBe("k");
                expect(list.videos.map((v) => v.title)).toEqual(["", ""]);
                expect(list.videos.map((v) => v.thumbnail)).toEqual(["", ""]);
            });

            it("utilise labels= de l'URL comme titres", () => {
                const list = parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2&labels=Un,Deux", {target: "p"}));
                expect(list.videos.map((v) => v.title)).toEqual(["Un", "Deux"]);
            });

            it("moins de labels que de vidéos : titre vide pour les manquants, avec un avertissement", () => {
                const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
                const list = parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2,3&labels=Un", {target: "p"}));
                expect(list.videos.map((v) => v.title)).toEqual(["Un", "", ""]);
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn.mock.calls[0][0]).toContain("1 labels for 3 videos");
            });

            it("pas d'avertissement si le nombre de labels correspond, ou s'il n'y en a aucun", () => {
                const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
                parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2&labels=A,B", {target: "p"}));
                parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2", {target: "p"}));
                expect(warn).not.toHaveBeenCalled();
            });

            it("data-videos prime sur labels=", () => {
                const videos = JSON.stringify([{title: "Depuis JSON 1"}, {title: "Depuis JSON 2"}]);
                const list = parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2&labels=A,B", {target: "p", videos}));
                expect(list.videos.map((v) => v.title)).toEqual(["Depuis JSON 1", "Depuis JSON 2"]);
            });

            it("data-videos plus court : les manquants ont les valeurs par défaut (pas de plantage)", () => {
                const list = parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2", {
                    target: "p", videos: '[{"title":"Seul"}]'
                }));
                expect(list.videos.map((v) => v.title)).toEqual(["Seul", ""]);
                expect(list.videos[1].videoId).toBe("2");
            });

            it("autoplay : la vidéo prime, sinon data-autoplay du lien", () => {
                const videos = JSON.stringify([{autoplay: "click"}, {}]);
                const list = parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2", {
                    target: "p", autoplay: "", videos
                }));
                expect(list.videos.map((v) => v.autoplay)).toEqual(["click", "init"]);
            });

            it("l'autoplay du lien s'applique quand il n'y a pas de data-videos", () => {
                const list = parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2", {target: "p", autoplay: "click"}));
                expect(list.videos.map((v) => v.autoplay)).toEqual(["click", "click"]);
            });

            it("le départ, la chaîne et la vignette viennent de data-videos", () => {
                const videos = JSON.stringify([{start: "1m", channel: "C", thumbnail: "t.jpg"}]);
                const list = parser.parseFromElement(anchor("https://ok.ru/?video_ids=1", {target: "p", videos}));
                expect(list.videos[0]).toMatchObject({startSeconds: 60, channel: "C", thumbnail: "t.jpg"});
            });

            it("index : celui de l'URL, sinon data-index", () => {
                expect(parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2&index=1", {target: "p", index: "0"})).index).toBe(1);
                expect(parser.parseFromElement(anchor("https://ok.ru/?video_ids=1,2", {target: "p", index: "1"})).index).toBe(1);
            });

            it("un data-videos invalide lève une erreur explicite", () => {
                expect(() => parser.parseFromElement(anchor("https://ok.ru/?video_ids=1", {target: "p", videos: "nope"})))
                    .toThrow(/Invalid JSON in data-videos/);
            });
        });
    });
});

/* -------------------------------------------------------------------------- */
/* YouTubeInfoParser.parseDefinition                                           */
/* -------------------------------------------------------------------------- */

describe("YouTubeInfoParser.parseDefinition", () => {
    const parser = new YouTubeInfoParser();
    const base = {target: "#player"};
    const video = (extra = {}) => parser.parseDefinition({...base, url: "https://www.youtube.com/watch?v=abc", ...extra});
    const list = (extra = {}) => parser.parseDefinition({...base, url: "https://www.youtube.com/watch_videos?video_ids=a,b,c&index=1", ...extra});
    const playlist = (extra = {}) => parser.parseDefinition({...base, url: "https://www.youtube.com/watch?v=abc&list=PL1", ...extra});

    describe("une vidéo", () => {
        it("est un VideoInfo, avec les valeurs par défaut d'un lien", () => {
            const v = video();
            expect(v).toBeInstanceOf(VideoInfo);
            expect(v).toMatchObject({
                provider: "youtube",
                target: "#player",
                videoId: "abc",
                autoplay: "none",
                title: "",
                channel: "",
                thumbnail: thumb("abc"),
                key: "youtube:abc"
            });
        });

        it("prend ce que dit la définition", () => {
            const v = video({title: "T", channel: "C", thumbnail: "u", autoplay: "click", start: 90, showOnInit: true, key: "ma-cle"});
            expect(v).toMatchObject({
                title: "T", channel: "C", thumbnail: "u", autoplay: "click", startSeconds: 90, showOnInit: true, key: "ma-cle"
            });
        });

        it.each([
            [true, "init"],
            [false, "none"],
            ["", "init"],
            ["click", "click"]
        ])("autoplay %j donne %s", (autoplay, attendu) => {
            expect(video({autoplay}).autoplay).toBe(attendu);
        });

        it("départ : secondes ou 1m30s, et la définition prime sur t= de l'URL", () => {
            expect(video({start: "1m30s"}).startSeconds).toBe(90);
            expect(parser.parseDefinition({...base, url: "https://www.youtube.com/watch?v=abc&t=30"}).startSeconds).toBe(30);
            expect(parser.parseDefinition({...base, url: "https://www.youtube.com/watch?v=abc&t=30", start: 120}).startSeconds).toBe(120);
        });

        it("un départ invalide retombe sur t=", () => {
            expect(parser.parseDefinition({...base, url: "https://www.youtube.com/watch?v=abc&t=30", start: "bientôt"}).startSeconds).toBe(30);
        });
    });

    describe("erreurs", () => {
        it("une URL sans vidéo ni playlist", () => {
            expect(() => parser.parseDefinition({...base, url: "https://www.youtube.com/watch"})).toThrow("Invalid URL");
        });

        it("une liste sans ids", () => {
            expect(() => parser.parseDefinition({...base, url: "https://www.youtube.com/watch_videos?video_ids=,"})).toThrow("Invalid URL");
        });

        it("un target est requis (par le modèle)", () => {
            expect(() => parser.parseDefinition({url: "https://www.youtube.com/watch?v=abc"})).toThrow();
        });

        it("videos doit être un tableau", () => {
            expect(() => video({videos: {}})).toThrow("videos must be an array");
        });

        it("une définition sans url ne peut pas être lue", () => {
            expect(() => parser.parseDefinition({...base, videoId: "abc"})).toThrow();
        });

        // À faire : parseDefinition devrait utiliser `def.url ?? this.buildUrl(def)`.
        it.fails("construit l'URL à partir des ids quand il n'y en a pas (à implémenter)", () => {
            const v = parser.parseDefinition({...base, videoId: "abc"});
            expect(v.videoId).toBe("abc");
        });
    });

    describe("une liste de vidéos", () => {
        it("est un VideoListInfo avec les ids et l'index de l'URL", () => {
            const l = list();
            expect(l).toBeInstanceOf(VideoListInfo);
            expect(l.videoIds).toEqual(["a", "b", "c"]);
            expect(l.index).toBe(1);
            expect(l.key).toBe("youtube:list:a,b,c");
        });

        it("a une vidéo par id, avec les valeurs par défaut", () => {
            const l = list();
            expect(l.videos.map((v) => v.videoId)).toEqual(["a", "b", "c"]);
            expect(l.videos.map((v) => v.thumbnail)).toEqual([thumb("a"), thumb("b"), thumb("c")]);
            expect(l.videos.map((v) => v.title)).toEqual(["", "", ""]);
        });

        it("prend les vidéos de la définition, par position", () => {
            const l = list({videos: [{title: "A", channel: "CA", autoplay: "click", start: "1m", thumbnail: "u"}, {title: "B"}]});
            expect(l.videos[0]).toMatchObject({title: "A", channel: "CA", autoplay: "click", startSeconds: 60, thumbnail: "u"});
            expect(l.videos[1].title).toBe("B");
        });


        it("plus de vidéos que d'ids : les vidéos en trop sont ignorées", () => {
            expect(list({videos: [{}, {}, {}, {title: "en trop"}]}).videos).toHaveLength(3);
        });

        it("la clé et showOnInit sont ceux de la liste", () => {
            expect(list({key: "ma-cle", showOnInit: true})).toMatchObject({key: "ma-cle", showOnInit: true});
        });

        it("l'index de la définition est utilisé quand l'URL n'en a pas, l'URL prime sinon", () => {
            const sansIndex = "https://www.youtube.com/watch_videos?video_ids=a,b";
            expect(parser.parseDefinition({...base, url: sansIndex, index: 1}).index).toBe(1);
            expect(list({index: 2}).index).toBe(1); // URL a index=1
        });
    });

    describe("une playlist", () => {
        it("est un PlaylistInfo avec son id et sa vidéo de départ", () => {
            const p = playlist();
            expect(p).toBeInstanceOf(PlaylistInfo);
            expect([p.playlistId, p.videoId, p.key]).toEqual(["PL1", "abc", "youtube:playlist:PL1"]);
            expect(p.videos).toEqual([]);
        });
    

        it("prend les vidéos de la définition", () => {
            const p = playlist({
                videos: [
                    { videoId: "x1", title: "T", start: "1m", autoplay: "click" },
                    { videoId: "x2" }
                ]
            });
        
            expect(p.videos, "videos doit exister").toBeDefined();
            expect(p.videos, "2 vidéos attendues").toHaveLength(2);
        
            const v0 = p.videos[0];
        
            // Identité
            expect(
                v0?.constructor?.name,
                `constructor.name = ${v0?.constructor?.name}`
            ).toBe("VideoInfo");
        
            expect(
                v0 instanceof VideoInfo,
                "instanceof VideoInfo : si false → double module ou mauvais objet"
            ).toBe(true);
        
            // Accès un champ à la fois (le premier qui throw = le vrai problème)
            expect(() => v0.videoId, "accès videoId").not.toThrow();
            expect(() => v0.autoplay, "accès autoplay").not.toThrow();
            expect(() => v0.title, "accès title").not.toThrow();
        });
    
        it("la clé et showOnInit sont ceux de la playlist", () => {
            expect(playlist({key: "ma-cle", showOnInit: true})).toMatchObject({
                key: "ma-cle", showOnInit: true
            });
        });
    
        it("chaque vidéo garde son autoplay ; pas de repli sur celui de la playlist", () => {
            const p = playlist({
                autoplay: "click",
                videos: [{videoId: "x1"}, {videoId: "x2", autoplay: true}]
            });
            // x1 sans autoplay → "none" (défaut), pas "click" de la playlist
            expect(p.videos.map((v) => v.autoplay)).toEqual(["none", "init"]);
        });
    
        it("une entrée sans videoId lève une erreur", () => {
            expect(() => playlist({videos: [{title: "A"}]})).toThrow(/videoId/);
        });
    
        // count / ids factices : hors contrat actuel — supprimés ou it.fails si tu veux les garder en backlog
    });
});

/* -------------------------------------------------------------------------- */
/* OkruInfoParser.parseDefinition                                              */
/* -------------------------------------------------------------------------- */

describe("OkruInfoParser.parseDefinition", () => {
    const parser = new OkruInfoParser();
    const base = {target: "#player"};
    const video = (extra = {}) => parser.parseDefinition({...base, url: "https://ok.ru/video/12345", ...extra});
    const list = (extra = {}) => parser.parseDefinition({...base, url: "https://ok.ru/video?video_ids=1,2,3&index=2", ...extra});

    describe("une vidéo", () => {
        it("est un VideoInfo, avec les valeurs par défaut", () => {
            expect(video()).toMatchObject({
                provider: "okru", target: "#player", videoId: "12345", autoplay: "none", title: "", channel: "", thumbnail: "", key: "okru:12345"
            });
            expect(video()).toBeInstanceOf(VideoInfo);
        });

        it("prend ce que dit la définition", () => {
            expect(video({title: "T", channel: "C", thumbnail: "u", autoplay: "click", start: "1m30s", showOnInit: true, key: "ma-cle"})).toMatchObject({
                title: "T", channel: "C", thumbnail: "u", autoplay: "click", startSeconds: 90, showOnInit: true, key: "ma-cle"
            });
        });

        it.each([
            [true, "init"],
            [false, "none"],
            ["click", "click"]
        ])("autoplay %j donne %s", (autoplay, attendu) => {
            expect(video({autoplay}).autoplay).toBe(attendu);
        });
    });

    describe("erreurs", () => {
        it("une URL qui n'est pas une vidéo", () => {
            expect(() => parser.parseDefinition({...base, url: "https://ok.ru/profile/1"})).toThrow("Invalid URL: 'https://ok.ru/profile/1'");
        });

        it("une définition sans url", () => {
            expect(() => parser.parseDefinition({...base})).toThrow("Invalid URL");
        });

        it("videos doit être un tableau", () => {
            expect(() => video({videos: "nope"})).toThrow("videos must be an array");
        });

        // À faire : parseDefinition devrait utiliser `def.url ?? this.buildUrl(def)`.
        it.fails("construit l'URL à partir de videoId quand il n'y en a pas (à implémenter)", () => {
            expect(parser.parseDefinition({...base, videoId: "123"}).videoId).toBe("123");
        });
    });

    describe("une liste de vidéos", () => {
        it("est un VideoListInfo avec les ids et l'index de l'URL", () => {
            const l = list();
            expect(l).toBeInstanceOf(VideoListInfo);
            expect(l.videoIds).toEqual(["1", "2", "3"]);
            expect(l.index).toBe(2);
            expect(l.key).toBe("okru:list:1,2,3");
        });

        it("les titres viennent de labels= quand la définition n'a pas de videos", () => {
            const l = parser.parseDefinition({...base, url: "https://ok.ru/video?video_ids=1,2&labels=A,B"});
            expect(l.videos.map((v) => v.title)).toEqual(["A", "B"]);
        });

        it("les videos de la définition priment sur labels=", () => {
            const l = parser.parseDefinition({...base, url: "https://ok.ru/video?video_ids=1,2&labels=A,B", videos: [{title: "X"}, {title: "Y"}]});
            expect(l.videos.map((v) => v.title)).toEqual(["X", "Y"]);
        });

        it("moins de videos que d'ids : les autres sont vides", () => {
            const l = list({videos: [{title: "Seul", channel: "C", start: "1m", thumbnail: "u"}]});
            expect(l.videos[0]).toMatchObject({title: "Seul", channel: "C", startSeconds: 60, thumbnail: "u"});
            expect(l.videos[1]).toMatchObject({title: "", channel: "", thumbnail: ""});
            expect(l.videos).toHaveLength(3);
        });

        it("autoplay : la vidéo prime, sinon celui de la définition", () => {
            const l = list({autoplay: "click", videos: [{autoplay: true}, {}, {}]});
            expect(l.videos.map((v) => v.autoplay)).toEqual(["init", "click", "click"]);
        });
       
        it("avertit quand les labels ne correspondent pas aux ids", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            parser.parseDefinition({...base, url: "https://ok.ru/video?video_ids=1,2&labels=A,B,C"});
            expect(warn).toHaveBeenCalledOnce();
        });

        it("la clé et showOnInit sont ceux de la liste", () => {
            expect(list({key: "ma-cle", showOnInit: true})).toMatchObject({key: "ma-cle", showOnInit: true});
        });


        it("l'index de la définition est utilisé quand l'URL n'en a pas, l'URL prime sinon", () => {
            expect(parser.parseDefinition({
                ...base,
                url: "https://ok.ru/video?video_ids=1,2",
                index: 1
            }).index).toBe(1);
            expect(list({index: 0}).index).toBe(2); // URL a index=2
        });
        
    });
});

/* -------------------------------------------------------------------------- */
/* Un lien et une définition donnent le même résultat                          */
/* -------------------------------------------------------------------------- */

describe("équivalence lien / définition", () => {
    const youtube = new YouTubeInfoParser();
    const okru = new OkruInfoParser();

    it("YouTube, vidéo", () => {
        const url = "https://www.youtube.com/watch?v=abc&t=30";
        const champs = {target: "p", autoplay: "click", start: "1m", title: "T", channel: "C", thumbnail: "u", key: "k"};
        const depuisLien = youtube.parseFromElement(anchor(url, {...champs, showOnInit: ""}));
        const depuisDefinition = youtube.parseDefinition({url, ...champs, showOnInit: true});
        expect(snap(depuisLien)).toEqual(snap(depuisDefinition));
    });

    it("YouTube, liste de vidéos", () => {
        const url = "https://www.youtube.com/watch_videos?video_ids=a,b&index=1";
        const videos = [{title: "A", start: "10", autoplay: "click"}, {title: "B"}];
        const depuisLien = youtube.parseFromElement(anchor(url, {target: "p", key: "k", videos: JSON.stringify(videos)}));
        const depuisDefinition = youtube.parseDefinition({url, target: "p", key: "k", videos, showOnInit: false});
        expect(snapList(depuisLien)).toEqual(snapList(depuisDefinition));
    });

    it("YouTube, playlist avec vidéos de secours", () => {
        const url = "https://www.youtube.com/watch?v=abc&list=PL1";
        const videos = [
            {videoId: "x1", title: "T", start: "1m"},
            {videoId: "x2"},
            {videoId: "x3", title: "trois"}  // plus d'entrée sans videoId
        ];
        const depuisLien = youtube.parseFromElement(anchor(url, {
            target: "p", key: "k", videos: JSON.stringify(videos)
        }));
        const depuisDefinition = youtube.parseDefinition({
            url, target: "p", key: "k", videos, showOnInit: false
        });
        expect(snapPlaylist(depuisLien)).toEqual(snapPlaylist(depuisDefinition));
    });

    it("Okru, vidéo", () => {
        const url = "https://ok.ru/video/123";
        const champs = {target: "p", autoplay: "", start: "90", title: "T", key: "k"};
        const depuisLien = okru.parseFromElement(anchor(url, {...champs, showOnInit: "true"}));
        const depuisDefinition = okru.parseDefinition({url, ...champs, showOnInit: true});
        expect(snap(depuisLien)).toEqual(snap(depuisDefinition));
    });

    it("Okru, liste de vidéos", () => {
        const url = "https://ok.ru/video?video_ids=1,2&labels=A,B";
        const depuisLien = okru.parseFromElement(anchor(url, {target: "p", autoplay: "click"}));
        const depuisDefinition = okru.parseDefinition({url, target: "p", autoplay: "click", showOnInit: false});
        expect(snapList(depuisLien)).toEqual(snapList(depuisDefinition));
    });
});