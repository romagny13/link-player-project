// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RegionHost } from "../src/RegionHost.js";

const html = (markup) => { document.body.innerHTML = markup; };
const $ = (sel, root = document) => root.querySelector(sel);

let host;
beforeEach(() => { host = new RegionHost(); });
afterEach(() => { document.body.innerHTML = ""; });

// ───────────────────────── links ─────────────────────────
describe("RegionHost.links", () => {
    it("trouve les [data-link] avec leur url et leur cible", () => {
        html(`<a data-link data-target="player" href="https://www.youtube.com/watch?v=69iUWLA0oVc">A</a>`);
        const [found] = host.links(document);
        expect(found.element).toBe($("a"));
        expect(found.url).toBe("https://www.youtube.com/watch?v=69iUWLA0oVc");
        expect(found.target).toBe("player");
    });

    it("target = null quand data-target est absent ou vide", () => {
        html(`<a data-link href="https://a.test/1">1</a><a data-link data-target="" href="https://a.test/2">2</a>`);
        expect(host.links(document).map((l) => l.target)).toEqual([null, null]);
    });

    it("ignore les éléments sans data-link", () => {
        html(`<a href="https://a.test/1">pas un lien LP</a><a data-link href="https://a.test/2">LP</a>`);
        const links = host.links(document);
        expect(links).toHaveLength(1);
        expect(links[0].url).toBe("https://a.test/2");
    });

    it("<a> : lit href (résolu en URL absolue)", () => {
        html(`<a data-link href="/video/1">relatif</a>`);
        expect(host.links(document)[0].url).toBe(new URL("/video/1", document.baseURI).href);
    });

    it("<a> sans href : ignoré", () => {
        html(`<a data-link>sans href</a><a data-link href="">href vide</a>`);
        // href="" se résout vers l'URL du document : seul l'<a> sans attribut est écarté
        const urls = host.links(document).map((l) => l.url);
        expect(urls).not.toContain("");
        expect(urls).toHaveLength(1);
    });

    it("autres éléments : lit data-url ; sans data-url, ignoré", () => {
        html(`<div data-link data-url="https://ok.ru/video/17222095800962">OK</div><button data-link>rien</button>`);
        const links = host.links(document);
        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({ url: "https://ok.ru/video/17222095800962", target: null });
        expect(links[0].element.tagName).toBe("DIV");
    });

    it("garde l'ordre du document", () => {
        html(`<a data-link href="https://a.test/1"></a><div><a data-link href="https://a.test/2"></a></div><a data-link href="https://a.test/3"></a>`);
        expect(host.links(document).map((l) => l.url)).toEqual(["https://a.test/1", "https://a.test/2", "https://a.test/3"]);
    });

    it("ne cherche que sous la racine donnée", () => {
        html(`<a data-link href="https://a.test/out"></a><section id="scope"><a data-link href="https://a.test/in"></a></section>`);
        expect(host.links($("#scope")).map((l) => l.url)).toEqual(["https://a.test/in"]);
    });

    it("aucun lien → tableau vide", () => {
        html(`<p>rien</p>`);
        expect(host.links(document)).toEqual([]);
    });
});

