import { describe, it, expect, vi, afterEach } from "vitest";
import { YouTubeEmbedSrcBuilder } from "../../../src/providers/youtube/YouTubeEmbedSrcBuilder.js";

afterEach(() => vi.unstubAllGlobals());

/** Découpe une URL en { base, params } pour des assertions indépendantes de l'ordre. */
const parse = (src) => {
    const u = new URL(src);
    return { base: u.origin + u.pathname, params: Object.fromEntries(u.searchParams) };
};
const BASE = "https://www.youtube.com/embed";
const ORIGIN = "https://site.test";

describe("YouTubeEmbedSrcBuilder : constructeur", () => {
    it("enablejsapi faux par défaut, converti en booléen", () => {
        expect(new YouTubeEmbedSrcBuilder({ origin: null }).enablejsapi).toBe(false);
        expect(new YouTubeEmbedSrcBuilder({ enablejsapi: 1, origin: null }).enablejsapi).toBe(true);
    });

    it("origin : valeur donnée", () => {
        expect(new YouTubeEmbedSrcBuilder({ origin: ORIGIN }).origin).toBe(ORIGIN);
    });

    it("origin : null, vide ou 'null' (page sandboxée) → null", () => {
        for (const origin of [null, "", "null"]) {
            expect(new YouTubeEmbedSrcBuilder({ origin }).origin).toBeNull();
        }
    });

    it("origin par défaut : location.origin de la page", () => {
        vi.stubGlobal("location", { origin: "https://page.test" });
        expect(new YouTubeEmbedSrcBuilder().origin).toBe("https://page.test");
    });

    it("origin par défaut : null sans location", () => {
        vi.stubGlobal("location", undefined);
        expect(new YouTubeEmbedSrcBuilder().origin).toBeNull();
    });
});

describe("YouTubeEmbedSrcBuilder.buildVideoSrc", () => {
    const b = new YouTubeEmbedSrcBuilder({ enablejsapi: true, origin: ORIGIN });

    it("exige un videoId", () => {
        expect(() => b.buildVideoSrc()).toThrow(TypeError);
        expect(() => b.buildVideoSrc("")).toThrow(/videoId is required/);
    });

    it("URL exacte avec tous les paramètres (ordre : jsapi, origin, autoplay, mute, start)", () => {
        expect(b.buildVideoSrc("abc", { autoplay: true, mute: true, startSeconds: 90 }))
            .toBe(`${BASE}/abc?enablejsapi=1&origin=https%3A%2F%2Fsite.test&autoplay=1&mute=1&start=90`);
    });

    it("sans option : seulement enablejsapi et origin", () => {
        expect(parse(b.buildVideoSrc("abc"))).toEqual({ base: `${BASE}/abc`, params: { enablejsapi: "1", origin: ORIGIN } });
    });

    it("enablejsapi faux : ni enablejsapi ni origin, même avec une origine", () => {
        const plain = new YouTubeEmbedSrcBuilder({ origin: ORIGIN });
        expect(plain.buildVideoSrc("abc")).toBe(`${BASE}/abc`);
        expect(plain.buildVideoSrc("abc", { autoplay: true })).toBe(`${BASE}/abc?autoplay=1`);
    });

    it("enablejsapi sans origine : pas de paramètre origin", () => {
        const noOrigin = new YouTubeEmbedSrcBuilder({ enablejsapi: true, origin: null });
        expect(parse(noOrigin.buildVideoSrc("abc")).params).toEqual({ enablejsapi: "1" });
    });

    it("autoplay et mute faux ou absents : pas de paramètre", () => {
        const { params } = parse(b.buildVideoSrc("abc", { autoplay: false, mute: false }));
        expect(params).not.toHaveProperty("autoplay");
        expect(params).not.toHaveProperty("mute");
    });

    it("start : arrondi à l'entier inférieur, ignoré si <= 0 ou absent", () => {
        expect(parse(b.buildVideoSrc("abc", { startSeconds: 90.9 })).params.start).toBe("90");
        for (const startSeconds of [0, -5, undefined, null]) {
            expect(parse(b.buildVideoSrc("abc", { startSeconds })).params).not.toHaveProperty("start");
        }
    });

    it("l'id est encodé dans le chemin ; un id YouTube commençant par '-' reste intact", () => {
        expect(b.buildVideoSrc("-xiF9YIIUk4")).toContain(`${BASE}/-xiF9YIIUk4?`);
        expect(parse(b.buildVideoSrc("a b/c")).base).toBe(`${BASE}/a%20b%2Fc`);
    });
});

