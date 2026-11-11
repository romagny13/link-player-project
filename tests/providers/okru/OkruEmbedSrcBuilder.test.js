import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {OkruEmbedSrcBuilder} from "../../../src/providers/okru/OkruEmbedSrcBuilder.js";

describe("OkruEmbedSrcBuilder", () => {
    describe("mode direct", () => {
        const builder = new OkruEmbedSrcBuilder();

        it("isRelay = false", () => {
            expect(builder.isRelay).toBe(false);
        });

        it("URL minimale", () => {
            expect(builder.build({videoId: "123"})).toBe("https://ok.ru/videoembed/123");
        });

        it("autoplay", () => {
            expect(builder.build({videoId: "123", autoplay: true}))
                .toBe("https://ok.ru/videoembed/123?autoplay=1");
        });

        it("fromTime (arrondi à l'entier inférieur)", () => {
            expect(builder.build({videoId: "123", startSeconds: 90.9}))
                .toBe("https://ok.ru/videoembed/123?fromTime=90");
        });

        it("autoplay + fromTime", () => {
            expect(builder.build({videoId: "123", autoplay: true, startSeconds: 90}))
                .toBe("https://ok.ru/videoembed/123?autoplay=1&fromTime=90");
        });

        it.each([[undefined], [0], [-5], [null], [NaN]])("startSeconds=%j est ignoré", (startSeconds) => {
            expect(builder.build({videoId: "123", startSeconds})).toBe("https://ok.ru/videoembed/123");
        });

        it("encode l'id dans le chemin", () => {
            expect(builder.build({videoId: "a/b c"})).toBe("https://ok.ru/videoembed/a%2Fb%20c");
        });

        it.each([[""], [null], [undefined]])("lève TypeError si videoId=%j", (videoId) => {
            expect(() => builder.build({videoId})).toThrow(TypeError);
        });

        it("lève TypeError sans argument", () => {
            expect(() => builder.build()).toThrow(TypeError);
        });
    });

    describe("mode relais", () => {
        const relayBaseUrl = "https://relay.test/okru.html";
        const parentOrigin = "https://site.test";

        it("isRelay = true", () => {
            expect(new OkruEmbedSrcBuilder({relayBaseUrl}).isRelay).toBe(true);
        });

        it("URL complète avec tous les paramètres (ordre inclus)", () => {
            const b = new OkruEmbedSrcBuilder({relayBaseUrl, parentOrigin});
            expect(b.build({videoId: "123", autoplay: true, startSeconds: 90.7}))
                .toBe("https://relay.test/okru.html?videoId=123&autoplay=1&startSeconds=90&parentOrigin=https%3A%2F%2Fsite.test");
        });

        it("seulement videoId + parentOrigin par défaut", () => {
            const b = new OkruEmbedSrcBuilder({relayBaseUrl, parentOrigin});
            const q = new URL(b.build({videoId: "123"})).searchParams;
            expect([...q.keys()]).toEqual(["videoId", "parentOrigin"]);
        });

        it("conserve les paramètres déjà présents dans la base", () => {
            const b = new OkruEmbedSrcBuilder({relayBaseUrl: `${relayBaseUrl}?theme=dark`, parentOrigin});
            const q = new URL(b.build({videoId: "123"})).searchParams;
            expect(q.get("theme")).toBe("dark");
            expect(q.get("videoId")).toBe("123");
        });

        it("remplace un videoId déjà présent dans la base", () => {
            const b = new OkruEmbedSrcBuilder({relayBaseUrl: `${relayBaseUrl}?videoId=old`, parentOrigin});
            expect(new URL(b.build({videoId: "new"})).searchParams.getAll("videoId")).toEqual(["new"]);
        });

        it("lit location.origin au moment du build si parentOrigin n'est pas fourni", () => {
            vi.stubGlobal("location", {origin: "https://from-location.test"});
            const b = new OkruEmbedSrcBuilder({relayBaseUrl});
            expect(new URL(b.build({videoId: "1"})).searchParams.get("parentOrigin"))
                .toBe("https://from-location.test");
        });

        it("omet parentOrigin sans option ni location", () => {
            vi.stubGlobal("location", undefined);
            const b = new OkruEmbedSrcBuilder({relayBaseUrl});
            expect(new URL(b.build({videoId: "1"})).searchParams.has("parentOrigin")).toBe(false);
        });

        it("lève TypeError si videoId vide", () => {
            expect(() => new OkruEmbedSrcBuilder({relayBaseUrl, parentOrigin}).build({videoId: ""}))
                .toThrow(TypeError);
        });

        it("lève si la base du relais n'est pas une URL valide", () => {
            expect(() => new OkruEmbedSrcBuilder({relayBaseUrl: "pas une url"}).build({videoId: "1"})).toThrow();
        });
    });
});