// ───────────────────────── regions ─────────────────────────
describe("RegionHost.regions", () => {
    it("trouve les éléments par id", () => {
        html(`<div id="a"></div><div id="b"></div>`);
        const found = host.regions(document, ["a", "b"]);
        expect(found).toEqual([{ name: "a", element: $("#a") }, { name: "b", element: $("#b") }]);
    });

    it("ignore les ids sans élément", () => {
        html(`<div id="a"></div>`);
        expect(host.regions(document, ["a", "absent"]).map((r) => r.name)).toEqual(["a"]);
    });

    it("accepte un Set ; sans argument : aucun résultat", () => {
        html(`<div id="a"></div>`);
        expect(host.regions(document, new Set(["a"]))).toHaveLength(1);
        expect(host.regions(document)).toEqual([]);
    });

    it("dédoublonne les ids répétés", () => {
        html(`<div id="a"></div>`);
        expect(host.regions(document, ["a", "a", "a"])).toHaveLength(1);
    });

    it("échappe les caractères spéciaux des ids (host:uuid, points…)", () => {
        html(`<div id="host:1b2c-3d"></div><div id="zone.principale"></div>`);
        const found = host.regions(document, ["host:1b2c-3d", "zone.principale"]);
        expect(found.map((r) => r.name)).toEqual(["host:1b2c-3d", "zone.principale"]);
        expect(found[0].element).toBe(document.getElementById("host:1b2c-3d"));
    });

    it("ne cherche que sous la racine : ni en dehors, ni la racine elle-même", () => {
        html(`<div id="outside"></div><section id="scope"><div id="inside"></div></section>`);
        const scope = $("#scope");
        expect(host.regions(scope, ["outside", "scope"])).toEqual([]);
        expect(host.regions(scope, ["inside"]).map((r) => r.name)).toEqual(["inside"]);
    });

    it("garde l'ordre des ids demandés", () => {
        html(`<div id="a"></div><div id="b"></div><div id="c"></div>`);
        expect(host.regions(document, ["c", "a", "b"]).map((r) => r.name)).toEqual(["c", "a", "b"]);
    });
});

// ───────────────────────── frames ─────────────────────────
describe("RegionHost.frames", () => {
    it("renvoie toutes les iframes de la racine (imbriquées dans des conteneurs comprises)", () => {
        html(`<iframe id="f1"></iframe><div><div><iframe id="f2"></iframe></div></div>`);
        expect(host.frames(document)).toEqual([$("#f1"), $("#f2")]);
    });

    it("ne cherche que sous la racine donnée", () => {
        html(`<iframe id="out"></iframe><section id="scope"><iframe id="in"></iframe></section>`);
        expect(host.frames($("#scope"))).toEqual([$("#in")]);
    });

    it("aucune iframe → tableau vide ; résultat = vrai tableau (pas une NodeList)", () => {
        html(`<p></p>`);
        const frames = host.frames(document);
        expect(frames).toEqual([]);
        expect(Array.isArray(frames)).toBe(true);
    });
});

