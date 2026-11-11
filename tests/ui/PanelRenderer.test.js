import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    PanelRenderer,
    groupBySeason,
    ensureRelative,
    GroupRenderer,
    HeaderRenderer,
    ItemRenderer,
    ToggleRenderer,
} from "../../src/ui/PanelRenderer.js"; // adapte le chemin

vi.mock("../utils/dom.js", () => ({
    injectStyles: vi.fn(),
}));

vi.mock("../ThumbnailService.js", () => ({
    ThumbnailService: class {
        resolve = vi.fn(async (path) => (path ? `resolved:${path}` : null));
    },
}));

function makeHostWithIframe() {
    const host = document.createElement("div");
    const iframe = document.createElement("iframe");
    host.append(iframe);
    document.body.append(host);
    return { host, iframe };
}

function makeInfo(videos, extra = {}) {
    return { videos, ...extra };
}

describe("ensureRelative", () => {
    it("doit passer position relative si l'élément est static", () => {
        const el = document.createElement("div");
        document.body.append(el);
        // jsdom : souvent static par défaut
        ensureRelative(el);
        expect(el.style.position).toBe("relative");
        el.remove();
    });

    it("ne doit pas écraser une position non-static", () => {
        const el = document.createElement("div");
        el.style.position = "absolute";
        document.body.append(el);
        ensureRelative(el);
        expect(el.style.position).toBe("absolute");
        el.remove();
    });
});

describe("groupBySeason", () => {
    it("doit retourner null s'il n'y a qu'un seul groupe utile", () => {
        const items = [{ title: "Episode 1" }, { title: "Episode 2" }];
        expect(groupBySeason(items)).toBeNull();
    });

    it("doit grouper à partir des titres (Season / Saison / S01)", () => {
        const items = [
            { title: "S01E01 Pilot" },
            { title: "S01E02 Next" },
            { title: "Season 2 Episode 1" },
            { title: "Saison 2 Suite" },
        ];
        const groups = groupBySeason(items);
        expect(groups).toEqual([
            { key: 1, label: "Season 1", start: 0, end: 2 },
            { key: 2, label: "Season 2", start: 2, end: 4 },
        ]);
    });

    it("doit utiliser des counts explicites", () => {
        const items = Array.from({ length: 5 }, (_, i) => ({ title: `V${i}` }));
        const groups = groupBySeason(items, [2, 2]);
        expect(groups).toEqual([
            { label: "Season 1", start: 0, end: 2 },
            { label: "Season 2", start: 2, end: 4 },
            { label: "Other", start: 4, end: 5 },
        ]);
    });

    it("doit retourner null si counts ne produit qu'un seul groupe", () => {
        const items = [{ title: "A" }, { title: "B" }];
        expect(groupBySeason(items, [10])).toBeNull();
    });
});

describe("GroupRenderer", () => {
    it("doit rendre un bouton de groupe avec label, count et aria-expanded", () => {
        const el = new GroupRenderer().render({
            label: "Season 1",
            count: 3,
            collapsed: true,
        });
        expect(el.tagName).toBe("BUTTON");
        expect(el.className).toBe("lp-group-head");
        expect(el.textContent).toBe("Season 1 · 3");
        expect(el.dataset.lpAction).toBe("toggle-group");
        expect(el.getAttribute("aria-expanded")).toBe("false");
    });
});

describe("HeaderRenderer", () => {
    it("doit afficher le titre et le bouton close si canClose", () => {
        const el = new HeaderRenderer().render({ count: 4, canClose: true });
        expect(el.className).toBe("lp-head");
        expect(el.querySelector(".lp-head-title").textContent).toBe("Playlist · 4");
        const close = el.querySelector(".lp-close");
        expect(close).not.toBeNull();
        expect(close.dataset.lpAction).toBe("close");
    });

    it("ne doit pas afficher close si canClose est false", () => {
        const el = new HeaderRenderer().render({ count: 2, canClose: false });
        expect(el.querySelector(".lp-close")).toBeNull();
    });
});