describe("YouTubeEmbedSrcBuilder.buildVideoListSrc", () => {
    const b = new YouTubeEmbedSrcBuilder({ enablejsapi: true, origin: ORIGIN });

    it("exige un tableau non vide", () => {
        expect(() => b.buildVideoListSrc()).toThrow(TypeError);
        expect(() => b.buildVideoListSrc([])).toThrow(/non-empty array/);
        expect(() => b.buildVideoListSrc("a,b")).toThrow(TypeError);
    });

    it("le chemin porte la 1re vidéo, playlist= la liste complète", () => {
        const { base, params } = parse(b.buildVideoListSrc(["z2sv_RsNwM4", "-xiF9YIIUk4"]));
        expect(base).toBe(`${BASE}/z2sv_RsNwM4`);
        expect(params.playlist).toBe("z2sv_RsNwM4,-xiF9YIIUk4");
    });

    it("playlist= est ajouté en dernier ; la virgule est encodée", () => {
        expect(b.buildVideoListSrc(["a", "b"], { autoplay: true }))
            .toBe(`${BASE}/a?enablejsapi=1&origin=https%3A%2F%2Fsite.test&autoplay=1&playlist=a%2Cb`);
    });

    it("autoplay, mute et start (de la liste) comme pour une vidéo", () => {
        const { params } = parse(b.buildVideoListSrc(["a", "b"], { autoplay: true, mute: true, startSeconds: 30 }));
        expect(params).toMatchObject({ autoplay: "1", mute: "1", start: "30" });
    });

    it("index n'est pas mis dans l'URL (il est appliqué ensuite par commande du player)", () => {
        expect(parse(b.buildVideoListSrc(["a", "b"], { index: 1 })).params).not.toHaveProperty("index");
    });

    it("une liste d'un seul id fonctionne", () => {
        expect(parse(b.buildVideoListSrc(["a"])).params.playlist).toBe("a");
    });
});

describe("YouTubeEmbedSrcBuilder.buildPlaylistSrc", () => {
    const b = new YouTubeEmbedSrcBuilder({ enablejsapi: true, origin: ORIGIN });

    it("exige un playlistId", () => {
        expect(() => b.buildPlaylistSrc()).toThrow(TypeError);
        expect(() => b.buildPlaylistSrc("")).toThrow(/playlistId is required/);
    });

    it("sans vidéo de départ : chemin videoseries", () => {
        const { base, params } = parse(b.buildPlaylistSrc("PLYALQE76y6LQ"));
        expect(base).toBe(`${BASE}/videoseries`);
        expect(params.list).toBe("PLYALQE76y6LQ");
    });

    it("avec vidéo de départ : son id dans le chemin", () => {
        expect(parse(b.buildPlaylistSrc("PL1", { videoId: "s11CNT_hQTg" })).base).toBe(`${BASE}/s11CNT_hQTg`);
    });

    it("list= est ajouté en dernier", () => {
        expect(b.buildPlaylistSrc("PL1", { autoplay: true, mute: true }))
            .toBe(`${BASE}/videoseries?enablejsapi=1&origin=https%3A%2F%2Fsite.test&autoplay=1&mute=1&list=PL1`);
    });

    it("ne prend pas de start (ni d'index)", () => {
        const { params } = parse(b.buildPlaylistSrc("PL1", { startSeconds: 30, index: 2 }));
        expect(params).not.toHaveProperty("start");
        expect(params).not.toHaveProperty("index");
    });
});
