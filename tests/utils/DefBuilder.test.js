import {describe, it, expect} from "vitest";
import {AUTOPLAY_MODES, DefBuilder} from "../../src/utils/helpers.js";

/* ------------------------------------------------------------------ */
/*  DefBuilder Builder                                                     */
/* ------------------------------------------------------------------ */

describe("DefBuilder Builder", () => {
    describe("création simple (une seule définition)", () => {
        it("DefBuilder.video() doit retourner un array contenant un objet de type 'video'", () => {
            const result = DefBuilder.video("https://youtu.be/abc123").build();

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                type: "video",
                url: "https://youtu.be/abc123",
            });
        });

        it("DefBuilder.videoList() doit retourner un array contenant un objet de type 'videoList'", () => {
            const result = DefBuilder.videoList({ids: ["a", "b"]}).build();

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                type: "videoList",
                ids: ["a", "b"],
            });
        });

        it("DefBuilder.playlist() doit retourner un array contenant un objet de type 'playlist'", () => {
            const result = DefBuilder.playlist("PL123").build();

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({
                type: "playlist",
                url: "PL123",
            });
        });

        it("doit accepter un objet en entrée et le fusionner", () => {
            const result = DefBuilder.video({
                url: "https://youtu.be/xyz",
                title: "Titre initial",
            }).build();

            expect(result[0]).toMatchObject({
                type: "video",
                url: "https://youtu.be/xyz",
                title: "Titre initial",
            });
        });
    });

    describe("chaînage des méthodes (fluent API)", () => {
        it("doit permettre de définir toutes les propriétés et les retrouver dans la définition", () => {
            const result = DefBuilder.video("https://youtu.be/abc")
                .title("Mon titre")
                .description("Ma description")
                .channel("Ma chaîne", "https://channel.url")
                .thumbnail("https://thumb.jpg")
                .duration(3600)
                .autoplay(AUTOPLAY_MODES.CLICK)
                .start(30)
                .showOnInit(true)
                .target("player1")
                .key("custom-key")
                .name("mon-nom")
                .extra({foo: "bar"})
                .build();

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: "video",
                url: "https://youtu.be/abc",
                title: "Mon titre",
                description: "Ma description",
                channel: "Ma chaîne",
                channelUrl: "https://channel.url",
                thumbnail: "https://thumb.jpg",
                duration: 3600,
                autoplay: AUTOPLAY_MODES.CLICK,
                start: 30,
                showOnInit: true,
                target: "player1",
                key: "custom-key",
                name: "mon-nom",
                extra: {foo: "bar"},
            });
        });

        it("channel() sans url ne doit pas définir channelUrl", () => {
            const result = DefBuilder.video("https://youtu.be/abc")
                .channel("Ma chaîne")
                .build();

            expect(result[0].channel).toBe("Ma chaîne");
            expect(result[0].channelUrl).toBeUndefined();
        });

        it("autoplay() sans argument doit utiliser INIT par défaut", () => {
            const result = DefBuilder.video("https://youtu.be/abc").autoplay().build();
            expect(result[0].autoplay).toBe(AUTOPLAY_MODES.INIT);
        });

        it("showOnInit() sans argument doit utiliser true par défaut", () => {
            const result = DefBuilder.video("https://youtu.be/abc").showOnInit().build();
            expect(result[0].showOnInit).toBe(true);
        });

        it("videos() doit stocker la liste de vidéos", () => {
            const videos = [{id: "v1"}, {id: "v2"}];
            const result = DefBuilder.playlist("PL123").videos(videos).build();

            expect(result[0].videos).toEqual(videos);
        });
    });

    describe("batch (plusieurs définitions dans le même build)", () => {
        it("doit retourner un array avec plusieurs objets quand on enchaîne video/videoList/playlist", () => {
            const result = DefBuilder.video("https://youtu.be/vid1")
                .title("Vidéo 1")
                .video("https://youtu.be/vid2")
                .title("Vidéo 2")
                .playlist("PL999")
                .title("Ma playlist")
                .videoList({ids: ["a", "b"]})
                .title("Liste")
                .build();

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(4);

            expect(result[0]).toMatchObject({
                type: "video",
                url: "https://youtu.be/vid1",
                title: "Vidéo 1",
            });
            expect(result[1]).toMatchObject({
                type: "video",
                url: "https://youtu.be/vid2",
                title: "Vidéo 2",
            });
            expect(result[2]).toMatchObject({
                type: "playlist",
                url: "PL999",
                title: "Ma playlist",
            });
            expect(result[3]).toMatchObject({
                type: "videoList",
                ids: ["a", "b"],
                title: "Liste",
            });
        });

        it("chaque définition doit être indépendante (pas de pollution entre elles)", () => {
            const result = DefBuilder.video("https://youtu.be/1")
                .title("Premier")
                .extra({a: 1})
                .video("https://youtu.be/2")
                .title("Deuxième")
                .build();

            expect(result[0].title).toBe("Premier");
            expect(result[0].extra).toEqual({a: 1});
            expect(result[1].title).toBe("Deuxième");
            expect(result[1].extra).toBeUndefined();
        });
    });

    describe("gestion des erreurs (normalizeSeed)", () => {
        it("doit lever une TypeError si l'input est null ou undefined", () => {
            expect(() => DefBuilder.video(null).build()).toThrow(TypeError);
            expect(() => DefBuilder.video(undefined).build()).toThrow(TypeError);
            expect(() => DefBuilder.video(null).build()).toThrow(/input is required/);
        });

        it("doit lever une TypeError si l'input n'est ni string ni object", () => {
            expect(() => DefBuilder.video(42).build()).toThrow(TypeError);
            expect(() => DefBuilder.video(true).build()).toThrow(TypeError);
            expect(() => DefBuilder.video(() => {
            }).build()).toThrow(TypeError);
        });
    });

    describe("valeurs de retour toujours un array d'objets", () => {
        it("build() doit toujours retourner un Array", () => {
            const single = DefBuilder.video("url").build();
            const multi = DefBuilder.video("url1").video("url2").build();

            expect(Array.isArray(single)).toBe(true);
            expect(Array.isArray(multi)).toBe(true);
        });

        it("chaque élément de l'array doit être un objet plain avec au minimum 'type'", () => {
            const result = DefBuilder.video("https://youtu.be/x")
                .playlist("PL1")
                .videoList({ids: ["a"]})
                .build();

            result.forEach((def) => {
                expect(typeof def).toBe("object");
                expect(def).not.toBeNull();
                expect(def).toHaveProperty("type");
                expect(["video", "videoList", "playlist"]).toContain(def.type);
            });
        });
    });
});