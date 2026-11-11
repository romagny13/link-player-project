import { describe, it, expect, beforeEach } from "vitest";
import {YouTubeEmbedSrcBuilder} from "../../../src/providers/youtube/YouTubeEmbedSrcBuilder.js";

describe("YouTubeEmbedSrcBuilder", () => {
    describe("constructor + getters", () => {
        it("valeurs par défaut", () => {
            const b = new YouTubeEmbedSrcBuilder();
            expect(b.enablejsapi).toBe(false);
            // origin dépend de l'environnement de test (jsdom / node)
            // on vérifie juste que ce n'est pas la string "null"
            expect(b.origin).not.toBe("null");
        });

        it("active enablejsapi et conserve origin", () => {
            const b = new YouTubeEmbedSrcBuilder({
                enablejsapi: true,
                origin: "https://example.com",
            });
            expect(b.enablejsapi).toBe(true);
            expect(b.origin).toBe("https://example.com");
        });

        it("traite origin 'null' (file://) comme null", () => {
            const b = new YouTubeEmbedSrcBuilder({
                enablejsapi: true,
                origin: "null",
            });
            expect(b.origin).toBeNull();
        });

        it("traite origin falsy comme null", () => {
            const b = new YouTubeEmbedSrcBuilder({ origin: "" });
            expect(b.origin).toBeNull();
        });
    });

    describe("buildVideoSrc", () => {
        it("URL minimale", () => {
            const b = new YouTubeEmbedSrcBuilder();
            expect(b.buildVideoSrc("dQw4w9WgXcQ")).toBe(
                "https://www.youtube.com/embed/dQw4w9WgXcQ"
            );
        });

        it("ajoute autoplay et start", () => {
            const b = new YouTubeEmbedSrcBuilder();
            const src = b.buildVideoSrc("abc", { autoplay: true, startSeconds: 90.7 });
            expect(src).toBe(
                "https://www.youtube.com/embed/abc?autoplay=1&start=90"
            );
        });

        it("n'ajoute pas start si <= 0", () => {
            const b = new YouTubeEmbedSrcBuilder();
            expect(b.buildVideoSrc("abc", { startSeconds: 0 })).toBe(
                "https://www.youtube.com/embed/abc"
            );
            expect(b.buildVideoSrc("abc", { startSeconds: -5 })).toBe(
                "https://www.youtube.com/embed/abc"
            );
        });

        it("ajoute enablejsapi + origin quand activé", () => {
            const b = new YouTubeEmbedSrcBuilder({
                enablejsapi: true,
                origin: "https://app.example.com",
            });
            const src = b.buildVideoSrc("xyz");
            expect(src).toContain("enablejsapi=1");
            expect(src).toContain("origin=https%3A%2F%2Fapp.example.com");
        });

        it("n'ajoute pas origin si null même avec enablejsapi", () => {
            const b = new YouTubeEmbedSrcBuilder({
                enablejsapi: true,
                origin: null,
            });
            const src = b.buildVideoSrc("xyz");
            expect(src).toBe(
                "https://www.youtube.com/embed/xyz?enablejsapi=1"
            );
        });

        it("encode le videoId", () => {
            const b = new YouTubeEmbedSrcBuilder();
            // cas théorique – les vrais ids YouTube sont safe, mais le builder encode
            const src = b.buildVideoSrc("a/b");
            expect(src).toContain("/a%2Fb");
        });

        it("throw si videoId manquant", () => {
            const b = new YouTubeEmbedSrcBuilder();
            expect(() => b.buildVideoSrc()).toThrow(TypeError);
            expect(() => b.buildVideoSrc("")).toThrow(TypeError);
            expect(() => b.buildVideoSrc(null)).toThrow(TypeError);
        });
    });

    describe("buildVideoListSrc", () => {
        it("une seule vidéo → pas de playlist", () => {
            const b = new YouTubeEmbedSrcBuilder();
            expect(b.buildVideoListSrc(["only"])).toBe(
                "https://www.youtube.com/embed/only"
            );
        });

        it("plusieurs vidéos → playlist avec le reste", () => {
            const b = new YouTubeEmbedSrcBuilder();
            const src = b.buildVideoListSrc(["v1", "v2", "v3"]);
            expect(src).toBe(
                "https://www.youtube.com/embed/v1?playlist=v2%2Cv3"
            );
        });

        it("ajoute autoplay et index", () => {
            const b = new YouTubeEmbedSrcBuilder();
            const src = b.buildVideoListSrc(["v1", "v2"], {
                autoplay: true,
                index: 2.9,
            });
            expect(src).toContain("autoplay=1");
            expect(src).toContain("index=2");
            expect(src).toContain("playlist=v2");
        });

        it("n'ajoute pas index si <= 0", () => {
            const b = new YouTubeEmbedSrcBuilder();
            const src = b.buildVideoListSrc(["v1", "v2"], { index: 0 });
            expect(src).not.toContain("index=");
        });

        it("throw si tableau vide ou invalide", () => {
            const b = new YouTubeEmbedSrcBuilder();
            expect(() => b.buildVideoListSrc([])).toThrow(TypeError);
            expect(() => b.buildVideoListSrc(null)).toThrow(TypeError);
            expect(() => b.buildVideoListSrc("v1")).toThrow(TypeError);
        });
    });

    describe("buildPlaylistSrc", () => {
        it("sans videoId → videoseries + list", () => {
            const b = new YouTubeEmbedSrcBuilder();
            expect(b.buildPlaylistSrc("PLxxxxxxxx")).toBe(
                "https://www.youtube.com/embed/videoseries?list=PLxxxxxxxx"
            );
        });

        it("avec videoId → embed de la vidéo + list", () => {
            const b = new YouTubeEmbedSrcBuilder();
            const src = b.buildPlaylistSrc("PLxxxxxxxx", { videoId: "abc123" });
            expect(src).toBe(
                "https://www.youtube.com/embed/abc123?list=PLxxxxxxxx"
            );
        });

        it("ajoute autoplay", () => {
            const b = new YouTubeEmbedSrcBuilder();
            const src = b.buildPlaylistSrc("PLxxx", { autoplay: true });
            expect(src).toContain("autoplay=1");
            expect(src).toContain("list=PLxxx");
        });

        it("combine enablejsapi + list", () => {
            const b = new YouTubeEmbedSrcBuilder({
                enablejsapi: true,
                origin: "https://example.com",
            });
            const src = b.buildPlaylistSrc("PLxxx");
            expect(src).toContain("enablejsapi=1");
            expect(src).toContain("origin=https%3A%2F%2Fexample.com");
            expect(src).toContain("list=PLxxx");
            expect(src.startsWith("https://www.youtube.com/embed/videoseries?")).toBe(true);
        });

        it("throw si playlistId manquant", () => {
            const b = new YouTubeEmbedSrcBuilder();
            expect(() => b.buildPlaylistSrc()).toThrow(TypeError);
            expect(() => b.buildPlaylistSrc("")).toThrow(TypeError);
            expect(() => b.buildPlaylistSrc(null)).toThrow(TypeError);
        });
    });
});