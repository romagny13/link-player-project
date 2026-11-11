// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// ───────── faux collaborateurs (hoistés pour vi.mock) ─────────

const m = vi.hoisted(() => {
    const state = {defaultStore: null};

    class FakeStore {
        data = new Map();

        get(key) {
            return this.data.has(key) ? this.data.get(key) : null;
        }

        set(key, value) {
            this.data.set(key, value);
        }
    }

    class MemoryStore extends FakeStore {
        static instances = [];

        constructor() {
            super();
            MemoryStore.instances.push(this);
        }
    }

    class FakeEmitter {
        #handlers = new Map();

        on(type, fn) {
            const list = this.#handlers.get(type) ?? [];
            list.push(fn);
            this.#handlers.set(type, list);
            return () => this.off(type, fn);
        }

        off(type, fn) {
            this.#handlers.set(
                type,
                (this.#handlers.get(type) ?? []).filter((f) => f !== fn)
            );
        }

        emit(type, payload) {
            const list = [...(this.#handlers.get(type) ?? [])];
            list.forEach((fn) => fn(payload));
            return list.length > 0;
        }

        clear() {
            this.#handlers.clear();
        }
    }

    /** Comme la vraie Region : le constructeur échoue quand la cible n'existe pas. */
    class FakeRegion {
        static instances = [];
        current = null;
        #infos = new Map();

        constructor(options) {
            if (!document.getElementById(options.target))
                throw new Error(`Target #${options.target} not found`);
            this.options = options;
            this.target = options.target;
            this.on = vi.fn((type, fn) => {
                this.handler = fn;
            });
            this.navigate = vi.fn();
            this.adopt = vi.fn((iframe, info) => {
                this.current = info;
            });
            this.dispose = vi.fn();
            FakeRegion.instances.push(this);
        }

        get infos() {
            return [...this.#infos.values()];
        }

        add(info) {
            if (this.#infos.has(info.key)) return false;
            this.#infos.set(info.key, info);
            return true;
        }

        get(key) {
            return this.#infos.get(key);
        }

        replace(info) {
            this.#infos.set(info.key, info);
        }

        fire(type, payload = {}) {
            this.handler({type, region: this, ...payload});
        }
    }

    class FakeTooltip {
        static instances = [];

        constructor(renderer) {
            this.renderer = renderer;
            this.detach = vi.fn();
            this.attach = vi.fn(() => this.detach);
            this.dispose = vi.fn();
            FakeTooltip.instances.push(this);
        }
    }

    class FakeThumbnails {
        static instances = [];

        constructor() {
            this.resolve = vi.fn(async (url) => url);
            FakeThumbnails.instances.push(this);
        }
    }

    const recorder = (extra = {}) =>
        class {
            static instances = [];

            constructor(options) {
                this.options = options;
                Object.assign(this, extra);
                this.constructor.instances.push(this);
            }
        };
    const FakeYouTubeProvider = recorder({id: "youtube"});
    const FakeOkruProvider = recorder({id: "okru"});
    const FakeApi = recorder();
    const FakeResolver = recorder();

    class FakeRegistry {
        static instances = [];

        constructor(providers) {
            this.providers = providers;
            FakeRegistry.instances.push(this);
        }
    }

    const isTouch = vi.fn();
    const defaultStore = vi.fn();
    const applyItems = vi.fn();

    const reset = () => {
        for (const C of [
            MemoryStore,
            FakeRegion,
            FakeTooltip,
            FakeThumbnails,
            FakeYouTubeProvider,
            FakeOkruProvider,
            FakeApi,
            FakeResolver,
            FakeRegistry
        ])
            C.instances.length = 0;
        state.defaultStore = new FakeStore();
        isTouch.mockReset();
        isTouch.mockReturnValue(false);
        defaultStore.mockReset();
        defaultStore.mockImplementation(() => state.defaultStore);
        applyItems.mockReset();
    };

    return {
        state,
        reset,
        isTouch,
        defaultStore,
        applyItems,
        FakeStore,
        MemoryStore,
        FakeEmitter,
        FakeRegion,
        FakeTooltip,
        FakeThumbnails,
        FakeYouTubeProvider,
        FakeOkruProvider,
        FakeApi,
        FakeResolver,
        FakeRegistry
    };
});

vi.mock("../src/utils/dom.js", () => ({
    resolveScope: (scope) => {
        if (scope == null) return null;
        if (typeof scope !== "string") return scope;
        const element = document.querySelector(scope);
        if (!element) throw new Error(`Scope '${scope}' not found`);
        return element;
    }
}));
vi.mock("../src/utils/helpers.js", async (importOriginal) => ({
    ...(await importOriginal()),
    isTouch: m.isTouch
}));
vi.mock("../src/utils/Emitter.js", () => ({Emitter: m.FakeEmitter}));
vi.mock("../src/storage.js", () => ({
    defaultStore: m.defaultStore,
    MemoryStore: m.MemoryStore
}));
vi.mock("../src/Region.js", () => ({Region: m.FakeRegion}));
vi.mock("../src/providers/ProviderRegistry.js", () => ({
    ProviderRegistry: m.FakeRegistry
}));
vi.mock("../src/providers/youtube/YouTubeProvider.js", () => ({
    YouTubeProvider: m.FakeYouTubeProvider
}));
vi.mock("../src/providers/okru/OkruProvider.js", () => ({
    OkruProvider: m.FakeOkruProvider
}));
vi.mock("../src/providers/youtube/YouTubeDataApi.js", () => ({
    YouTubeDataApi: m.FakeApi
}));
vi.mock("../src/providers/youtube/YouTubeMetaResolver.js", () => ({
    YouTubeMetaResolver: m.FakeResolver
}));
vi.mock("../src/metaMerge.js", () => ({applyItems: m.applyItems}));
vi.mock("../src/ui/Tooltip.js", () => ({Tooltip: m.FakeTooltip}));
vi.mock("../src/ui/ThumbnailService.js", () => ({
    ThumbnailService: m.FakeThumbnails
}));

import {LinkPlayer} from "../src/LinkPlayer.js";
import {AUTOPLAY_MODES} from "../src/utils/helpers.js";

// ───────── outils ─────────

const noop = () => {
};
const players = [];

const makeInfo = (key, over = {}) => ({
    key,
    provider: "fake",
    isPlaylist: false,
    title: "",
    thumbnail: "",
    autoplay: AUTOPLAY_MODES.NONE,
    showOnInit: false,
    videos: [],
    ...over
});

/** Faux fournisseur : l'info est déduite des data-* de l'élément. */
function makeProvider(id = "fake", name = "Fake") {
    return {
        id,
        name,
        getInfoFromElement: vi.fn((el) =>
            makeInfo(el.dataset.key ?? el.getAttribute("href") ?? el.src, {
                provider: id,
                autoplay: el.dataset.autoplay ?? AUTOPLAY_MODES.NONE,
                showOnInit: "showOnInit" in el.dataset,
                index:
                    el.dataset.index === undefined ? undefined : Number(el.dataset.index)
            })
        ),
        getInfoFromDefinition: vi.fn((def) =>
            makeInfo(def.key ?? def.url ?? def.provider, {
                provider: id,
                showOnInit: def.showOnInit ?? false,
                autoplay: def.autoplay ?? AUTOPLAY_MODES.NONE
            })
        )
    };
}

function makeRegistry(provider = makeProvider()) {
    return {
        provider,
        resolve: vi.fn(() => provider),
        get: vi.fn(() => provider)
    };
}

function create(options = {}) {
    const registry = "registry" in options ? options.registry : makeRegistry();
    const player = new LinkPlayer({
        autoScan: false,
        tooltip: false,
        onError: noop,
        ...options,
        registry
    });
    players.push(player);
    return player;
}

const html = (body) => {
    document.body.innerHTML = body;
};
const page = (body = "") =>
    html(`<div id="zone"></div><div id="other"></div>${body}`);
const link = (key, attrs = "", target = "zone") =>
    `<a data-link data-target="${target}" data-key="${key}" href="https://x.test/${key}" ${attrs}>${key}</a>`;
const $ = (selector) => document.querySelector(selector);
const region = (target = "zone") =>
    m.FakeRegion.instances.find((r) => r.target === target);
const keysOf = (provider) =>
    provider.getInfoFromElement.mock.calls.map(([el]) => el.dataset.key);

function click(element) {
    const event = new MouseEvent("click", {bubbles: true, cancelable: true});
    element.dispatchEvent(event);
    return event;
}

beforeEach(() => {
    m.reset();
    document.body.innerHTML = "";
});

afterEach(() => {
    players.splice(0).forEach((player) => player.dispose());
    vi.restoreAllMocks();
});

// ═════════════════════════════════════════════
// LinkPlayer
// ═════════════════════════════════════════════
describe("LinkPlayer", () => {
    describe("construction", () => {
        it("attribue un identifiant unique à chaque instance", () => {
            page();
            const a = create();
            const b = create();
            expect(a.id).toMatch(/^lp-\d+$/);
            expect(a.id).not.toBe(b.id);
        });

        it("est global sans scope, et sa racine est le document", () => {
            const player = create();
            expect(player.isGlobal).toBe(true);
            expect(player.getRoot()).toBe(document);
        });

        it("est limité à son scope (sélecteur ou élément)", () => {
            page('<div id="s1"></div><div id="s2"></div>');
            const bySelector = create({scope: "#s1"});
            const byElement = create({scope: $("#s2")});

            expect(bySelector.isGlobal).toBe(false);
            expect(bySelector.getRoot()).toBe($("#s1"));
            expect(byElement.getRoot()).toBe($("#s2"));
        });

        it("lève une erreur quand le scope n'existe pas", () => {
            page();
            expect(() => create({scope: "#absent"})).toThrow(/absent/);
        });

        it("marque son scope avec son identifiant", () => {
            page('<div id="s"></div>');
            const player = create({scope: "#s"});
            expect($("#s").dataset.lpScope).toBe(player.id);
        });

        it("accepte un scope déclaré dans le HTML (data-lp-scope vide)", () => {
            page('<div id="s" data-lp-scope></div>');
            const player = create({scope: "#s"});
            expect($("#s").dataset.lpScope).toBe(player.id);
        });

        it("refuse un scope déjà pris par un autre LinkPlayer", () => {
            page('<div id="s"></div>');
            create({scope: "#s"});
            expect(() => create({scope: "#s"})).toThrow(
                "This scope already has a LinkPlayer"
            );
        });

        it("scanne dès la construction par défaut", () => {
            page(link("a"));
            players.push(
                new LinkPlayer({
                    registry: makeRegistry(),
                    tooltip: false,
                    onError: noop
                })
            );
            expect(region("zone").infos).toHaveLength(1);
        });

        it("ne scanne pas avec autoScan à false", () => {
            page(link("a"));
            create();
            expect(m.FakeRegion.instances).toHaveLength(0);
        });

        describe("fournisseurs", () => {
            it("crée par défaut un registre avec YouTube et Okru (et l'URL d'embed Okru)", () => {
                page();
                players.push(
                    new LinkPlayer({
                        autoScan: false,
                        tooltip: false,
                        okruEmbedBaseUrl: "https://embed.test"
                    })
                );

                const [registry] = m.FakeRegistry.instances;
                expect(registry.providers[0]).toBeInstanceOf(m.FakeYouTubeProvider);
                expect(registry.providers[1]).toBeInstanceOf(m.FakeOkruProvider);
                expect(registry.providers[1].options).toEqual({
                    embedBaseUrl: "https://embed.test"
                });
            });

            it("utilise le registre fourni sans en créer un autre", () => {
                create();
                expect(m.FakeRegistry.instances).toHaveLength(0);
            });
        });

        describe("stockage", () => {
            it("utilise le stockage par défaut quand useStorage est vrai", () => {
                const player = create();
                expect(player.useStorage).toBe(true);
                expect(m.defaultStore).toHaveBeenCalledOnce();
            });

            it("utilise un stockage en mémoire quand useStorage est faux", () => {
                const player = create({useStorage: false});
                expect(player.useStorage).toBe(false);
                expect(m.defaultStore).not.toHaveBeenCalled();
                expect(m.MemoryStore.instances).toHaveLength(1);
            });

            it("préfère le stockage fourni", () => {
                create({store: new m.FakeStore()});
                expect(m.defaultStore).not.toHaveBeenCalled();
            });
        });

        describe("métadonnées YouTube", () => {
            it("crée un résolveur sans API quand aucune clé n'est donnée", () => {
                const store = new m.FakeStore();
                create({store, fallbackTitle: "Sans titre"});

                expect(m.FakeResolver.instances[0].options).toEqual({
                    api: null,
                    cache: store,
                    fallbackTitle: "Sans titre"
                });
            });

            it("crée l'API avec la clé fournie", () => {
                create({youtubeApiKey: "CLE"});
                const api = m.FakeResolver.instances[0].options.api;

                expect(api).toBeInstanceOf(m.FakeApi);
                expect(api.options).toEqual({apiKey: "CLE"});
            });

            it("utilise le résolveur fourni", () => {
                create({youtubeMeta: {resolve: vi.fn()}});
                expect(m.FakeResolver.instances).toHaveLength(0);
            });
        });

        describe("tooltip", () => {
            it("crée le tooltip avec son rendu personnalisé", () => {
                const renderer = {};
                create({tooltip: true, tooltipRenderer: renderer});
                expect(m.FakeTooltip.instances[0].renderer).toBe(renderer);
            });

            it("ne crée pas de tooltip quand il est désactivé", () => {
                create({tooltip: false});
                expect(m.FakeTooltip.instances).toHaveLength(0);
            });

            it("ne crée pas de tooltip sur un écran tactile", () => {
                m.isTouch.mockReturnValue(true);
                create({tooltip: true});
                expect(m.FakeTooltip.instances).toHaveLength(0);
            });
        });
    });

    describe("événements", () => {
        it("relaie les événements des régions aux callbacks", () => {
            const onChange = vi.fn();
            const onState = vi.fn();
            const onError = vi.fn();

            page(); // crée #zone (et le reste de la page de test) AVANT getRegion
            const r = create({onChange, onState, onError}).getRegion("zone");

            r.fire("change", {info: null, index: 1});
            r.fire("state", {state: "playing"});
            r.fire("error", {error: new Error("boum")});

            expect(onChange).toHaveBeenCalledWith(
                expect.objectContaining({type: "change", region: r, index: 1})
            );
            expect(onState).toHaveBeenCalledWith(
                expect.objectContaining({type: "state", state: "playing"})
            );
            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({type: "error"})
            );
        });

        it("écoute tous les événements de la région (*)", () => {
            page();
            const r = create().getRegion("zone");
            expect(r.on).toHaveBeenCalledWith("*", expect.any(Function));
        });

        it("permet de s'abonner puis de se désabonner (on / off)", () => {
            page();
            const player = create();
            const r = player.getRegion("zone");
            const a = vi.fn();
            const b = vi.fn();

            const stopA = player.on("change", a);
            player.on("change", b);
            r.fire("change", {info: null});
            stopA();
            player.off("change", b);
            r.fire("change", {info: null});

            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
        });

        it("écrit les erreurs dans console.warn par défaut", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(noop);
            page('<a data-link href="https://x.test/a">sans cible</a>');
            create({onError: undefined, autoScan: true});

            expect(warn).toHaveBeenCalledWith("[LinkPlayer]", expect.any(Error));
        });
    });

    describe("définitions", () => {
        it("résout le fournisseur par l'URL et ajoute l'info à la région de la cible", () => {
            page();
            const registry = makeRegistry();
            create({
                registry,
                definitions: [{url: "https://x.test/a", target: "zone", key: "a"}]
            });

            expect(registry.resolve).toHaveBeenCalledWith("https://x.test/a");
            expect(region("zone").infos.map((i) => i.key)).toEqual(["a"]);
        });

        it("résout le fournisseur par son identifiant quand il n'y a pas d'URL", () => {
            page();
            const registry = makeRegistry();
            create({
                registry,
                definitions: [{provider: "okru", target: "zone", key: "a"}]
            });

            expect(registry.get).toHaveBeenCalledWith("okru");
            expect(registry.resolve).not.toHaveBeenCalled();
        });

        it("regroupe les définitions par cible", () => {
            page();
            create({
                definitions: [
                    {url: "https://x.test/a", target: "zone", key: "a"},
                    {url: "https://x.test/b", target: "other", key: "b"},
                    {url: "https://x.test/c", target: "zone", key: "c"}
                ]
            });

            expect(m.FakeRegion.instances).toHaveLength(2);
            expect(region("zone").infos.map((i) => i.key)).toEqual(["a", "c"]);
        });

        it("lève une erreur quand une définition n'a pas de cible", () => {
            page();
            expect(() =>
                create({definitions: [{url: "https://x.test/a"}]})
            ).toThrow("Target required");
        });

        it.each([[null], [undefined], [{a: 1}]])(
            "ignore des définitions qui ne sont pas un tableau (%j)",
            (definitions) => {
                page();
                create({definitions});
                expect(m.FakeRegion.instances).toHaveLength(0);
            }
        );

        // ⚠ Échoue tant que #registerDefs contient son console.log(definitions) de débogage.
        it("n'écrit rien dans la console", () => {
            page();
            const log = vi.spyOn(console, "log").mockImplementation(noop);
            create({definitions: [{url: "https://x.test/a", target: "zone"}]});
            expect(log).not.toHaveBeenCalled();
        });
    });

    describe("régions", () => {
        it("crée la région au premier appel, puis la réutilise", () => {
            page();
            const player = create();
            const r = player.getRegion("zone");

            expect(player.getRegion("zone")).toBe(r);
            expect(m.FakeRegion.instances).toHaveLength(1);
            expect(player.regions).toEqual([r]);
        });

        it("expose la liste des régions en lecture seule", () => {
            page();
            const player = create();
            player.getRegion("zone");
            expect(Object.isFrozen(player.regions)).toBe(true);
        });

        it("lève une erreur quand la cible n'existe pas dans la page", () => {
            page();
            expect(() => create().getRegion("fantome")).toThrow(/fantome/);
        });

        it("transmet à la région son registre, ses miniatures et ses rendus", () => {
            page();
            const registry = makeRegistry();
            const thumbnails = {resolve: vi.fn()};
            const renderers = {
                panelRenderer: {},
                itemRenderer: {},
                headerRenderer: {},
                toggleRenderer: {},
                groupRenderer: {}
            };
            const r = create({registry, thumbnails, ...renderers}).getRegion(
                "zone"
            );

            expect(r.options.target).toBe("zone");
            expect(r.options.registry).toBe(registry);
            expect(r.options.thumbnails).toBe(thumbnails);
            for (const [name, renderer] of Object.entries(renderers))
                expect(r.options[name]).toBe(renderer);
            expect(r.options.resolveMeta).toBeTypeOf("function");
        });

        it("crée un service de miniatures par défaut", () => {
            page();
            create().getRegion("zone");
            expect(m.FakeThumbnails.instances).toHaveLength(1);
        });

        it("transmet le comportement « toggle » par défaut", () => {
            page();
            expect(create().getRegion("zone").options.currentBehavior).toBe("toggle");
        });

        // ⚠ Échoue : LinkPlayer passe `currentBehavior`, alors que Region lit `currentBehavior`.
        it("transmet currentBehavior sous le nom que Region lit (currentBehavior)", () => {
            page();
            const r = create({currentBehavior: "skip"}).getRegion("zone");
            expect(r.options.currentBehavior).toBe("skip");
        });
    });

    describe("scan", () => {
        it("enregistre chaque lien dans la région de sa cible", () => {
            page(link("a") + link("b", "", "other"));
            create().scan();

            expect(region("zone").infos.map((i) => i.key)).toEqual(["a"]);
            expect(region("other").infos.map((i) => i.key)).toEqual(["b"]);
        });

        it("marque les éléments traités avec l'identifiant du player", () => {
            page(link("a"));
            const player = create();
            player.scan();
            expect($("a").dataset.lp).toBe(player.id);
        });

        it("ne traite que les éléments [data-link]", () => {
            page(link("a") + '<a href="https://x.test/z">ordinaire</a>');
            expect(create().getLinks()).toHaveLength(1);
        });

        it("garde la première info quand deux liens ont la même clé", () => {
            page(link("a") + link("a"));
            const registry = makeRegistry();
            create({registry}).scan();

            expect(registry.provider.getInfoFromElement).toHaveBeenCalledTimes(2);
            expect(region("zone").infos).toHaveLength(1);
        });

        it("ignore les éléments déjà traités lors d'un second scan, mais prend les nouveaux", () => {
            page(link("a"));
            const registry = makeRegistry();
            const player = create({registry});
            player.scan();
            player.scan();
            expect(registry.provider.getInfoFromElement).toHaveBeenCalledTimes(1);

            document.body.insertAdjacentHTML("beforeend", link("b"));
            player.scan();
            expect(keysOf(registry.provider)).toEqual(["a", "b"]);
        });

        it("traite un élément cloné (le clone n'a pas hérité des écouteurs)", () => {
            page(link("a"));
            const player = create();
            player.scan();

            const copy = $("a").cloneNode(true); // data-lp est copié, pas l'écouteur
            document.body.append(copy);
            player.scan();
            click(copy);

            expect(region("zone").navigate).toHaveBeenCalledTimes(1);
        });

        describe("erreurs", () => {
            it("signale un lien sans cible sans bloquer les autres", () => {
                page('<a data-link href="https://x.test/x">sans cible</a>' + link("a"));
                const onError = vi.fn();
                create({onError}).scan();

                expect(onError).toHaveBeenCalledOnce();
                expect(onError.mock.calls[0][0].error.message).toBe("Target required");
                expect(onError.mock.calls[0][0].element).toBe($("a:not([data-key])"));
                expect(region("zone").infos.map((i) => i.key)).toEqual(["a"]);
            });

            it("signale un lien sans URL", () => {
                page('<a data-link data-target="zone">vide</a>');
                const onError = vi.fn();
                create({onError}).scan();
                expect(onError.mock.calls[0][0].error.message).toBe("No URL provided");
            });

            it("signale une cible introuvable et continue avec les autres liens", () => {
                page(link("x", "", "fantome") + link("a"));
                const onError = vi.fn();
                create({onError}).scan();

                expect(onError.mock.calls[0][0].error.message).toMatch(/fantome/);
                expect(region("zone").infos.map((i) => i.key)).toEqual(["a"]);
            });
        });

        describe("iframes", () => {
            const embed =
                '<div id="zone"><iframe data-link data-key="e" src="https://x.test/e"></iframe></div>';

            it("adopte l'iframe, avec le parent comme cible", () => {
                html(embed);
                create().scan();

                expect(region("zone").adopt).toHaveBeenCalledWith(
                    $("iframe"),
                    expect.objectContaining({key: "e"})
                );
            });

            it("ignore les iframes avec scanEmbeds à false", () => {
                html(embed);
                create({scanEmbeds: false}).scan();
                expect(m.FakeRegion.instances).toHaveLength(0);
            });

            it("n'attache pas de tooltip à une iframe", () => {
                html(embed);
                create({tooltip: true}).scan();
                expect(m.FakeTooltip.instances[0].attach).not.toHaveBeenCalled();
            });
        });

        describe("scopes", () => {
            const nested = () =>
                page(
                    link("g") +
                    `<div id="s" data-lp-scope>${link("s1", "", "other")}</div>`
                );

            it("sépare les liens du scope de ceux du player global", () => {
                nested();
                const scopedRegistry = makeRegistry();
                const globalRegistry = makeRegistry();
                const onError = vi.fn();

                create({
                    registry: scopedRegistry,
                    scope: "#s",
                    onError,
                    autoScan: true
                });
                create({registry: globalRegistry, onError, autoScan: true});

                expect(keysOf(scopedRegistry.provider)).toEqual(["s1"]);
                expect(keysOf(globalRegistry.provider)).toEqual(["g"]);
                expect(onError).not.toHaveBeenCalled();
            });

            it("signale les éléments déjà pris par un autre player (scope créé trop tard)", () => {
                page(`<div id="s">${link("a")}</div>`);
                create({autoScan: true}); // global : le scope n'est pas encore déclaré
                const onError = vi.fn();
                create({scope: "#s", onError, autoScan: true});

                expect(onError.mock.calls[0][0].error.message).toMatch(
                    /^1 element\(s\) already handled by another LinkPlayer/
                );
            });
        });
    });

    describe("clic sur un lien", () => {
        it("bloque la navigation du navigateur et ouvre l'info dans la région", () => {
            page(link("a"));
            create().scan();
            const event = click($("a"));

            expect(event.defaultPrevented).toBe(true);
            expect(region("zone").navigate).toHaveBeenCalledWith(
                "a",
                expect.objectContaining({autoplay: false})
            );
        });

        it.each([
            [AUTOPLAY_MODES.INIT, true],
            [AUTOPLAY_MODES.CLICK, true],
            [AUTOPLAY_MODES.NONE, false]
        ])("avec l'autoplay « %s », demande la lecture : %s", (mode, expected) => {
            page(link("a", `data-autoplay="${mode}"`));
            create().scan();
            click($("a"));

            expect(region("zone").navigate).toHaveBeenCalledWith(
                "a",
                expect.objectContaining({autoplay: expected})
            );
        });

        it("transmet l'index de départ de l'info", () => {
            page(link("a", 'data-index="3"'));
            create().scan();
            click($("a"));

            expect(region("zone").navigate).toHaveBeenCalledWith(
                "a",
                expect.objectContaining({index: 3})
            );
        });

        it("utilise l'info actuelle de la région quand elle a remplacé celle du lien", () => {
            page(link("a"));
            create().scan();
            region("zone").replace(
                makeInfo("a", {autoplay: AUTOPLAY_MODES.INIT, index: 5})
            );
            click($("a"));

            expect(region("zone").navigate).toHaveBeenCalledWith("a", {
                autoplay: true,
                index: 5
            });
        });
    });

    describe("état initial", () => {
        it("restaure la dernière vidéo vue, sans la lancer", () => {
            const store = new m.FakeStore();
            store.set("state:zone", {key: "b", index: 3});
            page(link("a", "data-show-on-init") + link("b"));
            create({store}).scan();

            expect(region("zone").navigate).toHaveBeenCalledTimes(1);
            expect(region("zone").navigate).toHaveBeenCalledWith("b", {index: 3});
        });

        it("restaure à l'index 0 quand l'état sauvegardé n'en contient pas", () => {
            const store = new m.FakeStore();
            store.set("state:zone", {key: "b"});
            page(link("b"));
            create({store}).scan();

            expect(region("zone").navigate).toHaveBeenCalledWith("b", {index: 0});
        });

        it("retombe sur showOnInit quand la clé sauvegardée n'existe plus", () => {
            const store = new m.FakeStore();
            store.set("state:zone", {key: "disparue", index: 1});
            page(link("a", "data-show-on-init"));
            create({store}).scan();

            expect(region("zone").navigate).toHaveBeenCalledWith(
                "a",
                expect.any(Object)
            );
        });

        it("ignore l'état sauvegardé quand useStorage est faux", () => {
            const store = new m.FakeStore();
            store.set("state:zone", {key: "b", index: 3});
            page(link("a", "data-show-on-init") + link("b"));
            const player = create({store, useStorage: false});
            player.scan();

            expect(player.getSavedState({target: "zone"})).toBeNull();
            expect(region("zone").navigate).toHaveBeenCalledWith(
                "a",
                expect.any(Object)
            );
        });

        it.each([
            [AUTOPLAY_MODES.INIT, true],
            [AUTOPLAY_MODES.CLICK, false],
            [AUTOPLAY_MODES.NONE, false]
        ])(
            "ouvre la première info showOnInit (autoplay « %s » → lecture : %s)",
            (mode, expected) => {
                page(
                    link("a", `data-show-on-init data-autoplay="${mode}"`) +
                    link("b", "data-show-on-init")
                );
                create().scan();

                expect(region("zone").navigate).toHaveBeenCalledTimes(1);
                expect(region("zone").navigate).toHaveBeenCalledWith(
                    "a",
                    expect.objectContaining({autoplay: expected})
                );
            }
        );

        it("n'ouvre rien quand aucune info n'est marquée showOnInit", () => {
            page(link("a"));
            create().scan();
            expect(region("zone").navigate).not.toHaveBeenCalled();
        });

        it("laisse en paix une région qui montre déjà quelque chose (iframe adoptée)", () => {
            html(
                '<div id="zone"><iframe data-link data-key="e" src="https://x.test/e"></iframe></div>' +
                link("a", "data-show-on-init")
            );
            create().scan();

            expect(region("zone").navigate).not.toHaveBeenCalled();
        });

        it("n'initialise une région qu'une seule fois", () => {
            page(link("a", "data-show-on-init"));
            const player = create();
            player.scan();
            player.scan();

            expect(region("zone").navigate).toHaveBeenCalledTimes(1);
        });

        it("initialise au premier scan les régions créées par des définitions", () => {
            page();
            const player = create({
                definitions: [
                    {
                        url: "https://x.test/a",
                        target: "zone",
                        key: "a",
                        showOnInit: true
                    }
                ]
            });
            expect(region("zone").navigate).not.toHaveBeenCalled();

            player.scan();
            expect(region("zone").navigate).toHaveBeenCalledWith(
                "a",
                expect.any(Object)
            );
        });
    });

    describe("sauvegarde de l'état", () => {
        it("enregistre la clé et l'index à chaque changement", () => {
            page();
            const store = new m.FakeStore();
            create({store})
                .getRegion("zone")
                .fire("change", {info: makeInfo("a"), index: 2});

            expect(store.data.get("state:zone")).toEqual({key: "a", index: 2});
        });

        it("écrit dans le stockage par défaut quand aucun n'est fourni", () => {
            page();
            create()
                .getRegion("zone")
                .fire("change", {info: makeInfo("a"), index: 0});
            expect(m.state.defaultStore.data.get("state:zone")).toEqual({
                key: "a",
                index: 0
            });
        });

        it("n'enregistre rien sans info", () => {
            page();
            const store = new m.FakeStore();
            create({store})
                .getRegion("zone")
                .fire("change", {info: null, index: 0});
            expect(store.data.size).toBe(0);
        });

        it("n'enregistre rien quand useStorage est faux, même avec un stockage fourni", () => {
            page();
            const store = new m.FakeStore();
            create({store, useStorage: false})
                .getRegion("zone")
                .fire("change", {info: makeInfo("a"), index: 0});
            expect(store.data.size).toBe(0);
        });

        it("relit l'état enregistré avec getSavedState", () => {
            page();
            const store = new m.FakeStore();
            const player = create({store});
            player
                .getRegion("zone")
                .fire("change", {info: makeInfo("a"), index: 4});

            expect(player.getSavedState({target: "zone"})).toEqual({
                key: "a",
                index: 4
            });
            expect(player.getSavedState({target: "autre"})).toBeNull();
        });
    });

    describe("enrichissement des playlists (resolveMeta)", () => {
        const setup = (youtubeMeta) => {
            page();
            return create({youtubeMeta}).getRegion("zone").options.resolveMeta;
        };

        it("applique les éléments trouvés à l'info et renvoie true", async () => {
            const items = [{id: "a", title: "Un"}];
            const youtubeMeta = {resolve: vi.fn(async () => items)};
            const info = makeInfo("list", {provider: "youtube", isPlaylist: true});

            expect(await setup(youtubeMeta)(info)).toBe(true);
            expect(youtubeMeta.resolve).toHaveBeenCalledWith(info);
            expect(m.applyItems).toHaveBeenCalledWith(info, items);
        });

        it.each([[[]], [null], [undefined]])(
            "renvoie false sans rien appliquer quand le résolveur donne %j",
            async (items) => {
                const resolveMeta = setup({resolve: vi.fn(async () => items)});

                expect(
                    await resolveMeta(
                        makeInfo("list", {provider: "youtube", isPlaylist: true})
                    )
                ).toBe(false);
                expect(m.applyItems).not.toHaveBeenCalled();
            }
        );

        it("laisse remonter l'erreur du résolveur (la région la signale)", async () => {
            const resolveMeta = setup({
                resolve: vi.fn(async () => {
                    throw new Error("quota");
                })
            });
            await expect(
                resolveMeta(makeInfo("list", {provider: "youtube"}))
            ).rejects.toThrow("quota");
        });

        // ⚠ Échoue si le filtrage n'est pas fait dans YouTubeMetaResolver : la région appelle
        // resolveMeta pour TOUTE liste, y compris celles d'Okru. Supprime ce test si le résolveur s'en charge.
        it("ne confie pas au résolveur YouTube les listes d'un autre fournisseur", async () => {
            const youtubeMeta = {resolve: vi.fn(async () => [{id: "x"}])};
            const resolveMeta = setup(youtubeMeta);

            await resolveMeta(
                makeInfo("okru:list:1,2", {provider: "okru", isPlaylist: true})
            );
            expect(youtubeMeta.resolve).not.toHaveBeenCalled();
        });
    });

    describe("tooltip des liens", () => {
        const mount = (provider) => {
            page(link("a"));
            const player = create({
                tooltip: true,
                registry: makeRegistry(provider)
            });
            player.scan();
            const [element, thumbnailOf, titleOf, meta] =
                m.FakeTooltip.instances[0].attach.mock.calls[0];
            return {player, element, thumbnailOf, titleOf, meta};
        };

        it("attache un tooltip à chaque lien avec les informations du fournisseur", () => {
            const {element, meta} = mount(makeProvider("youtube", "YouTube"));
            expect(element).toBe($("a"));
            expect(meta).toEqual({id: "youtube", name: "YouTube"});
        });

        it("utilise l'identifiant comme nom quand le fournisseur n'en a pas", () => {
            const {meta} = mount({...makeProvider("okru"), name: undefined});
            expect(meta).toEqual({id: "okru", name: "okru"});
        });

        it("lit le titre et la miniature à l'ouverture (valeurs complétées après coup)", async () => {
            const {titleOf, thumbnailOf} = mount(makeProvider());
            expect(titleOf()).toBe("");

            Object.assign(region("zone").get("a"), {
                title: "Titre",
                thumbnail: "t.jpg"
            });
            expect(titleOf()).toBe("Titre");
            await thumbnailOf();
            expect(m.FakeThumbnails.instances[0].resolve).toHaveBeenCalledWith(
                "t.jpg"
            );
        });

        it("suit l'info actuelle de la région quand elle remplace celle du lien", () => {
            const {titleOf} = mount(makeProvider());
            region("zone").replace(makeInfo("a", {title: "Remplacé"}));
            expect(titleOf()).toBe("Remplacé");
        });

        it("prend la première vidéo d'une playlist", async () => {
            const {titleOf, thumbnailOf} = mount(makeProvider());
            region("zone").replace(
                makeInfo("a", {
                    isPlaylist: true,
                    videos: [{title: "Premier", thumbnail: "p.jpg"}]
                })
            );

            expect(titleOf()).toBe("Premier");
            await thumbnailOf();
            expect(m.FakeThumbnails.instances[0].resolve).toHaveBeenCalledWith(
                "p.jpg"
            );
        });

        it("donne un titre vide et aucune miniature pour une playlist sans vidéo", async () => {
            const {titleOf, thumbnailOf} = mount(makeProvider());
            region("zone").replace(makeInfo("a", {isPlaylist: true, videos: []}));

            expect(titleOf()).toBe("");
            await thumbnailOf();
            expect(m.FakeThumbnails.instances[0].resolve).toHaveBeenCalledWith(null);
        });

        it("transmet null quand la miniature est vide", async () => {
            const {thumbnailOf} = mount(makeProvider());
            await thumbnailOf();
            expect(m.FakeThumbnails.instances[0].resolve).toHaveBeenCalledWith(null);
        });

        it("utilise le service de miniatures fourni", async () => {
            page(link("a"));
            const thumbnails = {resolve: vi.fn(async (u) => u)};
            create({tooltip: true, thumbnails}).scan();
            const thumbnailOf = m.FakeTooltip.instances[0].attach.mock.calls[0][1];
            await thumbnailOf();

            expect(m.FakeThumbnails.instances).toHaveLength(0);
            expect(thumbnails.resolve).toHaveBeenCalled();
        });
    });

    describe("dispose", () => {
        it("retire les écouteurs de clic", () => {
            page(link("a"));
            const player = create();
            player.scan();
            const r = region("zone");
            player.dispose();
            click($("a"));

            expect(r.navigate).not.toHaveBeenCalled();
        });

        it("libère les éléments : un autre player peut les reprendre", () => {
            page(link("a"));
            create().scan();
            $("a"); // sécurité : l'élément existe
            players[0].dispose();
            expect($("a").dataset.lp).toBeUndefined();

            const registry = makeRegistry();
            create({registry}).scan();
            expect(keysOf(registry.provider)).toEqual(["a"]);
        });

        it("retire le marquage du scope", () => {
            page('<div id="s"></div>');
            const player = create({scope: "#s"});
            player.dispose();
            expect($("#s").dataset.lpScope).toBeUndefined();
        });

        it("libère le scope pour un nouveau player", () => {
            page('<div id="s"></div>');
            create({scope: "#s"}).dispose();
            expect(() => create({scope: "#s"})).not.toThrow();
        });

        it("détruit les régions et le tooltip, et vide la liste des régions", () => {
            page(link("a"));
            const player = create({tooltip: true});
            player.scan();
            const r = region("zone");
            const tooltip = m.FakeTooltip.instances[0];
            player.dispose();

            expect(r.dispose).toHaveBeenCalledOnce();
            expect(tooltip.dispose).toHaveBeenCalledOnce();
            expect(tooltip.detach).toHaveBeenCalledOnce();
            expect(player.regions).toEqual([]);
        });

        it("supprime les abonnements aux événements", () => {
            page();
            const player = create();
            const r = player.getRegion("zone");
            const handler = vi.fn();
            player.on("change", handler);
            player.dispose();
            r.fire("change", {info: null});

            expect(handler).not.toHaveBeenCalled();
        });

        it("peut être appelé deux fois", () => {
            page(link("a"));
            const player = create();
            player.scan();
            expect(() => {
                player.dispose();
                player.dispose();
            }).not.toThrow();
        });
    });
});
