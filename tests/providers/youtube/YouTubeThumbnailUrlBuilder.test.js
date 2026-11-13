import { YouTubeThumbnailUrlBuilder } from "../../../src/providers/youtube/YouTubeThumbnailUrlBuilder.js"; // adapte le chemin

describe("YouTubeThumbnailUrlBuilder", () => {
    const builder = new YouTubeThumbnailUrlBuilder();
    const VIDEO_ID = "dQw4w9WgXcQ";

    it("retourne l'URL de la miniature mqdefault pour un videoId valide", () => {
        const url = builder.getThumbnailUrl(VIDEO_ID);
        expect(url).toBe(`https://i.ytimg.com/vi/${VIDEO_ID}/mqdefault.jpg`);
    });

    it("lance une erreur si videoId est null", () => {
        expect(() => builder.getThumbnailUrl(null)).toThrow();
    });

    it("lance une erreur si videoId est undefined", () => {
        expect(() => builder.getThumbnailUrl(undefined)).toThrow();
    });

    it("lance une erreur si videoId est une chaîne vide", () => {
        expect(() => builder.getThumbnailUrl("")).toThrow();
    });

    it("lance une erreur si videoId ne contient que des espaces", () => {
        expect(() => builder.getThumbnailUrl("   ")).toThrow();
    });
});