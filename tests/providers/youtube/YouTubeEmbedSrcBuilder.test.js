import {afterEach, describe, expect, it, vi} from "vitest";
import {YouTubeEmbedSrcBuilder} from "../../../src/providers/youtube/YouTubeEmbedSrcBuilder.js";

const ORIGIN = "https://exemple.fr";
const BASE = "https://www.youtube.com/embed";

const chemin = (url) => new URL(url).pathname;
const params = (url) => new URL(url).searchParams;

/** Builder sans API ni origine : l'URL produite n'a aucun paramètre superflu. */
const simple = () => new YouTubeEmbedSrcBuilder({origin: null});

describe("YouTubeEmbedSrcBuilder", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe("constructeur", () => {
        it("désactive enablejsapi par défaut", () => {
            expect(new YouTubeEmbedSrcBuilder({origin: null}).enablejsapi).toBe(false);
        });

        it("active enablejsapi quand on le demande", () => {
            expect(new YouTubeEmbedSrcBuilder({enablejsapi: true}).enablejsapi).toBe(true);
        });

        it("convertit enablejsapi en booléen", () => {
            expect(new YouTubeEmbedSrcBuilder({enablejsapi: 1}).enablejsapi).toBe(true);
            expect(new YouTubeEmbedSrcBuilder({enablejsapi: 0}).enablejsapi).toBe(false);
            expect(new YouTubeEmbedSrcBuilder({enablejsapi: ""}).enablejsapi).toBe(false);
        });

        it("conserve l'origine fournie", () => {
            expect(new YouTubeEmbedSrcBuilder({origin: ORIGIN}).origin).toBe(ORIGIN);
        });

        it("prend l'origine de la page par défaut", () => {
            vi.stubGlobal("location", {origin: "https://page.fr"});
            expect(new YouTubeEmbedSrcBuilder().origin).toBe("https://page.fr");
        });

        it("n'a pas d'origine quand la page n'en a pas (pas de location)", () => {
            vi.stubGlobal("location", undefined);
            expect(new YouTubeEmbedSrcBuilder().origin).toBeNull();
        });

        it("traite l'origine « null » (pages file://) comme absente", () => {
            expect(new YouTubeEmbedSrcBuilder({origin: "null"}).origin).toBeNull();
        });

        it("traite une origine vide ou nulle comme absente", () => {
            expect(new YouTubeEmbedSrcBuilder({origin: ""}).origin).toBeNull();
            expect(new YouTubeEmbedSrcBuilder({origin: null}).origin).toBeNull();
        });

        it("accepte l'absence totale d'options", () => {
            vi.stubGlobal("location", undefined);
            expect(() => new YouTubeEmbedSrcBuilder()).not.toThrow();
        });
    });

    describe("buildVideoSrc()", () => {
        it("lève une TypeError sans videoId", () => {
            const builder = simple();
            expect(() => builder.buildVideoSrc()).toThrow(TypeError);
            expect(() => builder.buildVideoSrc("")).toThrow("videoId is required");
            expect(() => builder.buildVideoSrc(null)).toThrow(TypeError);
        });

        it("place le videoId dans le chemin, sans paramètre par défaut", () => {
            expect(simple().buildVideoSrc("abc123")).toBe(`${BASE}/abc123`);
        });

        it("encode le videoId dans le chemin", () => {
            const url = simple().buildVideoSrc("a b/c");
            expect(url).toBe(`${BASE}/a%20b%2Fc`);
        });

        it("conserve les tirets et soulignés d'un videoId", () => {
            expect(simple().buildVideoSrc("-3HS_p9pVMK")).toBe(`${BASE}/-3HS_p9pVMK`);
        });

        describe("enablejsapi et origin", () => {
            it("ajoute enablejsapi=1 et origin quand l'API est activée", () => {
                const url = new YouTubeEmbedSrcBuilder({enablejsapi: true, origin: ORIGIN}).buildVideoSrc("abc");
                expect(params(url).get("enablejsapi")).toBe("1");
                expect(params(url).get("origin")).toBe(ORIGIN);
            });

            it("n'ajoute pas origin quand il n'y en a pas", () => {
                const url = new YouTubeEmbedSrcBuilder({enablejsapi: true, origin: null}).buildVideoSrc("abc");
                expect(params(url).get("enablejsapi")).toBe("1");
                expect(params(url).has("origin")).toBe(false);
            });

            it("n'ajoute ni enablejsapi ni origin quand l'API est désactivée", () => {
                const url = new YouTubeEmbedSrcBuilder({origin: ORIGIN}).buildVideoSrc("abc");
                expect(url).toBe(`${BASE}/abc`);
            });
        });

        describe("autoplay", () => {
            it("ajoute autoplay=1 quand il est vrai", () => {
                expect(params(simple().buildVideoSrc("abc", {autoplay: true})).get("autoplay")).toBe("1");
            });

            it("n'ajoute rien quand il est faux ou absent", () => {
                expect(simple().buildVideoSrc("abc", {autoplay: false})).toBe(`${BASE}/abc`);
                expect(simple().buildVideoSrc("abc", {})).toBe(`${BASE}/abc`);
            });
        });

        describe("startSeconds", () => {
            it("ajoute start en secondes", () => {
                expect(params(simple().buildVideoSrc("abc", {startSeconds: 120})).get("start")).toBe("120");
            });

            it("arrondit à l'entier inférieur", () => {
                expect(params(simple().buildVideoSrc("abc", {startSeconds: 90.9})).get("start")).toBe("90");
            });

            it("ignore 0, les valeurs négatives et l'absence de valeur", () => {
                expect(simple().buildVideoSrc("abc", {startSeconds: 0})).toBe(`${BASE}/abc`);
                expect(simple().buildVideoSrc("abc", {startSeconds: -5})).toBe(`${BASE}/abc`);
                expect(simple().buildVideoSrc("abc", {startSeconds: undefined})).toBe(`${BASE}/abc`);
            });
        });

        it("combine tous les paramètres dans l'ordre enablejsapi, origin, autoplay, start", () => {
            const builder = new YouTubeEmbedSrcBuilder({enablejsapi: true, origin: ORIGIN});
            const url = builder.buildVideoSrc("abc", {autoplay: true, startSeconds: 30});
            expect(url).toBe(
                `${BASE}/abc?enablejsapi=1&origin=${encodeURIComponent(ORIGIN)}&autoplay=1&start=30`
            );
        });
    });

    describe("buildVideoListSrc()", () => {
        it("lève une TypeError sans tableau", () => {
            const builder = simple();
            expect(() => builder.buildVideoListSrc()).toThrow(TypeError);
            expect(() => builder.buildVideoListSrc("a,b")).toThrow(TypeError);
            expect(() => builder.buildVideoListSrc(null)).toThrow("a non-empty array is required");
        });

        it("lève une TypeError pour un tableau vide", () => {
            expect(() => simple().buildVideoListSrc([])).toThrow(TypeError);
        });

        it("place la première vidéo dans le chemin", () => {
            expect(chemin(simple().buildVideoListSrc(["a", "b", "c"]))).toBe("/embed/a");
        });

        it("liste toutes les vidéos, la première comprise, dans playlist", () => {
            const url = simple().buildVideoListSrc(["a", "b", "c"]);
            expect(params(url).get("playlist")).toBe("a,b,c");
        });

        it("produit l'URL exacte attendue pour une liste simple", () => {
            expect(simple().buildVideoListSrc(["a", "b", "c"])).toBe(`${BASE}/a?playlist=a%2Cb%2Cc`);
        });

        it("accepte une liste d'une seule vidéo", () => {
            const url = simple().buildVideoListSrc(["a"]);
            expect(chemin(url)).toBe("/embed/a");
            expect(params(url).get("playlist")).toBe("a");
        });

        it("encode le premier id dans le chemin", () => {
            expect(chemin(simple().buildVideoListSrc(["a b", "c"]))).toBe("/embed/a%20b");
        });

        it("ignore l'option index (le paramètre n'est pas utilisé dans l'URL)", () => {
            const avec = simple().buildVideoListSrc(["a", "b", "c"], {index: 2});
            const sans = simple().buildVideoListSrc(["a", "b", "c"]);
            expect(avec).toBe(sans);
            expect(params(avec).has("index")).toBe(false);
        });

        it("ajoute enablejsapi et origin quand l'API est activée", () => {
            const url = new YouTubeEmbedSrcBuilder({enablejsapi: true, origin: ORIGIN}).buildVideoListSrc(["a", "b"]);
            expect(params(url).get("enablejsapi")).toBe("1");
            expect(params(url).get("origin")).toBe(ORIGIN);
        });

        it("ajoute autoplay et start", () => {
            const url = simple().buildVideoListSrc(["a", "b"], {autoplay: true, startSeconds: 45.5});
            expect(params(url).get("autoplay")).toBe("1");
            expect(params(url).get("start")).toBe("45");
        });

        it("n'ajoute ni autoplay ni start par défaut", () => {
            const url = simple().buildVideoListSrc(["a", "b"]);
            expect(params(url).has("autoplay")).toBe(false);
            expect(params(url).has("start")).toBe(false);
        });

        it("place playlist après les autres paramètres", () => {
            const builder = new YouTubeEmbedSrcBuilder({enablejsapi: true, origin: ORIGIN});
            const url = builder.buildVideoListSrc(["a", "b"], {autoplay: true, startSeconds: 10});
            expect(url).toBe(
                `${BASE}/a?enablejsapi=1&origin=${encodeURIComponent(ORIGIN)}&autoplay=1&start=10&playlist=a%2Cb`
            );
        });
    });

    describe("buildPlaylistSrc()", () => {
        it("lève une TypeError sans playlistId", () => {
            const builder = simple();
            expect(() => builder.buildPlaylistSrc()).toThrow(TypeError);
            expect(() => builder.buildPlaylistSrc("")).toThrow("playlistId is required");
        });

        it("utilise « videoseries » dans le chemin sans videoId", () => {
            const url = simple().buildPlaylistSrc("PL123");
            expect(chemin(url)).toBe("/embed/videoseries");
            expect(params(url).get("list")).toBe("PL123");
        });

        it("produit l'URL exacte attendue sans videoId", () => {
            expect(simple().buildPlaylistSrc("PL123")).toBe(`${BASE}/videoseries?list=PL123`);
        });

        it("place le videoId dans le chemin quand il est fourni", () => {
            const url = simple().buildPlaylistSrc("PL123", {videoId: "abc"});
            expect(chemin(url)).toBe("/embed/abc");
            expect(params(url).get("list")).toBe("PL123");
        });

        it("encode le videoId dans le chemin", () => {
            expect(chemin(simple().buildPlaylistSrc("PL123", {videoId: "a b"}))).toBe("/embed/a%20b");
        });

        it("encode le playlistId dans la requête", () => {
            const url = simple().buildPlaylistSrc("PL a&b");
            expect(url).toBe(`${BASE}/videoseries?list=PL+a%26b`);
            expect(params(url).get("list")).toBe("PL a&b");
        });

        it("ajoute autoplay=1 quand il est vrai", () => {
            expect(params(simple().buildPlaylistSrc("PL1", {autoplay: true})).get("autoplay")).toBe("1");
        });

        it("n'ajoute pas autoplay par défaut", () => {
            expect(params(simple().buildPlaylistSrc("PL1")).has("autoplay")).toBe(false);
        });

        it("ignore startSeconds (non géré pour une playlist)", () => {
            const url = simple().buildPlaylistSrc("PL1", {startSeconds: 60});
            expect(params(url).has("start")).toBe(false);
        });

        it("ajoute enablejsapi et origin quand l'API est activée", () => {
            const url = new YouTubeEmbedSrcBuilder({enablejsapi: true, origin: ORIGIN}).buildPlaylistSrc("PL1");
            expect(params(url).get("enablejsapi")).toBe("1");
            expect(params(url).get("origin")).toBe(ORIGIN);
        });

        it("place list après les autres paramètres", () => {
            const builder = new YouTubeEmbedSrcBuilder({enablejsapi: true, origin: ORIGIN});
            const url = builder.buildPlaylistSrc("PL1", {autoplay: true, videoId: "abc"});
            expect(url).toBe(
                `${BASE}/abc?enablejsapi=1&origin=${encodeURIComponent(ORIGIN)}&autoplay=1&list=PL1`
            );
        });
    });
});