// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
// Adjust these paths to your project (npm i -D jsdom)
import {LinkPlayer} from "../src/LinkPlayer.js";
import {MemoryStore} from "../src/storage.js";
import {toAutoplayMode, toBoolean} from "../src/utils/helpers.js";
import {makeInfo, makePanel, makePlayer} from "./fixtures.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** HTML of the test. Links: data-link, data-target, data-key, data-autoplay, data-index, data-show-on-init, data-playlist. */
const page = (html) => {
    document.body.innerHTML = `<div id="t-1"></div><div id="t-2"></div>${html}`;
};
const link = (attributes = "", href = "https://fake.test/x") => `<a data-link data-target="t-1" ${attributes} href="${href}">link</a>`;
const click = (element) => {
    const event = new MouseEvent("click", {bubbles: true, cancelable: true});
    element.dispatchEvent(event);
    return event;
};

/**
 * A fake provider / registry: infos are built from the element or the definition with the same shape as the real
 * models (a list has no `autoplay`, a single video has). No iframe, no bridge, no network.
 */
function makeFakes() {
    const players = [];
    const provider = {
        id: "fake",
        getInfoFromElement: vi.fn((el) => {
            const isPlaylist = el.dataset.playlist !== undefined;
            return makeInfo({
                key: el.dataset.key ?? `fake:${el.getAttribute("href") ?? el.getAttribute("src") ?? el.dataset.url}`,
                target: el.dataset.target ?? el.parentElement?.id,
                isPlaylist,
                ...(isPlaylist ? {} : {autoplay: toAutoplayMode(el.dataset.autoplay)}),
                index: el.dataset.index === undefined ? undefined : Number(el.dataset.index),
                showOnInit: toBoolean(el.dataset.showOnInit)
            });
        }),
        getInfoFromDefinition: vi.fn((def) =>
            makeInfo({
                key: def.key ?? `fake:${def.url}`,
                target: def.target,
                url: def.url,
                isPlaylist: Boolean(def.playlist),
                ...(def.playlist ? {} : {autoplay: toAutoplayMode(def.autoplay)}),
                index: def.index,
                showOnInit: Boolean(def.showOnInit)
            })
        ),
        createPlayer: vi.fn((options = {}) => {
            const player = makePlayer({iframe: options.iframe});
            players.push(player);
            return player;
        })
    };
    const registry = {resolve: vi.fn(() => provider), get: vi.fn(() => provider)};
    return {players, provider, registry, panel: makePanel(), store: new MemoryStore(), errors: []};
}

