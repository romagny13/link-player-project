import { describe, it, expect } from "vitest";
import { Media, AUTOPLAY_MODES } from "../../src/utils/helpers.js";

describe("Media (builder de définitions)", () => {
    describe("création", () => {
        it.each(["video", "videoList", "playlist"])("Media.%s(url) -> une définition du bon type", (type) => {
            expect(Media[type]("https://x.test/a").build()).toEqual([{type, url: "https://x.test/a"}]);
        });

        it("accepte un objet comme graine", () => {
            const defs = Media.video({url: "https://x.test/a", target: "player", title: "T"}).build();
            expect(defs).toEqual([{type: "video", url: "https://x.test/a", target: "player", title: "T"}]);
        });

        it("copie l'objet d'entrée : l'original n'est jamais modifié", () => {
            const seed = {url: "https://x.test/a"};
            Media.video(seed).title("T").target("p").build();
            expect(seed).toEqual({url: "https://x.test/a"});
        });

        it("deux builders créés depuis le même objet sont indépendants", () => {
            const seed = {url: "https://x.test/a"};
            const a = Media.video(seed).title("A").build();
            const b = Media.video(seed).title("B").build();
            expect(a[0].title).toBe("A");
            expect(b[0].title).toBe("B");
        });

        it("deux chaînes issues de Media sont indépendantes (pas de liste partagée)", () => {
            const a = Media.video("a");
            const b = Media.video("b");
            expect(a.build()).toHaveLength(1);
            expect(b.build()).toHaveLength(1);
            expect(a.build()).not.toBe(b.build());
        });

        it.each([[null], [undefined]])("lève TypeError si l'entrée est %j", (input) => {
            expect(() => Media.video(input)).toThrow(TypeError);
            expect(() => Media.video(input)).toThrow("Media: input is required");
        });

        it.each([[42], [true], [() => {}], [Symbol("x")]])("lève TypeError si l'entrée est %s", (input) => {
            expect(() => Media.video(input)).toThrow(TypeError);
            expect(() => Media.video(input)).toThrow("Media: expected url string or object");
        });

        it("une chaîne vide est acceptée telle quelle (pas de validation ici)", () => {
            expect(Media.video("").build()).toEqual([{type: "video", url: ""}]);
        });

        // Aujourd'hui `{type, ...seed}` laisse seed.type écraser le type du builder.
        it.todo("le type du builder ne peut pas être écrasé par seed.type");
        // Aujourd'hui un tableau passe `typeof === "object"` et est étalé en {0: ..., 1: ...}.
        it.todo("un tableau comme entrée est rejeté");
    });

    describe("setters", () => {
        it.each([
            ["title", "Titre"],
            ["channel", "Chaîne"],
            ["thumbnail", "https://x.test/t.jpg"],
            ["start", 90],
            ["target", "player"],
            ["key", "intro"],
            ["name", "intro"],
        ])("%s(v) écrit la propriété et retourne le builder", (prop, value) => {
            const b = Media.video("https://x.test/a");
            expect(b[prop](value)).toBe(b);
            expect(b.build()[0][prop]).toBe(value);
        });

        it("autoplay() sans argument -> 'init'", () => {
            expect(Media.video("a").autoplay().build()[0].autoplay).toBe(AUTOPLAY_MODES.INIT);
            expect(AUTOPLAY_MODES.INIT).toBe("init");
        });

        it.each([["click"], ["none"], [true], [false]])("autoplay(%j) est transmis tel quel (pas de normalisation)", (v) => {
            expect(Media.video("a").autoplay(v).build()[0].autoplay).toBe(v);
        });

        it("showOnInit() sans argument -> true, et accepte false", () => {
            expect(Media.video("a").showOnInit().build()[0].showOnInit).toBe(true);
            expect(Media.video("a").showOnInit(false).build()[0].showOnInit).toBe(false);
        });

        it("un setter écrase la valeur venant de la graine", () => {
            const def = Media.video({url: "a", title: "Ancien"}).title("Nouveau").build()[0];
            expect(def.title).toBe("Nouveau");
        });

        it("le dernier appel d'un même setter l'emporte", () => {
            expect(Media.video("a").title("1").title("2").build()[0].title).toBe("2");
        });

        it("plusieurs setters s'enchaînent", () => {
            const def = Media.video("https://x.test/a")
                .title("T").channel("C").thumbnail("th").autoplay("click").start("1m30s")
                .showOnInit().target("p").key("k")
                .build()[0];
            expect(def).toEqual({
                type: "video",
                url: "https://x.test/a",
                title: "T",
                channel: "C",
                thumbnail: "th",
                autoplay: "click",
                start: "1m30s",
                showOnInit: true,
                target: "p",
                key: "k"
            });
        });
    });

    describe("videos()", () => {
 
        it("un tableau -> videos (et pas count)", () => {
            const videos = [{id: "a", title: "A"}, {title: "B"}];
            const def = Media.playlist("a").videos(videos).build()[0];
            expect(def.videos).toBe(videos);
        });

        it("retourne le builder", () => {
            const b = Media.videoList("a");
            expect(b.videos([])).toBe(b);
            expect(b.videos(3)).toBe(b);
        });
    });

    describe("enchaînement de types (liste partagée)", () => {
        it("video().video() ajoute à la même liste, dans l'ordre de création", () => {
            const defs = Media.video("a").video("b").videoList("c").playlist("d").build();
            expect(defs.map((d) => [d.type, d.url])).toEqual([
                ["video", "a"],
                ["video", "b"],
                ["videoList", "c"],
                ["playlist", "d"]
            ]);
        });

        it("chaque méthode de type retourne un NOUVEAU builder", () => {
            const a = Media.video("a");
            const b = a.video("b");
            expect(b).not.toBe(a);
        });

        it("les setters s'appliquent à la définition courante uniquement", () => {
            const defs = Media.video("a").title("A")
                .videoList("b").autoplay("click").title("B")
                .playlist("c")
                .build();

            expect(defs[0]).toEqual({type: "video", url: "a", title: "A"});
            expect(defs[1]).toEqual({type: "videoList", url: "b", autoplay: "click", title: "B"});
            expect(defs[2]).toEqual({type: "playlist", url: "c"});
        });

        it("build() depuis n'importe quel builder de la chaîne retourne la même liste complète", () => {
            const first = Media.video("a");
            const second = first.video("b");
            expect(first.build()).toBe(second.build());
            expect(first.build()).toHaveLength(2);
        });

        it("build() est idempotent (même tableau à chaque appel)", () => {
            const b = Media.video("a");
            expect(b.build()).toBe(b.build());
        });

        it("accepte des objets comme graine à chaque étape", () => {
            const defs = Media.video({url: "a", target: "p"}).playlist({url: "b", target: "q"}).build();
            expect(defs.map((d) => d.target)).toEqual(["p", "q"]);
        });

        it("une entrée invalide en milieu de chaîne lève et n'ajoute rien", () => {
            const first = Media.video("a");
            expect(() => first.video(null)).toThrow(TypeError);
            expect(first.build()).toHaveLength(1);
        });

        it("un ancien builder reste utilisable : il modifie sa propre définition dans la liste partagée", () => {
            const a = Media.video("a");
            a.video("b");
            a.title("Modifié après coup");
            const defs = a.build();
            expect(defs[0].title).toBe("Modifié après coup");
            expect(defs[1]).toEqual({type: "video", url: "b"});
        });

        it("les définitions retournées par build() restent « vivantes » : un setter appelé après build() les modifie", () => {
            const b = Media.video("a");
            const defs = b.build();
            b.title("tard");
            expect(defs[0].title).toBe("tard");
        });
    });

    describe("AUTOPLAY_MODES", () => {
        it("est figé et expose les trois modes", () => {
            expect(Object.isFrozen(AUTOPLAY_MODES)).toBe(true);
            expect(AUTOPLAY_MODES).toEqual({NONE: "none", INIT: "init", CLICK: "click"});
        });
    });
});