describe("ToggleRenderer", () => {
    it("doit créer un bouton toggle avec position string", () => {
        const el = new ToggleRenderer().render({ position: "bottom-left" });
        expect(el.className).toBe("lp-toggle");
        expect(el.dataset.pos).toBe("bottom-left");
        expect(el.getAttribute("aria-label")).toBe("Show playlist");
    });

    it("doit appliquer des styles si position est un objet", () => {
        const el = new ToggleRenderer().render({
            position: { top: "10px", left: "20px" },
        });
        expect(el.style.top).toBe("10px");
        expect(el.style.left).toBe("20px");
    });
});

describe("ItemRenderer", () => {
    it("doit rendre un item sans thumbnail avec numéro", () => {
        const row = new ItemRenderer().render(
            { title: "Ma vidéo", channel: "Chaîne" },
            2,
            false
        );
        expect(row.className).toBe("lp-item");
        expect(row.dataset.index).toBe("2");
        expect(row.querySelector(".lp-title").textContent).toBe("Ma vidéo");
        expect(row.querySelector(".lp-chan").textContent).toBe("Chaîne");
        expect(row.querySelector(".lp-num").textContent).toBe("03");
        expect(row.querySelector(".lp-thumb")).toBeNull();
    });

    it("doit marquer l'item courant", () => {
        const row = new ItemRenderer().render({ title: "X" }, 0, true);
        expect(row.hasAttribute("data-current")).toBe(true);
        expect(row.getAttribute("aria-current")).toBe("true");
    });

    it("doit rendre une thumbnail et résoudre l'URL", async () => {
        const thumbnails = {
            resolve: vi.fn(async () => "https://cdn.test/t.jpg"),
        };
        const row = new ItemRenderer(thumbnails).render(
            { title: "T", thumbnailPath: "path/t.jpg" },
            0,
            false
        );
        expect(row.querySelector(".lp-thumb")).not.toBeNull();
        expect(thumbnails.resolve).toHaveBeenCalledWith("path/t.jpg");

        await Promise.resolve();
        await Promise.resolve();
        expect(row.querySelector("img").src).toContain("https://cdn.test/t.jpg");
    });

    it("doit utiliser un titre par défaut si absent", () => {
        const row = new ItemRenderer().render({}, 4, false);
        expect(row.querySelector(".lp-title").textContent).toBe("Video 5");
    });
});

