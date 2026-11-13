import {afterEach, describe, expect, it, vi} from "vitest";
import {OkruEmbedSrcBuilder} from "../../../src/providers/okru/OkruEmbedSrcBuilder.js";

const DIRECT = "https://ok.ru/videoembed";
const RELAY = "https://relais.exemple.fr/embed";
const ORIGIN = "https://page.fr";

const params = (url) => new URL(url).searchParams;

/** Builder en mode relais, avec une origine parente fixe. */
const relais = (options = {}) =>
    new OkruEmbedSrcBuilder({relayBaseUrl: RELAY, parentOrigin: ORIGIN, ...options});

describe("OkruEmbedSrcBuilder", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe("isRelay", () => {
        it("est faux par défaut (mode direct)", () => {
            expect(new OkruEmbedSrcBuilder().isRelay).toBe(false);
        });

        it("est vrai quand une URL de relais est fournie", () => {
            expect(new OkruEmbedSrcBuilder({relayBaseUrl: RELAY}).isRelay).toBe(true);
        });

        it("est faux pour une URL de relais vide ou nulle", () => {
            expect(new OkruEmbedSrcBuilder({relayBaseUrl: ""}).isRelay).toBe(false);
            expect(new OkruEmbedSrcBuilder({relayBaseUrl: null}).isRelay).toBe(false);
        });

        it("accepte l'absence totale d'options", () => {
            expect(() => new OkruEmbedSrcBuilder()).not.toThrow();
        });
    });

    describe("build() : validation", () => {
        it("lève une TypeError sans videoId", () => {
            const builder = new OkruEmbedSrcBuilder();
            expect(() => builder.build()).toThrow(TypeError);
            expect(() => builder.build({})).toThrow("videoId is required");
            expect(() => builder.build({videoId: ""})).toThrow(TypeError);
            expect(() => builder.build({videoId: null})).toThrow(TypeError);
        });

        it("lève aussi une TypeError en mode relais", () => {
            expect(() => relais().build({})).toThrow("videoId is required");
        });
    });

    describe("mode direct", () => {
        const direct = () => new OkruEmbedSrcBuilder();

        it("place le videoId dans le chemin, sans paramètre par défaut", () => {
            expect(direct().build({videoId: "123"})).toBe(`${DIRECT}/123`);
        });

        it("encode le videoId dans le chemin", () => {
            expect(direct().build({videoId: "a b/c"})).toBe(`${DIRECT}/a%20b%2Fc`);
        });

        it("accepte un videoId numérique", () => {
            expect(direct().build({videoId: 123})).toBe(`${DIRECT}/123`);
        });

        it("ajoute autoplay=1 quand il est vrai", () => {
            expect(direct().build({videoId: "123", autoplay: true})).toBe(`${DIRECT}/123?autoplay=1`);
        });

        it("n'ajoute rien quand autoplay est faux ou absent", () => {
            expect(direct().build({videoId: "123", autoplay: false})).toBe(`${DIRECT}/123`);
        });

        it("ajoute fromTime en secondes", () => {
            expect(direct().build({videoId: "123", startSeconds: 90})).toBe(`${DIRECT}/123?fromTime=90`);
        });

        it("arrondit fromTime à l'entier inférieur", () => {
            expect(params(direct().build({videoId: "123", startSeconds: 90.9})).get("fromTime")).toBe("90");
        });

        it("ignore 0, les valeurs négatives et l'absence de valeur", () => {
            expect(direct().build({videoId: "123", startSeconds: 0})).toBe(`${DIRECT}/123`);
            expect(direct().build({videoId: "123", startSeconds: -3})).toBe(`${DIRECT}/123`);
            expect(direct().build({videoId: "123", startSeconds: undefined})).toBe(`${DIRECT}/123`);
        });

        it("combine autoplay puis fromTime", () => {
            expect(direct().build({videoId: "123", autoplay: true, startSeconds: 90}))
                .toBe(`${DIRECT}/123?autoplay=1&fromTime=90`);
        });

        it("n'ajoute jamais parentOrigin, même si une origine est connue", () => {
            vi.stubGlobal("location", {origin: ORIGIN});
            const url = new OkruEmbedSrcBuilder({parentOrigin: ORIGIN}).build({videoId: "123"});
            expect(params(url).has("parentOrigin")).toBe(false);
        });
    });

    describe("mode relais", () => {
        it("utilise l'URL du relais avec le paramètre videoId", () => {
            const url = relais().build({videoId: "123"});
            const u = new URL(url);
            expect(`${u.origin}${u.pathname}`).toBe(RELAY);
            expect(u.searchParams.get("videoId")).toBe("123");
        });

        it("produit l'URL exacte attendue avec tous les paramètres, dans l'ordre", () => {
            const url = relais().build({videoId: "123", autoplay: true, startSeconds: 90});
            expect(url).toBe(
                `${RELAY}?videoId=123&autoplay=1&startSeconds=90&parentOrigin=${encodeURIComponent(ORIGIN)}`
            );
        });

        it("n'ajoute pas autoplay quand il est faux ou absent", () => {
            expect(params(relais().build({videoId: "123"})).has("autoplay")).toBe(false);
            expect(params(relais().build({videoId: "123", autoplay: false})).has("autoplay")).toBe(false);
        });

        it("ajoute autoplay=1 quand il est vrai", () => {
            expect(params(relais().build({videoId: "123", autoplay: true})).get("autoplay")).toBe("1");
        });

        it("utilise startSeconds (et non fromTime) pour le temps de départ", () => {
            const p = params(relais().build({videoId: "123", startSeconds: 45.7}));
            expect(p.get("startSeconds")).toBe("45");
            expect(p.has("fromTime")).toBe(false);
        });

        it("ignore 0, les valeurs négatives et l'absence de valeur", () => {
            expect(params(relais().build({videoId: "123", startSeconds: 0})).has("startSeconds")).toBe(false);
            expect(params(relais().build({videoId: "123", startSeconds: -1})).has("startSeconds")).toBe(false);
            expect(params(relais().build({videoId: "123"})).has("startSeconds")).toBe(false);
        });

        it("encode correctement un videoId contenant des caractères spéciaux", () => {
            const url = relais().build({videoId: "a b&c"});
            expect(params(url).get("videoId")).toBe("a b&c");
        });

        it("conserve les paramètres déjà présents dans l'URL du relais", () => {
            const builder = new OkruEmbedSrcBuilder({
                relayBaseUrl: `${RELAY}?theme=dark`,
                parentOrigin: ORIGIN
            });
            const p = params(builder.build({videoId: "123"}));
            expect(p.get("theme")).toBe("dark");
            expect(p.get("videoId")).toBe("123");
        });

        it("accepte un relais avec un paramètre vide (ex. ?id=)", () => {
            const builder = new OkruEmbedSrcBuilder({
                relayBaseUrl: "https://okru-embed.vercel.app/?id=",
                parentOrigin: ORIGIN
            });
            const p = params(builder.build({videoId: "123"}));
            expect(p.get("videoId")).toBe("123");
            expect(p.get("id")).toBe("");
        });

        it("remplace un videoId déjà présent dans l'URL du relais", () => {
            const builder = new OkruEmbedSrcBuilder({
                relayBaseUrl: `${RELAY}?videoId=ancien`,
                parentOrigin: ORIGIN
            });
            expect(params(builder.build({videoId: "nouveau"})).getAll("videoId")).toEqual(["nouveau"]);
        });

        it("ne modifie pas l'URL du relais entre deux appels", () => {
            const builder = relais();
            builder.build({videoId: "1", autoplay: true});
            const second = builder.build({videoId: "2"});
            expect(params(second).get("videoId")).toBe("2");
            expect(params(second).has("autoplay")).toBe(false);
        });

        it("lève une erreur à la construction de l'URL quand le relais est invalide", () => {
            const builder = new OkruEmbedSrcBuilder({relayBaseUrl: "pas une url"});
            expect(builder.isRelay).toBe(true);
            expect(() => builder.build({videoId: "123"})).toThrow(TypeError);
        });

        describe("parentOrigin", () => {
            it("utilise l'origine fournie", () => {
                expect(params(relais().build({videoId: "1"})).get("parentOrigin")).toBe(ORIGIN);
            });

            it("prend l'origine de la page par défaut", () => {
                vi.stubGlobal("location", {origin: "https://autre.fr"});
                const builder = new OkruEmbedSrcBuilder({relayBaseUrl: RELAY});
                expect(params(builder.build({videoId: "1"})).get("parentOrigin")).toBe("https://autre.fr");
            });

            it("lit l'origine de la page au moment du build, pas de la construction", () => {
                vi.stubGlobal("location", {origin: "https://avant.fr"});
                const builder = new OkruEmbedSrcBuilder({relayBaseUrl: RELAY});
                vi.stubGlobal("location", {origin: "https://apres.fr"});
                expect(params(builder.build({videoId: "1"})).get("parentOrigin")).toBe("https://apres.fr");
            });

            it("préfère l'origine fournie à celle de la page", () => {
                vi.stubGlobal("location", {origin: "https://autre.fr"});
                expect(params(relais().build({videoId: "1"})).get("parentOrigin")).toBe(ORIGIN);
            });

            it("n'ajoute rien quand aucune origine n'est disponible", () => {
                vi.stubGlobal("location", undefined);
                const builder = new OkruEmbedSrcBuilder({relayBaseUrl: RELAY});
                expect(params(builder.build({videoId: "1"})).has("parentOrigin")).toBe(false);
            });

            it("n'ajoute rien pour une origine fournie vide", () => {
                vi.stubGlobal("location", {origin: "https://autre.fr"});
                const builder = new OkruEmbedSrcBuilder({relayBaseUrl: RELAY, parentOrigin: ""});
                expect(params(builder.build({videoId: "1"})).has("parentOrigin")).toBe(false);
            });
        });
    });
});