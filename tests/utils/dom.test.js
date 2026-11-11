import { describe, it, expect, beforeEach } from "vitest";
import { resolveScope, injectStyles, makeIframe } from "../../src/utils/dom.js";

describe("resolveScope", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="player-root"></div>
            <section class="scope-a"></section>
        `;
    });

    it("retourne null si scope est null/undefined", () => {
        expect(resolveScope(null)).toBeNull();
        expect(resolveScope(undefined)).toBeNull();
    });

    it("trouve par id", () => {
        const node = resolveScope("player-root");
        expect(node).toBeInstanceOf(HTMLElement);
        expect(node.id).toBe("player-root");
    });

    it("trouve par sélecteur CSS si l'id échoue", () => {
        const node = resolveScope(".scope-a");
        expect(node).toBeInstanceOf(HTMLElement);
        expect(node.classList.contains("scope-a")).toBe(true);
    });

    it("throw si introuvable", () => {
        expect(() => resolveScope("does-not-exist")).toThrow(/Scope not found/);
        expect(() => resolveScope(".missing")).toThrow(/Scope not found/);
    });

    it("throw proprement sur un sélecteur invalide (sans planter)", () => {
        // querySelector throw sur certains sélecteurs mal formés
        expect(() => resolveScope("[invalid")).toThrow(/Scope not found/);
    });
});

describe("injectStyles", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
    });

    it("injecte une balise style avec le bon id et contenu", () => {
        injectStyles("yt-embed-css", ".foo { color: red; }");

        const el = document.getElementById("yt-embed-css");
        expect(el).toBeTruthy();
        expect(el.tagName).toBe("STYLE");
        expect(el.textContent).toBe(".foo { color: red; }");
        expect(document.head.contains(el)).toBe(true);
    });

    it("n'injecte pas deux fois le même id", () => {
        injectStyles("yt-embed-css", ".a {}");
        injectStyles("yt-embed-css", ".b {}"); // doit être ignoré

        const styles = document.querySelectorAll("#yt-embed-css");
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toBe(".a {}");
    });
});

describe("makeIframe", () => {
    it("crée un iframe avec src obligatoire", () => {
        const iframe = makeIframe({ src: "https://www.youtube.com/embed/abc" });

        expect(iframe).toBeInstanceOf(HTMLIFrameElement);
        expect(iframe.src).toContain("https://www.youtube.com/embed/abc");
        expect(iframe.frameBorder).toBe("0");
        expect(iframe.allowFullscreen).toBe(true); // défaut
    });

    it("throw si src manquant", () => {
        expect(() => makeIframe({})).toThrow(TypeError);
        expect(() => makeIframe({ src: "" })).toThrow(TypeError);
    });

    it("applique width, height, title, allow, referrerPolicy", () => {
        const iframe = makeIframe({
            src: "https://example.com",
            width: 560,
            height: 315,
            title: "Video",
            allow: "autoplay; encrypted-media",
            referrerPolicy: "strict-origin-when-cross-origin",
        });

        expect(iframe.width).toBe("560");
        expect(iframe.height).toBe("315");
        expect(iframe.title).toBe("Video");
        expect(iframe.allow).toBe("autoplay; encrypted-media");
        expect(iframe.referrerPolicy).toBe("strict-origin-when-cross-origin");
    });

    it("peut désactiver allowFullscreen", () => {
        const iframe = makeIframe({
            src: "https://example.com",
            allowFullscreen: false,
        });
        expect(iframe.allowFullscreen).toBe(false);
    });

    it("applique extraAttrs", () => {
        const iframe = makeIframe({
            src: "https://example.com",
            extraAttrs: {
                loading: "lazy",
                "data-testid": "yt-frame",
            },
        });

        expect(iframe.getAttribute("loading")).toBe("lazy");
        expect(iframe.getAttribute("data-testid")).toBe("yt-frame");
    });

    it("n'impose pas width/height si absents", () => {
        const iframe = makeIframe({ src: "https://example.com" });
        // jsdom : width/height vides ou attributs absents
        expect(iframe.getAttribute("width")).toBeNull();
        expect(iframe.getAttribute("height")).toBeNull();
    });
});