/** A link player on fake parts. `options` override the defaults (and `fakes` can be shared between players). */
function create(options = {}, fakes = makeFakes()) {
    const lp = new LinkPlayer({
        registry: fakes.registry,
        panelRenderer: fakes.panel,
        store: fakes.store,
        tooltip: false,
        onError: (e) => fakes.errors.push(e),
        ...options
    });
    return {lp, ...fakes};
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

describe("links", () => {
    it("a link gets its info in the region of its target, and a click navigates to it", () => {
        page(link('data-key="a"'));
        const {lp, players} = create();
        const region = lp.getRegion("t-1");

        expect(region.infos.map((i) => i.key)).toEqual(["a"]);

        const event = click(document.querySelector("[data-link]"));
        expect(event.defaultPrevented).toBe(true);
        expect(players[0].load).toHaveBeenCalledWith(region.get("a"), {autoplay: false, index: 0});
    });

    it("data-autoplay=click makes a single video play", () => {
        page(link('data-key="a" data-autoplay="click"'));
        const {lp, players} = create();
        click(document.querySelector("[data-link]"));
        expect(players[0].load).toHaveBeenCalledWith(lp.getRegion("t-1").get("a"), {autoplay: true, index: 0});
    });

    it("data-autoplay=init also plays on click", () => {
        page(link('data-key="a" data-autoplay=""'));
        const {players} = create();
        click(document.querySelector("[data-link]"));
        expect(players[0].load.mock.calls[0][1].autoplay).toBe(true);
    });

    // PROPOSAL 6: the autoplay of a list / playlist link was read from the info, which has none.
    it.fails("data-autoplay=click makes a list or a playlist play too (proposal 6)", () => {
        page(link('data-key="l" data-playlist data-autoplay="click"'));
        const {players} = create();
        click(document.querySelector("[data-link]"));
        expect(players[0].load.mock.calls[0][1].autoplay).toBe(true);
    });

    it("the index of the info is where the playlist starts", () => {
        page(link('data-key="l" data-playlist data-index="2"'));
        const {lp, players} = create();
        click(document.querySelector("[data-link]"));
        expect(players[0].load).toHaveBeenCalledWith(lp.getRegion("t-1").get("l"), {autoplay: false, index: 2});
    });

    it("a link without target is an error, the other links keep working", () => {
        page(`<a data-link href="https://fake.test/nope">no target</a>${link('data-key="ok"')}`);
        const {lp, errors} = create();

        expect(errors).toHaveLength(1);
        expect(errors[0].error.message).toBe("Target required");
        expect(errors[0].element.textContent).toBe("no target");
        expect(lp.getRegion("t-1").has("ok")).toBe(true);
    });

    it("an element without url is an error", () => {
        page('<div data-link data-target="t-1"></div>');
        const {errors} = create();
        expect(errors[0].error.message).toBe("No URL provided");
    });

    it("a target that does not exist is an error", () => {
        page('<a data-link data-target="zzz" href="https://fake.test/x">x</a>');
        const {errors} = create();
        expect(errors[0].error.message).toBe("Target #zzz not found");
    });

    it("the same key twice gives one info: the first one wins, both links navigate to it", () => {
        page(
            `<a id="first" data-link data-target="t-1" data-key="a" href="https://fake.test/1">1</a>` +
            `<a id="second" data-link data-target="t-1" data-key="a" href="https://fake.test/2">2</a>`
        );
        const {lp, players} = create();
        const region = lp.getRegion("t-1");
        const info = region.get("a");

        expect(region.infos).toHaveLength(1);
        click(document.getElementById("second"));
        expect(players[0].load.mock.calls[0][0]).toBe(info);
    });

    it("marks the handled elements with its id (a debugging aid)", () => {
        page(link('data-key="a"'));
        const {lp} = create();
        expect(document.querySelector("[data-link]").dataset.lp).toBe(lp.id);
        expect(lp.id).toMatch(/^lp-\d+$/);
    });
});

describe("scan", () => {
    it("a second scan does not handle a link twice", () => {
        page(link('data-key="a"'));
        const {lp, players} = create();
        lp.scan();

        click(document.querySelector("[data-link]"));
        expect(players[0].load).toHaveBeenCalledTimes(1);
        expect(players[0].pause).not.toHaveBeenCalled(); // a second listener would have toggled the view
        expect(lp.getRegion("t-1").isVisible).toBe(true);
    });

    it("a second scan handles the links added since", () => {
        page(link('data-key="a"'));
        const {lp, players} = create();
        document.body.insertAdjacentHTML("beforeend", `<a id="late" data-link data-target="t-1" data-key="b" href="https://fake.test/b">b</a>`);
        lp.scan();

        click(document.getElementById("late"));
        expect(players[0].load.mock.calls[0][0]).toBe(lp.getRegion("t-1").get("b"));
    });

    it("a second scan does not initialize a region again", () => {
        page(link('data-key="a" data-show-on-init'));
        const {lp, players} = create();
        expect(players[0].load).toHaveBeenCalledTimes(1);

        lp.scan();
        expect(players[0].load).toHaveBeenCalledTimes(1);
        expect(lp.getRegion("t-1").isVisible).toBe(true);
    });

    it("a cloned link (the attribute is copied, the listener is not) is handled", () => {
        page(link('data-key="a"'));
        const {lp, players} = create();
        const original = document.querySelector("[data-link]");
        const clone = original.cloneNode(true);
        expect(clone.dataset.lp).toBe(lp.id); // copied by cloneNode
        document.body.append(clone);

        lp.scan();
        click(clone);
        expect(players[0].load).toHaveBeenCalledTimes(1);
    });

    it("getLinks gives an array", () => {
        page(link('data-key="a"') + link('data-key="b"'));
        const {lp} = create({autoScan: false});
        expect(Array.isArray(lp.getLinks())).toBe(true);
        expect(lp.getLinks()).toHaveLength(2);
    });

    it("autoScan: false waits for scan()", () => {
        page(link('data-key="a"'));
        const {lp} = create({autoScan: false});
        expect(lp.regions).toHaveLength(0);
        lp.scan();
        expect(lp.getRegion("t-1").has("a")).toBe(true);
    });
});

describe("init: saved state and showOnInit", () => {
    it("showOnInit navigates at start, and plays when its autoplay is init", () => {
        page(link('data-key="a" data-show-on-init data-autoplay=""'));
        const {lp, players} = create();
        expect(players[0].load).toHaveBeenCalledWith(lp.getRegion("t-1").get("a"), {autoplay: true, index: 0});
    });

    it("showOnInit does not play without autoplay", () => {
        page(link('data-key="a" data-show-on-init'));
        const {players} = create();
        expect(players[0].load.mock.calls[0][1].autoplay).toBe(false);
    });

    it("the state is saved at every change: the key and the item", () => {
        page(link('data-key="l" data-playlist'));
        const {lp, store} = create();
        click(document.querySelector("[data-link]"));
        expect(store.get("state:t-1")).toEqual({key: "l", index: 0});

        lp.getRegion("t-1").playAt(2);
        expect(store.get("state:t-1")).toEqual({key: "l", index: 2});
    });

    it("the saved state is restored, without playing", () => {
        page(link('data-key="a"') + link('data-key="b" data-playlist'));
        const first = create();
        click(document.querySelectorAll("[data-link]")[1]);
        first.lp.getRegion("t-1").playAt(3);
        first.lp.dispose();

        const second = create({}, {...makeFakes(), store: first.store});
        const region = second.lp.getRegion("t-1");
        expect(region.current).toBe(region.get("b"));
        expect(second.players[0].load).toHaveBeenCalledWith(region.get("b"), {autoplay: false, index: 3});
    });

    it("the saved state wins over showOnInit", () => {
        page(link('data-key="a" data-show-on-init') + link('data-key="b"'));
        const store = new MemoryStore();
        store.set("state:t-1", {key: "b", index: 0});

        const {lp} = create({}, {...makeFakes(), store});
        expect(lp.getRegion("t-1").current.key).toBe("b");
    });

    it("a saved key that does not exist any more is ignored", () => {
        page(link('data-key="a"'));
        const store = new MemoryStore();
        store.set("state:t-1", {key: "gone", index: 1});

        const {lp, players} = create({}, {...makeFakes(), store});
        expect(lp.getRegion("t-1").current).toBeNull();
        expect(players).toHaveLength(0);
    });

    it("useStorage: false neither saves nor restores", () => {
        page(link('data-key="a"'));
        const store = new MemoryStore();
        store.set("state:t-1", {key: "a", index: 0});

        const {lp, players} = create({useStorage: false}, {...makeFakes(), store});
        expect(players).toHaveLength(0); // not restored

        click(document.querySelector("[data-link]"));
        store.remove("state:t-1");
        lp.getRegion("t-1").playAt(1);
        expect(store.get("state:t-1")).toBeNull(); // not saved
    });
});

describe("events", () => {
    it("the events of a region reach the listeners, with their region", () => {
        page(link('data-key="a"'));
        const {lp} = create();
        const handler = vi.fn();
        lp.on("change", handler);

        click(document.querySelector("[data-link]"));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toMatchObject({type: "change", reason: "navigate", info: lp.getRegion("t-1").get("a")});
        expect(handler.mock.calls[0][0].region).toBe(lp.getRegion("t-1"));
    });

    it("on returns a function that stops listening, off too", () => {
        page(link('data-key="a"') + link('data-key="b"'));
        const {lp} = create();
        const handler = vi.fn();
        const stop = lp.on("change", handler);

        click(document.querySelectorAll("[data-link]")[0]);
        stop();
        click(document.querySelectorAll("[data-link]")[1]);
        expect(handler).toHaveBeenCalledTimes(1);

        const other = vi.fn();
        lp.on("change", other);
        lp.off("change", other);
        lp.getRegion("t-1").show();
        expect(other).not.toHaveBeenCalled();
    });

    it("onChange and onState are shortcuts", () => {
        page(link('data-key="a"'));
        const onChange = vi.fn();
        const onState = vi.fn();
        const {players} = create({onChange, onState});

        click(document.querySelector("[data-link]"));
        players[0].emit({type: "state", state: "playing"});
        expect(onChange).toHaveBeenCalled();
        expect(onState.mock.calls[0][0]).toMatchObject({type: "state", state: "playing"});
    });

    it("a failing player reaches onError", () => {
        page(link('data-key="a"'));
        const {players, errors} = create();
        click(document.querySelector("[data-link]"));

        const error = new Error("boom");
        players[0].emit({type: "error", error});
        expect(errors.at(-1)).toMatchObject({type: "error", error});
    });
});

describe("getRegion", () => {
    it("creates a region once per target", () => {
        page("");
        const {lp} = create();
        expect(lp.getRegion("t-1")).toBe(lp.getRegion("t-1"));
        expect(lp.getRegion("t-2")).not.toBe(lp.getRegion("t-1"));
        expect(lp.regions).toHaveLength(2);
        expect(() => lp.regions.push({})).toThrow(); // frozen
    });

    it("throws when the container does not exist", () => {
        page("");
        const {lp} = create();
        expect(() => lp.getRegion("zzz")).toThrow("Target #zzz not found");
    });
});

describe("existing iframes", () => {
    const iframe = '<iframe id="f" data-link src="https://fake.test/embed"></iframe>';

    it("an iframe is adopted by the region of its parent: nothing is loaded", () => {
        page("");
        document.getElementById("t-1").innerHTML = iframe;
        const {lp, players, provider} = create();
        const element = document.getElementById("f");

        expect(provider.createPlayer).toHaveBeenCalledWith({iframe: element});
        expect(players[0].load).not.toHaveBeenCalled();
        expect(lp.getRegion("t-1").current).not.toBeNull();
        expect(element.dataset.lp).toBe(lp.id);
    });

    it("scanEmbeds: false leaves iframes alone", () => {
        page("");
        document.getElementById("t-1").innerHTML = iframe;
        const {lp, provider} = create({scanEmbeds: false});
        expect(provider.createPlayer).not.toHaveBeenCalled();
        expect(lp.regions).toHaveLength(0);
    });

    it("an adopted region does not restore a saved state over it", () => {
        page("");
        document.getElementById("t-1").innerHTML = iframe;
        const store = new MemoryStore();
        store.set("state:t-1", {key: "other", index: 1});

        const {lp, players} = create(
            {definitions: [{key: "other", url: "https://fake.test/o", target: "t-1"}]},
            {...makeFakes(), store}
        );
        expect(players[0].load).not.toHaveBeenCalled();
        expect(lp.getRegion("t-1").current.key).not.toBe("other");
    });
});

describe("definitions in code (no link needed)", () => {
    const def = (props = {}) => ({key: "intro", url: "https://fake.test/i", target: "t-1", ...props});

    it("a definition becomes an info as soon as the player is created", () => {
        page("");
        const {lp, provider, registry} = create({definitions: [def()], autoScan: false});

        expect(registry.resolve).toHaveBeenCalledWith("https://fake.test/i");
        expect(provider.getInfoFromDefinition).toHaveBeenCalledWith(def());
        expect(lp.getRegion("t-1").has("intro")).toBe(true);
    });

    it("without a url the provider is the one named", () => {
        page("");
        const {registry} = create({definitions: [{key: "k", provider: "fake", target: "t-1"}], autoScan: false});
        expect(registry.get).toHaveBeenCalledWith("fake");
    });

    it("the region can navigate to it by key", () => {
        page("");
        const {lp, players} = create({definitions: [def()], autoScan: false});
        const region = lp.getRegion("t-1");

        region.navigateByKey("intro", {autoplay: true});
        expect(players[0].load).toHaveBeenCalledWith(region.get("intro"), {autoplay: true, index: 0});
    });

    it("the first definition of a key wins", () => {
        page("");
        const {lp} = create({
            definitions: [def({url: "https://fake.test/first"}), def({url: "https://fake.test/second"})],
            autoScan: false
        });
        const region = lp.getRegion("t-1");
        expect(region.infos).toHaveLength(1);
        expect(region.get("intro").url).toBe("https://fake.test/first");
    });

    it("a link with the same key is attached to the info of the definition", () => {
        page(link('data-key="intro"', "https://fake.test/from-the-link"));
        const {lp, players} = create({definitions: [def()]});
        const region = lp.getRegion("t-1");

        expect(region.infos).toHaveLength(1);
        click(document.querySelector("[data-link]"));
        expect(players[0].load.mock.calls[0][0]).toBe(region.get("intro"));
        expect(region.get("intro").url).toBe("https://fake.test/i"); // the link's own values are ignored
    });

    it("a saved state is restored for infos that only exist in code", () => {
        page("");
        const store = new MemoryStore();
        store.set("state:t-1", {key: "intro", index: 1});

        const {lp, players} = create({definitions: [def()], autoScan: false}, {...makeFakes(), store});
        expect(players).toHaveLength(0); // scan() initializes the regions

        lp.scan();
        expect(players[0].load).toHaveBeenCalledWith(lp.getRegion("t-1").get("intro"), {autoplay: false, index: 1});
    });

    it("showOnInit works for a definition too", () => {
        page("");
        const {lp, players} = create({definitions: [def({showOnInit: true, autoplay: "init"})]});
        expect(players[0].load).toHaveBeenCalledWith(lp.getRegion("t-1").get("intro"), {autoplay: true, index: 0});
    });

    // PROPOSAL 4: the option is documented (and used by the generator) as an object { key: definition }.
    it.fails("also accepts an object keyed by the key (proposal 4)", () => {
        page("");
        const {lp} = create({definitions: {intro: {url: "https://fake.test/i", target: "t-1"}}, autoScan: false});
        expect(lp.getRegion("t-1").has("intro")).toBe(true);
    });

    // PROPOSAL 5: a bad definition should be announced like a bad link, not break the construction.
    it.fails("a definition without target is an error event, the player is still created (proposal 5)", () => {
        page("");
        const {lp, errors} = create({definitions: [{key: "k", url: "https://fake.test/k"}], autoScan: false});
        expect(lp).toBeDefined();
        expect(errors[0].error.message).toBe("Target required");
    });

    // PROPOSAL 5: a lost definition (same key twice) is silent today.
    it.fails("a duplicate key in definitions is announced (proposal 5)", () => {
        page("");
        const {errors} = create({definitions: [def(), def()], autoScan: false});
        expect(errors).toHaveLength(1);
    });
});

describe("metadata of playlists", () => {
    it("the items of a playlist are completed when it is first shown, and the panel is drawn again", async () => {
        page(link('data-key="p" data-playlist'));
        const youtubeMeta = {resolve: vi.fn().mockResolvedValue([{id: "x1", title: "One"}, {id: "x2", title: "Two"}])};
        const {lp, panel} = create({youtubeMeta});
        const info = lp.getRegion("t-1").get("p");

        click(document.querySelector("[data-link]"));
        expect(youtubeMeta.resolve).toHaveBeenCalledWith(info);
        expect(panel.render).toHaveBeenCalledTimes(1);

        await flush();
        expect(info.videos.map((v) => [v.videoId, v.title])).toEqual([["x1", "One"], ["x2", "Two"]]);
        expect(panel.render).toHaveBeenCalledTimes(2);
    });

    it("nothing is asked for a single video", () => {
        page(link('data-key="a"'));
        const youtubeMeta = {resolve: vi.fn()};
        create({youtubeMeta});
        click(document.querySelector("[data-link]"));
        expect(youtubeMeta.resolve).not.toHaveBeenCalled();
    });

    it("nothing to complete: the panel is not drawn again", async () => {
        page(link('data-key="p" data-playlist'));
        const {panel} = create({youtubeMeta: {resolve: vi.fn().mockResolvedValue(null)}});
        click(document.querySelector("[data-link]"));
        await flush();
        expect(panel.render).toHaveBeenCalledTimes(1);
    });

    it("a failing resolver is announced", async () => {
        page(link('data-key="p" data-playlist'));
        const error = new Error("api down");
        const {errors} = create({youtubeMeta: {resolve: vi.fn().mockRejectedValue(error)}});
        click(document.querySelector("[data-link]"));
        await flush();
        expect(errors.at(-1)).toMatchObject({type: "error", error});
    });
});

describe("scopes", () => {
    const scoped = `<div id="scope" data-lp-scope>${link('data-key="in"').replace('data-target="t-1"', 'data-target="t-2"')}</div>`;

    it("a global player leaves the links of a declared scope alone", () => {
        page(link('data-key="out"') + scoped);
        const {lp} = create();
        expect(lp.getRegion("t-1").has("out")).toBe(true);
        expect(lp.regions.map((r) => r.target)).toEqual(["t-1"]); // t-2 never created
    });

    it("a scoped player handles the links of its scope, and marks it", () => {
        page(link('data-key="out"') + scoped);
        create();
        const second = create({scope: "#scope"});

        expect(second.lp.getRegion("t-2").has("in")).toBe(true);
        expect(document.getElementById("scope").dataset.lpScope).toBe(second.lp.id);
        expect(second.errors).toHaveLength(0);
    });

    it("each player works with its own options (no tooltip in the scope, but a tooltip outside)", () => {
        page(link('data-key="out"') + scoped);
        const global = create({tooltip: true});
        const inner = create({scope: "#scope", tooltip: false});
        expect(global.lp.getRegion("t-1").has("out")).toBe(true);
        expect(inner.lp.getRegion("t-2").has("in")).toBe(true);
        expect(global.lp.id).not.toBe(inner.lp.id);
    });

    it("a global player created first takes the links of a scope that was not declared: the scoped one says so", () => {
        page(link('data-key="out"') + scoped.replace(" data-lp-scope", ""));
        const global = create();
        expect(global.lp.getRegion("t-2").has("in")).toBe(true);

        const inner = create({scope: "#scope"});
        expect(inner.errors).toHaveLength(1);
        expect(inner.errors[0].error.message).toMatch(/already handled by another LinkPlayer/);
        expect(inner.lp.regions).toHaveLength(0);
    });

    it("a scope has one player", () => {
        page(scoped);
        create({scope: "#scope"});
        expect(() => create({scope: "#scope"})).toThrow("This scope already has a LinkPlayer");
    });

    it("throws when the scope does not exist", () => {
        page("");
        expect(() => create({scope: "#nope"})).toThrow();
    });
});

describe("dispose", () => {
    it("stops handling the links, frees them, and disposes the regions", () => {
        page(link('data-key="a"'));
        const {lp, players} = create();
        const element = document.querySelector("[data-link]");
        click(element);
        expect(players[0].load).toHaveBeenCalledTimes(1);

        lp.dispose();
        expect(players[0].dispose).toHaveBeenCalled();
        expect(element.dataset.lp).toBeUndefined();
        expect(lp.regions).toHaveLength(0);

        click(element);
        expect(players[0].load).toHaveBeenCalledTimes(1);
    });

    it("a link freed by dispose can be handled by another player", () => {
        page(link('data-key="a"'));
        const first = create();
        first.lp.dispose();

        const second = create();
        expect(second.errors).toHaveLength(0);
        click(document.querySelector("[data-link]"));
        expect(second.players[0].load).toHaveBeenCalledTimes(1);
    });

    it("frees the scope", () => {
        page('<div id="scope" data-lp-scope></div>');
        const {lp} = create({scope: "#scope"});
        expect(document.getElementById("scope").dataset.lpScope).toBe(lp.id);

        lp.dispose();
        expect(document.getElementById("scope").dataset.lpScope).toBeUndefined();
    });
});