// ───────────────────────── discover ─────────────────────────
describe("RegionHost.discover", () => {
    it("renvoie { links, regions, frames }", () => {
        html(`
            <a data-link data-target="player" href="https://a.test/1">A</a>
            <div id="player"></div>
            <iframe id="f"></iframe>`);
        const found = host.discover(document);
        expect(Object.keys(found).sort()).toEqual(["frames", "links", "regions"]);
        expect(found.links).toHaveLength(1);
        expect(found.regions).toEqual([{ name: "player", element: $("#player") }]);
        expect(found.frames).toEqual([$("#f")]);
    });

    it("sans argument : regarde tout le document", () => {
        html(`<a data-link data-target="p" href="https://a.test/1"></a><div id="p"></div>`);
        expect(host.discover().links).toHaveLength(1);
    });

    it("cherche les régions des cibles des liens", () => {
        html(`
            <a data-link data-target="p1" href="https://a.test/1"></a>
            <a data-link data-target="p2" href="https://a.test/2"></a>
            <div id="p1"></div><div id="p2"></div><div id="autre"></div>`);
        expect(host.discover(document).regions.map((r) => r.name)).toEqual(["p1", "p2"]);
    });

    it("plusieurs liens vers la même cible → une seule région", () => {
        html(`
            <a data-link data-target="p" href="https://a.test/1"></a>
            <a data-link data-target="p" href="https://a.test/2"></a>
            <div id="p"></div>`);
        const found = host.discover(document);
        expect(found.links).toHaveLength(2);
        expect(found.regions).toHaveLength(1);
    });

    it("defaultTarget : cherché même sans lien ; les liens sans cible n'ajoutent rien", () => {
        html(`<a data-link href="https://a.test/1"></a><div id="def"></div><div id="x"></div>`);
        expect(host.discover(document, { defaultTarget: "def" }).regions.map((r) => r.name)).toEqual(["def"]);
        expect(host.discover(document).regions).toEqual([]);
    });

    it("targets : noms déjà connus de l'appelant (définitions, régions demandées par code)", () => {
        html(`<div id="code"></div><div id="defs"></div>`);
        const found = host.discover(document, { targets: ["code", "defs", "inexistant"] });
        expect(found.regions.map((r) => r.name)).toEqual(["code", "defs"]);
    });

    it("ordre : cibles des liens, puis defaultTarget, puis targets ; sans doublon", () => {
        html(`
            <a data-link data-target="l1" href="https://a.test/1"></a>
            <div id="t1"></div><div id="def"></div><div id="l1"></div>`);
        const names = host.discover(document, { defaultTarget: "def", targets: ["t1", "l1", "def"] }).regions.map((r) => r.name);
        expect(names).toEqual(["l1", "def", "t1"]);
    });

    it("une cible de lien vide ou nulle n'est pas cherchée", () => {
        html(`<a data-link data-target="" href="https://a.test/1"></a><div id=""></div>`);
        expect(host.discover(document).regions).toEqual([]);
    });

    it("respecte la portée (root) pour liens, régions et iframes", () => {
        html(`
            <a data-link data-target="p" href="https://a.test/out"></a><div id="p"></div><iframe id="f-out"></iframe>
            <section id="scope">
                <a data-link data-target="q" href="https://a.test/in"></a><div id="q"></div><iframe id="f-in"></iframe>
            </section>`);
        const found = host.discover($("#scope"));
        expect(found.links.map((l) => l.url)).toEqual(["https://a.test/in"]);
        expect(found.regions.map((r) => r.name)).toEqual(["q"]);
        expect(found.frames).toEqual([$("#f-in")]);
    });

    it("sans état : deux appels donnent les mêmes résultats", () => {
        html(`<a data-link data-target="p" href="https://a.test/1"></a><div id="p"></div><iframe></iframe>`);
        const first = host.discover(document);
        const second = host.discover(document);
        expect(second).toEqual(first);
        expect(second.links[0].element).toBe(first.links[0].element);
    });

    it("ne modifie pas le DOM (pas de data-lp, pas d'attribut ajouté)", () => {
        html(`<a data-link data-target="p" href="https://a.test/1"></a><div id="p"></div>`);
        const before = document.body.innerHTML;
        host.discover(document);
        expect(document.body.innerHTML).toBe(before);
    });

    it("retrouve un élément ajouté après un premier appel (pas de cache)", () => {
        html(`<a data-link data-target="late" href="https://a.test/1"></a>`);
        expect(host.discover(document).regions).toEqual([]);
        document.body.insertAdjacentHTML("beforeend", `<div id="late"></div>`);
        expect(host.discover(document).regions.map((r) => r.name)).toEqual(["late"]);
    });

    it("n'écarte pas les éléments déjà pris en charge (c'est le travail de LinkPlayer)", () => {
        html(`<a data-link data-lp="binder" href="https://a.test/1"></a>`);
        expect(host.discover(document).links).toHaveLength(1);
    });
});

// ───────────────────────── contrat de remplacement ─────────────────────────
describe("RegionHost : sous-classe", () => {
    it("discover utilise les méthodes surchargées links / regions / frames", () => {
        class CustomHost extends RegionHost {
            links() { return [{ element: null, url: "https://x.test", target: "t" }]; }
            regions(_root, ids) { return [...ids].map((name) => ({ name, element: null })); }
            frames() { return []; }
        }
        const found = new CustomHost().discover(document, { defaultTarget: "d", targets: ["k"] });
        expect(found.links).toHaveLength(1);
        expect(found.regions.map((r) => r.name)).toEqual(["t", "d", "k"]);
        expect(found.frames).toEqual([]);
    });
});