describe("PanelRenderer", () => {
    let host, iframe, renderer;

    beforeEach(() => {
        document.body.innerHTML = "";
        ({ host, iframe } = makeHostWithIframe());
        renderer = new PanelRenderer({ open: true, header: true, seasons: false });
    });

    afterEach(() => {
        renderer.destroy();
        document.body.innerHTML = "";
    });

    describe("render", () => {
        it("doit lever une erreur sans host ni iframe attachée", () => {
            expect(() =>
                renderer.render({ info: makeInfo([{ title: "A" }]) })
            ).toThrow(/host or an attached iframe is required/);
        });

        it("doit créer le panel, le scroll, le handle et le toggle", () => {
            const info = makeInfo([
                { title: "V1" },
                { title: "V2" },
            ]);

            renderer.render({ host, iframe, info });

            expect(host.classList.contains("lp-host")).toBe(true);
            expect(host.querySelector(".lp-panel")).not.toBeNull();
            expect(host.querySelector(".lp-scroll")).not.toBeNull();
            expect(host.querySelector(".lp-handle")).not.toBeNull();
            expect(host.querySelector(".lp-toggle")).not.toBeNull();
            expect(host.querySelectorAll(".lp-item")).toHaveLength(2);
        });

        it("doit utiliser iframe.parentElement comme host si host omis", () => {
            const info = makeInfo([{ title: "Only" }]);
            renderer.render({ iframe, info });
            expect(host.querySelector(".lp-panel")).not.toBeNull();
        });

        it("doit afficher le header avec le bon count", () => {
            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }, { title: "B" }, { title: "C" }]),
            });
            expect(host.querySelector(".lp-head-title").textContent).toBe(
                "Playlist · 3"
            );
        });

        it("ne doit pas afficher le header si options.header === false", () => {
            renderer = new PanelRenderer({ header: false, seasons: false });
            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }]),
            });
            expect(host.querySelector(".lp-head")).toBeNull();
        });

        it("doit wrapper un info unique (sans videos) en liste d'un item", () => {
            renderer.render({
                host,
                iframe,
                info: { title: "Solo", index: 0 },
            });
            expect(host.querySelectorAll(".lp-item")).toHaveLength(1);
            expect(host.querySelector(".lp-title").textContent).toBe("Solo");
        });

        it("doit ouvrir le panel selon options.open", () => {
            renderer = new PanelRenderer({ open: false, seasons: false });
            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }]),
            });
            const panel = host.querySelector(".lp-panel");
            expect(panel.dataset.open).toBe("false");
            expect(host.querySelector(".lp-toggle").hidden).toBe(false);
        });

        it("doit définir --lp-w sur le host", () => {
            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }]),
            });
            expect(host.style.getPropertyValue("--lp-w")).toMatch(/px$/);
        });
    });

    describe("sélection d'item", () => {
        it("doit appeler onSelectItem au clic sur un item", () => {
            const onSelectItem = vi.fn();
            const info = makeInfo([{ title: "A" }, { title: "B" }]);

            renderer.render({ host, iframe, info, onSelectItem });

            host.querySelectorAll(".lp-item")[1].click();
            expect(onSelectItem).toHaveBeenCalledWith(1, info);
        });

        it("doit sélectionner via Enter sur un item focusable", () => {
            const onSelectItem = vi.fn();
            const info = makeInfo([{ title: "A" }, { title: "B" }]);
            renderer.render({ host, iframe, info, onSelectItem });

            const row = host.querySelectorAll(".lp-item")[0];
            row.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
            );
            expect(onSelectItem).toHaveBeenCalledWith(0, info);
        });
    });

    describe("open / close / toggle", () => {
        it("close doit fermer le panel et afficher le toggle", () => {
            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }]),
            });

            host.querySelector(".lp-close").click();

            expect(host.querySelector(".lp-panel").dataset.open).toBe("false");
            expect(host.querySelector(".lp-toggle").hidden).toBe(false);
        });

        it("toggle doit rouvrir le panel", () => {
            renderer = new PanelRenderer({ open: false, seasons: false });
            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }]),
            });

            host.querySelector(".lp-toggle").click();

            expect(host.querySelector(".lp-panel").dataset.open).toBe("true");
            expect(host.querySelector(".lp-toggle").hidden).toBe(true);
        });
    });

    describe("setCurrent", () => {
        it("doit marquer l'item courant sans tout redessiner", () => {
            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }, { title: "B" }, { title: "C" }]),
                current: 0,
            });

            renderer.setCurrent(2);

            const rows = [...host.querySelectorAll(".lp-item")];
            expect(rows[0].hasAttribute("data-current")).toBe(false);
            expect(rows[2].hasAttribute("data-current")).toBe(true);
            expect(rows[2].getAttribute("aria-current")).toBe("true");
        });
    });

    describe("saisons", () => {
        it("doit grouper par saison quand seasons est actif", () => {
            renderer = new PanelRenderer({ seasons: true, open: true });
            const info = makeInfo([
                { title: "S01E01" },
                { title: "S01E02" },
                { title: "S02E01" },
            ]);

            renderer.render({ host, iframe, info, current: 0 });

            const groups = host.querySelectorAll(".lp-group");
            expect(groups.length).toBe(2);
            expect(groups[0].dataset.label).toBe("Season 1");
            expect(groups[1].dataset.label).toBe("Season 2");
            // la saison courante (index 0) ne doit pas être collapsed
            expect(groups[0].hasAttribute("data-collapsed")).toBe(false);
            expect(groups[1].hasAttribute("data-collapsed")).toBe(true);
        });

        it("doit plier / déplier un groupe au clic sur le header", () => {
            renderer = new PanelRenderer({ seasons: true });
            renderer.render({
                host,
                iframe,
                info: makeInfo([
                    { title: "S01E01" },
                    { title: "S02E01" },
                ]),
                current: 0,
            });

            const group2 = host.querySelectorAll(".lp-group")[1];
            expect(group2.hasAttribute("data-collapsed")).toBe(true);

            group2.querySelector("[data-lp-action=toggle-group]").click();
            expect(group2.hasAttribute("data-collapsed")).toBe(false);

            group2.querySelector("[data-lp-action=toggle-group]").click();
            expect(group2.hasAttribute("data-collapsed")).toBe(true);
        });
    });

    describe("resize handle", () => {
        it("double-clic doit reset la largeur et clear le store widths", () => {
            const widths = {
                get: vi.fn(() => null),
                set: vi.fn(),
                clear: vi.fn(),
            };

            // simuler une largeur host/iframe pour le clamp
            Object.defineProperty(iframe, "offsetWidth", { value: 800 });

            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }]),
                widths,
            });

            host.querySelector(".lp-handle").dispatchEvent(
                new MouseEvent("dblclick", { bubbles: true })
            );

            expect(widths.clear).toHaveBeenCalled();
            expect(host.style.getPropertyValue("--lp-w")).toBe("176px");
        });

        it("flèches clavier doivent ajuster la largeur et appeler widths.set", () => {
            const widths = {
                get: vi.fn(() => 200),
                set: vi.fn(),
                clear: vi.fn(),
            };
            Object.defineProperty(iframe, "offsetWidth", { value: 800 });

            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }]),
                widths,
            });

            const handle = host.querySelector(".lp-handle");
            handle.dispatchEvent(
                new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
            );

            expect(widths.set).toHaveBeenCalled();
            const last = widths.set.mock.calls.at(-1)[0];
            expect(last).toBeGreaterThan(200); // ArrowLeft élargit (delta +16 sur la logique actuelle)
        });
    });

    describe("clear / destroy", () => {
        it("doit retirer panel et toggle du DOM", () => {
            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }]),
            });

            renderer.clear();

            expect(host.querySelector(".lp-panel")).toBeNull();
            expect(host.querySelector(".lp-toggle")).toBeNull();
            expect(host.classList.contains("lp-host")).toBe(false);
            expect(host.style.getPropertyValue("--lp-w")).toBe("");
        });

        it("destroy doit appeler clear", () => {
            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "A" }]),
            });
            renderer.destroy();
            expect(host.querySelector(".lp-panel")).toBeNull();
        });
    });

    describe("renderers custom", () => {
        it("doit utiliser les renderers injectés", () => {
            const itemRenderer = {
                render: vi.fn((item, index) => {
                    const el = document.createElement("div");
                    el.dataset.index = String(index);
                    el.className = "lp-item";
                    el.textContent = `custom-${item.title}`;
                    return el;
                }),
            };
            const headerRenderer = {
                render: vi.fn(() => {
                    const el = document.createElement("div");
                    el.className = "lp-head";
                    el.textContent = "CUSTOM HEAD";
                    return el;
                }),
            };

            renderer = new PanelRenderer(
                { seasons: false },
                itemRenderer,
                headerRenderer
            );

            renderer.render({
                host,
                iframe,
                info: makeInfo([{ title: "Zed" }]),
            });

            expect(headerRenderer.render).toHaveBeenCalled();
            expect(itemRenderer.render).toHaveBeenCalled();
            expect(host.querySelector(".lp-head").textContent).toBe("CUSTOM HEAD");
            expect(host.querySelector(".lp-item").textContent).toBe("custom-Zed");
        });
    });
});