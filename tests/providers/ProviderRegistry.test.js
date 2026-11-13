import { describe, it, expect, beforeEach } from "vitest";
import {ProviderRegistry} from "../../src/providers/ProviderRegistry.js";

const youtube = {
    id: "youtube",
    hosts: ["youtube.com", "youtu.be"],
};

const vimeo = {
    id: "vimeo",
    hosts: ["vimeo.com"],
};

describe("ProviderRegistry", () => {
    let registry;

    beforeEach(() => {
        registry = new ProviderRegistry();
    });

    describe("constructor + register", () => {
        it("accepte un tableau de providers au constructeur", () => {
            const r = new ProviderRegistry([youtube, vimeo]);
            expect(r.has("youtube")).toBe(true);
            expect(r.has("vimeo")).toBe(true);
            expect(r.providers).toHaveLength(2);
        });

        it("register est chainable et stocke en minuscules", () => {
            registry.register(youtube).register(vimeo);
            expect(registry.has("YouTube")).toBe(true);
            expect(registry.has("YOUTUBE")).toBe(true);
        });

        it("refuse un provider sans id ou sans hosts", () => {
            expect(() => registry.register({})).toThrow(TypeError);
            expect(() => registry.register({ id: "x" })).toThrow(TypeError);
            expect(() => registry.register({ hosts: [] })).toThrow(TypeError);
            expect(() => registry.register(null)).toThrow(TypeError);
        });

        it("écrase un provider existant avec le même id", () => {
            registry.register(youtube);
            const youtube2 = { id: "youtube", hosts: ["youtube.com"], extra: true };
            registry.register(youtube2);
            expect(registry.get("youtube")).toBe(youtube2);
            expect(registry.providers).toHaveLength(1);
        });
    });

    describe("get / has", () => {
        beforeEach(() => {
            registry.register(youtube);
        });

        it("get retourne le provider (insensible à la casse)", () => {
            expect(registry.get("youtube")).toBe(youtube);
            expect(registry.get("YouTube")).toBe(youtube);
        });

        it("get throw si inconnu", () => {
            expect(() => registry.get("unknown")).toThrow(/Unknown provider/);
        });

        it("has fonctionne", () => {
            expect(registry.has("youtube")).toBe(true);
            expect(registry.has("YOUTUBE")).toBe(true);
            expect(registry.has("vimeo")).toBe(false);
        });
    });

    describe("providers getter", () => {
        it("retourne un tableau gelé des providers", () => {
            registry.register(youtube).register(vimeo);
            const list = registry.providers;

            expect(list).toEqual([youtube, vimeo]);
            expect(() => list.push({})).toThrow(); // frozen
        });
    });

    describe("resolve", () => {
        beforeEach(() => {
            registry.register(youtube).register(vimeo);
        });

        it("résout les domaines exacts et les sous-domaines", () => {
            expect(registry.resolve("https://www.youtube.com/watch?v=abc")).toBe(youtube);
            expect(registry.resolve("https://youtu.be/abc")).toBe(youtube);
            expect(registry.resolve("https://m.youtube.com/watch?v=abc")).toBe(youtube);
            expect(registry.resolve("https://vimeo.com/123")).toBe(vimeo);
        });

        it("throw sur URL invalide", () => {
            expect(() => registry.resolve("not-a-url")).toThrow(/Invalid URL/);
            expect(() => registry.resolve("")).toThrow(/Invalid URL/);
        });

        it("throw si aucun provider ne gère le hostname", () => {
            expect(() => registry.resolve("https://example.com/video")).toThrow(
                /No provider handles/
            );
        });

        it("ne match pas un domaine qui contient juste le nom (sécurité)", () => {
            // "notyoutube.com" ne doit PAS matcher "youtube.com"
            expect(() => registry.resolve("https://notyoutube.com")).toThrow(
                /No provider handles/
            );
        });
    });
});