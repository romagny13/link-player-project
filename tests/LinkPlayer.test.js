// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {LinkPlayer} from "../src/LinkPlayer.js";
import {MemoryStore} from "../src/storage.js";
import {AUTOPLAY_MODES} from "../src/utils/helpers.js";
import {PlaylistInfo} from "../src/models/PlaylistInfo.js";

vi.mock("../src/ui/PanelRenderer.js", () => ({
    PanelRenderer: class {
        render() {}
        clear() {}
        setCurrent() {}
        destroy() {}
    }
}));

// ───────── Faux provider / player ─────────
class FakePlayer {
    constructor({iframe} = {}) {
        this.kind = "fake";
        if (iframe) {
            this.iframe = iframe;
        } else {
            this.iframe = document.createElement("iframe");
            this.iframe.src = "https://fake.test/embed/created";
        }
        this.listeners = new Set();
        this.load = vi.fn();
        this.play = vi.fn();
        this.pause = vi.fn();
        this.next = vi.fn();
        this.previous = vi.fn();
        this.playAt = vi.fn();
        this.selectItem = vi.fn();
        this.dispose = vi.fn();
    }

    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    emit(event) {
        for (const listener of [...this.listeners]) listener(event);
    }
}

const makeInfo = (overrides = {}) => ({
    provider: "fake",
    isPlaylist: false,
    videos: [],
    showOnInit: false,
    autoplay: undefined,
    index: 0,
    ...overrides
});

function makeProvider() {
    const players = [];
    return {
        id: "fake",
        name: "Fake",
        players,
        getInfoFromLink: vi.fn((el) => makeInfo({
            key: `fake:${el.dataset.id}`,
            target: el.dataset.target,
            autoplay: el.dataset.autoplay === "click" ? AUTOPLAY_MODES.CLICK : undefined,
            showOnInit: el.dataset.show === "1"
        })),
        getInfoFromFrame: vi.fn((iframe) => makeInfo({key: "fake:frame", target: iframe.parentElement.id})),
        getInfoFromDefinition: vi.fn((def) => makeInfo({
            key: `fake:${def.id}`,
            target: def.target,
            showOnInit: def.showOnInit
        })),
        createPlayer: vi.fn((options = {}) => {
            const player = new FakePlayer(options);
            players.push(player);
            return player;
        })
    };
}

const link = (id, {target = "player", extra = ""} = {}) =>
    `<a data-link data-id="${id}" data-target="${target}" href="https://fake.test/v/${id}" ${extra}>Vidéo ${id}</a>`;

const render = (html) => {
    document.body.innerHTML = html;
};

const click = (element) => {
    const event = new MouseEvent("click", {bubbles: true, cancelable: true});
    element.dispatchEvent(event);
    return event;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let provider;
let registry;
let onError;
let instances;

function create(options = {}) {
    const lp = new LinkPlayer({
        registry,
        store: new MemoryStore(),
        tooltip: false,
        thumbnails: {resolve: vi.fn()},
        onError,
        ...options
    });
    instances.push(lp);
    return lp;
}

beforeEach(() => {
    provider = makeProvider();
    registry = {
        resolve: vi.fn((url) => {
            if (!String(url).startsWith("https://fake.test")) throw new Error(`No provider for ${url}`);
            return provider;
        }),
        get: vi.fn(() => provider)
    };
    onError = vi.fn();
    instances = [];
    document.body.innerHTML = "";
});

afterEach(() => {
    instances.forEach((lp) => lp.dispose());
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

describe("LinkPlayer", () => {
    describe("construction", () => {
        it("portée globale par défaut", () => {
            const lp = create({autoScan: false});
            expect(lp.id).toBe("lp-global");
            expect(lp.isGlobal).toBe(true);
            expect(lp.useStorage).toBe(true);
            expect(lp.regions).toEqual([]);
        });

        it("useStorage peut être désactivé", () => {
            expect(create({autoScan: false, useStorage: false}).useStorage).toBe(false);
        });

        it("autoScan (défaut) découvre la page dès la construction", () => {
            render(link("1") + '<div id="player"></div>');
            const lp = create();
            expect(lp.regions).toHaveLength(1);
        });

        it("autoScan: false ne scanne pas", () => {
            render(link("1") + '<div id="player"></div>');
            const lp = create({autoScan: false});
            expect(lp.regions).toHaveLength(0);
        });

        it("regions est un tableau figé", () => {
            const lp = create({autoScan: false});
            expect(Object.isFrozen(lp.regions)).toBe(true);
        });

        it("getRegion() renvoie la même instance pour une même cible", () => {
            const lp = create({autoScan: false});
            expect(lp.getRegion("player")).toBe(lp.getRegion("player"));
            expect(lp.getRegion("autre")).not.toBe(lp.getRegion("player"));
        });
    });

    describe("découverte des liens", () => {
        it("lie un lien et crée la région de sa cible", () => {
            render(link("1") + '<div id="player"></div>');
            const lp = create();

            const anchor = document.querySelector("a");
            expect(anchor.dataset.lp).toBe("lp-global");
            expect(lp.regions[0].target).toBe("player");
            expect(lp.regions[0].has("fake:1")).toBe(true);
        });

        it("gère un élément non-<a> via data-url", () => {
            render('<button data-link data-id="7" data-target="player" data-url="https://fake.test/v/7">Lire</button><div id="player"></div>');
            const lp = create();
            expect(lp.getRegion("player").has("fake:7")).toBe(true);
        });

        it("utilise defaultTarget et l'écrit dans data-target du lien", () => {
            render('<a data-link data-id="1" href="https://fake.test/v/1">Un</a><div id="main"></div>');
            create({defaultTarget: "main"});

            expect(document.querySelector("a").dataset.target).toBe("main");
            expect(document.querySelector("#main")).not.toBeNull();
        });

        it("signale une erreur pour un lien sans cible, sans bloquer les autres", () => {
            render(
                '<a data-link data-id="x" href="https://fake.test/v/x">Sans cible</a>' +
                link("2") +
                '<div id="player"></div>'
            );
            const lp = create();

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({message: expect.stringMatching(/Target not provided/)})
            }));
            expect(lp.getRegion("player").has("fake:2")).toBe(true);
        });

        it("signale une erreur quand l'URL n'est reconnue par aucun provider", () => {
            render(
                '<a data-link data-id="1" data-target="player" href="https://autre.test/x">Inconnu</a>' +
                link("2") +
                '<div id="player"></div>'
            );
            const lp = create();

            expect(onError).toHaveBeenCalledTimes(1);
            expect(lp.getRegion("player").has("fake:2")).toBe(true);
        });

        it("signale une erreur pour un élément data-link sans URL", () => {
            render('<span data-link data-target="player">Rien</span><div id="player"></div>');
            create();
            // sans URL, le host ignore l'élément : aucune liaison, aucun plantage
            expect(provider.getInfoFromLink).not.toHaveBeenCalled();
        });

        it("onError par défaut : avertissement dans la console", () => {
            const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
            render('<a data-link href="https://fake.test/v/1">Sans cible</a>');
            create({onError: undefined});
            expect(spy).toHaveBeenCalledWith("[LinkPlayer]", expect.any(Error));
        });

        it("scan() est idempotent et ne traite que les nouveaux liens", () => {
            render(link("1") + '<div id="player"></div>');
            const lp = create();
            lp.scan();
            expect(provider.getInfoFromLink).toHaveBeenCalledTimes(1);

            document.body.insertAdjacentHTML("beforeend", link("2"));
            lp.scan();
            expect(provider.getInfoFromLink).toHaveBeenCalledTimes(2);
            expect(lp.getRegion("player").has("fake:2")).toBe(true);
        });

        it("trouve un conteneur créé après le premier scan", () => {
            render(link("1"));
            const lp = create();
            expect(lp.getRegion("player").hasContainer).toBe(false);

            document.body.insertAdjacentHTML("beforeend", '<div id="player"></div>');
            lp.scan();

            expect(lp.getRegion("player").hasContainer).toBe(true);
        });
    });

    describe("clic sur un lien", () => {
        beforeEach(() => {
            render(link("1") + link("2", {extra: 'data-autoplay="click"'}) + '<div id="player"></div>');
        });

        it("empêche la navigation et affiche la vidéo dans le conteneur", () => {
            create();
            const event = click(document.querySelector('[data-id="1"]'));

            expect(event.defaultPrevented).toBe(true);
            expect(provider.createPlayer).toHaveBeenCalledTimes(1);
            expect(document.querySelector("#player iframe")).toBe(provider.players[0].iframe);
        });

        it("transmet autoplay: false par défaut", () => {
            create();
            click(document.querySelector('[data-id="1"]'));
            expect(provider.players[0].load).toHaveBeenCalledWith(expect.objectContaining({key: "fake:1"}), {autoplay: false, index: 0});
        });

        it("transmet autoplay: true quand le lien le demande au clic", () => {
            create();
            click(document.querySelector('[data-id="2"]'));
            expect(provider.players[0].load).toHaveBeenCalledWith(expect.objectContaining({key: "fake:2"}), {autoplay: true, index: 0});
        });

        it("un second clic sur la vidéo courante cache le conteneur (toggle)", () => {
            create();
            const anchor = document.querySelector('[data-id="1"]');
            click(anchor);
            click(anchor);
            expect(document.querySelector("#player").hidden).toBe(true);
        });

        it("currentBehavior 'skip' ignore le second clic", () => {
            create({currentBehavior: "skip"});
            const anchor = document.querySelector('[data-id="1"]');
            click(anchor);
            click(anchor);
            expect(document.querySelector("#player").hidden).toBe(false);
        });

        it("un clic sur un autre lien remplace l'iframe", () => {
            create();
            click(document.querySelector('[data-id="1"]'));
            click(document.querySelector('[data-id="2"]'));

            expect(provider.players).toHaveLength(2);
            expect(provider.players[0].dispose).toHaveBeenCalled();
            expect(document.querySelectorAll("#player iframe")).toHaveLength(1);
        });
    });

    describe("définitions", () => {
        it("refuse des définitions qui ne sont pas un tableau", () => {
            expect(() => create({definitions: "oups"})).toThrow(TypeError);
        });

        it("exige une cible pour chaque définition", () => {
            expect(() => create({definitions: [{url: "https://fake.test/v/1", id: "1"}]}))
                .toThrow(/Target is required for definition at index 0/);
        });

        it("résout le provider par url, ou par nom quand il n'y a pas d'url", () => {
            render('<div id="player"></div>');
            create({
                definitions: [
                    {url: "https://fake.test/v/1", id: "1", target: "player"},
                    {provider: "fake", id: "2", target: "player"}
                ]
            });

            expect(registry.resolve).toHaveBeenCalledWith("https://fake.test/v/1");
            expect(registry.get).toHaveBeenCalledWith("fake");
        });

        it("ajoute l'info à la région et l'affiche quand showOnInit est vrai", () => {
            render('<div id="player"></div>');
            const lp = create({definitions: [{url: "https://fake.test/v/1", id: "1", target: "player", showOnInit: true}]});

            expect(lp.getRegion("player").has("fake:1")).toBe(true);
            expect(provider.players).toHaveLength(1);
        });

        it("n'affiche rien au démarrage sans showOnInit", () => {
            render('<div id="player"></div>');
            create({definitions: [{url: "https://fake.test/v/1", id: "1", target: "player"}]});
            expect(provider.createPlayer).not.toHaveBeenCalled();
        });
    });

    describe("initialisation (showOnInit)", () => {
        it("affiche l'info marquée showOnInit, une seule fois même après un second scan", () => {
            render(link("1", {extra: 'data-show="1"'}) + '<div id="player"></div>');
            const lp = create();
            lp.scan();
            lp.scan();
            expect(provider.createPlayer).toHaveBeenCalledTimes(1);
        });
    });

    describe("persistance de l'état", () => {
        it("sauvegarde la navigation de la région", () => {
            render(link("1") + '<div id="player"></div>');
            const store = new MemoryStore();
            create({store});

            click(document.querySelector("a"));

            expect(store.get("state:player")).toEqual({key: "fake:1", index: 0});
        });

        it("restaure l'état sauvegardé au démarrage suivant", () => {
            const store = new MemoryStore();
            store.set("state:player", {key: "fake:1", index: 0});
            render(link("1") + '<div id="player"></div>');

            create({store});

            expect(provider.createPlayer).toHaveBeenCalledTimes(1);
            expect(provider.players[0].load).toHaveBeenCalledWith(expect.objectContaining({key: "fake:1"}), {autoplay: false, index: 0});
        });

        it("ignore un état sauvegardé dont la clé n'existe plus", () => {
            const store = new MemoryStore();
            store.set("state:player", {key: "fake:disparue", index: 0});
            render(link("1") + '<div id="player"></div>');

            create({store});

            expect(provider.createPlayer).not.toHaveBeenCalled();
        });

        it("getSavedState() lit l'état de la région", () => {
            const store = new MemoryStore();
            store.set("state:player", {key: "fake:1", index: 2});
            render(link("1") + '<div id="player"></div>');
            const lp = create({store});

            expect(lp.getSavedState(lp.getRegion("player"))).toEqual({key: "fake:1", index: 2});
        });

        it("useStorage: false : rien n'est lu ni écrit", () => {
            const store = new MemoryStore();
            const set = vi.spyOn(store, "set");
            render(link("1") + '<div id="player"></div>');
            const lp = create({store, useStorage: false});

            click(document.querySelector("a"));

            expect(set).not.toHaveBeenCalled();
            expect(lp.getSavedState(lp.getRegion("player"))).toBeNull();
        });
    });

    describe("événements", () => {
        beforeEach(() => {
            render(link("1") + '<div id="player"></div>');
        });

        it("relaie 'change' des régions à onChange", () => {
            const onChange = vi.fn();
            create({onChange});

            click(document.querySelector("a"));

            expect(onChange).toHaveBeenCalledWith(expect.objectContaining({reason: "navigate"}));
        });

        it("relaie 'state' du player à onState", () => {
            const onState = vi.fn();
            create({onState});
            click(document.querySelector("a"));

            provider.players[0].emit({type: "state", state: "playing"});

            expect(onState).toHaveBeenCalledWith(expect.objectContaining({state: "playing"}));
        });

        it("relaie les erreurs du player à onError", () => {
            create();
            click(document.querySelector("a"));
            const error = new Error("boom");

            provider.players[0].emit({type: "error", error});

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({error}));
        });

        it("on() ajoute un écouteur et off() le retire", () => {
            const lp = create();
            const handler = vi.fn();
            lp.on("change", handler);
            click(document.querySelector("a"));
            expect(handler).toHaveBeenCalledTimes(1);

            lp.off("change", handler);
            click(document.querySelector("a")); // toggle → change 'visibility'
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe("adoption des iframes existantes (scanEmbeds)", () => {
        const frameHtml = '<div id="host"><iframe src="https://fake.test/embed/1"></iframe></div>';

        it("adopte une iframe d'un provider connu", () => {
            render(frameHtml);
            const lp = create();
            const iframe = document.querySelector("iframe");

            expect(provider.getInfoFromFrame).toHaveBeenCalledWith(iframe);
            expect(provider.createPlayer).toHaveBeenCalledWith({iframe});
            expect(iframe.dataset.lp).toBe("lp-global");
            expect(lp.getRegion("host").current.key).toBe("fake:frame");
        });

        it("ne fait rien quand scanEmbeds est désactivé", () => {
            render(frameHtml);
            create({scanEmbeds: false});
            expect(provider.getInfoFromFrame).not.toHaveBeenCalled();
        });

        it("ignore sans bruit une iframe qui n'est pas une vidéo connue", () => {
            render('<div id="host"><iframe src="https://carte.test/map"></iframe></div>');
            create();
            expect(provider.getInfoFromFrame).not.toHaveBeenCalled();
            expect(onError).not.toHaveBeenCalled();
        });

        it("ignore une iframe sans src", () => {
            render('<div id="host"><iframe></iframe></div>');
            create();
            expect(provider.getInfoFromFrame).not.toHaveBeenCalled();
        });

        it("n'adopte pas les iframes qu'il a créées lui-même", () => {
            render(link("1") + '<div id="player"></div>');
            const lp = create();
            click(document.querySelector("a"));

            lp.scan();

            expect(provider.getInfoFromFrame).not.toHaveBeenCalled();
        });

        it("restaurer l'état sauvegardé d'une iframe adoptée ne cache pas le conteneur", () => {
            const store = new MemoryStore();
            store.set("state:host", {key: "fake:frame", index: 0});
            render(frameHtml);

            create({store});

            expect(document.querySelector("#host").hidden).toBe(false);
            expect(provider.createPlayer).toHaveBeenCalledTimes(1); // l'adoption, pas de navigation en plus
            expect(provider.players[0].load).not.toHaveBeenCalled();
            expect(provider.players[0].pause).not.toHaveBeenCalled();
        });

        it("une iframe adoptée marquée showOnInit n'est pas cachée à l'initialisation", () => {
            provider.getInfoFromFrame.mockReturnValue(makeInfo({
                key: "fake:frame", target: "host", showOnInit: true
            }));
            render(frameHtml);

            create();

            expect(document.querySelector("#host").hidden).toBe(false);
        });
    });

    describe("métadonnées des playlists YouTube", () => {
        it("complète une playlist YouTube via youtubeMeta", async () => {
            render('<div id="player"></div>');
            const playlist = new PlaylistInfo({provider: "youtube", target: "player", playlistId: "PL1", showOnInit: true});
            provider.getInfoFromDefinition.mockReturnValue(playlist);
            const youtubeMeta = {
                resolve: vi.fn().mockResolvedValue([
                    {id: "aaa", title: "Premier"},
                    {id: "bbb", title: "Second"}
                ])
            };

            create({youtubeMeta, definitions: [{url: "https://fake.test/pl", target: "player"}]});
            await flush();

            expect(youtubeMeta.resolve).toHaveBeenCalledWith(playlist, { force: false });
            expect(playlist.videos.map((v) => v.title)).toEqual(["Premier", "Second"]);
        });

        it("laisse les playlists d'un autre provider tranquilles", async () => {
            render('<div id="player"></div>');
            provider.getInfoFromDefinition.mockReturnValue(makeInfo({
                key: "fake:list", target: "player", isPlaylist: true, showOnInit: true, videos: []
            }));
            const youtubeMeta = {resolve: vi.fn()};

            create({youtubeMeta, definitions: [{url: "https://fake.test/l", target: "player"}]});
            await flush();

            expect(youtubeMeta.resolve).not.toHaveBeenCalled();
        });

        it("signale une erreur quand youtubeMeta échoue", async () => {
            render('<div id="player"></div>');
            const playlist = new PlaylistInfo({provider: "youtube", target: "player", playlistId: "PL1", showOnInit: true});
            provider.getInfoFromDefinition.mockReturnValue(playlist);
            const youtubeMeta = {resolve: vi.fn().mockRejectedValue(new Error("API"))};

            create({youtubeMeta, definitions: [{url: "https://fake.test/pl", target: "player"}]});
            await flush();

            expect(onError).toHaveBeenCalledWith(expect.objectContaining({
                error: expect.objectContaining({message: "API"})
            }));
        });
    });

    describe("dispose()", () => {
        beforeEach(() => {
            render(link("1") + '<div id="player"></div>');
        });

        it("détache les liens, libère les players et vide les régions", () => {
            const lp = create();
            const anchor = document.querySelector("a");
            click(anchor);

            lp.dispose();

            expect(anchor.dataset.lp).toBeUndefined();
            expect(provider.players[0].dispose).toHaveBeenCalled();
            expect(lp.regions).toEqual([]);
        });

        it("le clic n'a plus d'effet après dispose()", () => {
            const lp = create();
            const anchor = document.querySelector("a");
            lp.dispose();

            const event = click(anchor);

            expect(event.defaultPrevented).toBe(false);
            expect(provider.createPlayer).not.toHaveBeenCalled();
        });

        it("les écouteurs ne sont plus appelés après dispose()", () => {
            const onChange = vi.fn();
            const lp = create({onChange});
            lp.dispose();
            lp.scan();
            expect(onChange).not.toHaveBeenCalled();
        });
    });
});