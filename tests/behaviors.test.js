// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";

import {FormatBehavior} from "../src/behaviors/FormatBehavior.js";
import {MuteBehavior} from "../src/behaviors/MuteBehavior.js";
import {MetaBehavior} from "../src/behaviors/MetaBehavior.js";
import {PanelBehavior} from "../src/behaviors/PanelBehavior.js";
import {PersistenceBehavior} from "../src/behaviors/PersistenceBehavior.js";
import {ActiveLinkBehavior} from "../src/behaviors/ActiveLinkBehavior.js";
import {MemoryStore} from "../src/storage.js";

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Lets pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A minimal region: only the public API the behaviors use.
 * `run(ctx)` calls the registered afterNavigate hooks, `emit(type, event)` the registered event handlers.
 */
function fakeRegion(extra = {}) {
    const hooks = new Set();
    const handlers = new Map();
    const region = {
        name: "main",
        element: document.createElement("div"),
        playerState: null,
        afterNavigate: vi.fn((hook) => {
            hooks.add(hook);
            return () => hooks.delete(hook);
        }),
        on: vi.fn((type, handler) => {
            if (!handlers.has(type)) handlers.set(type, new Set());
            handlers.get(type).add(handler);
            return () => handlers.get(type).delete(handler);
        }),
        report: vi.fn(),
        notify: vi.fn(),
        isCurrent: vi.fn(() => true),
        selectItem: vi.fn(),
        restore: vi.fn(() => true),
        context: vi.fn(() => null),
        ...extra
    };
    region.run = (ctx, from = null) => [...hooks].forEach((hook) => hook(ctx, from));
    region.emit = (type, event = {}) => handlers.get(type)?.forEach((handler) => handler({type, ...event}));
    region.hookCount = () => hooks.size;
    region.handlerCount = (type) => handlers.get(type)?.size ?? 0;
    return region;
}

/* ------------------------------------------------------------------ */
/* FormatBehavior                                                      */
/* ------------------------------------------------------------------ */

describe("FormatBehavior", () => {
    it("registers one hook", () => {
        const region = fakeRegion();

        new FormatBehavior().attach(region);

        expect(region.hookCount()).toBe(1);
    });

    it("puts the format of the item on the container", () => {
        const region = fakeRegion();
        new FormatBehavior().attach(region);

        region.run({info: {format: "landscape"}, item: {format: "portrait"}});

        expect(region.element.getAttribute("data-lp-format")).toBe("portrait");
    });

    it("falls back to the format of the info while the item is unknown", () => {
        const region = fakeRegion();
        new FormatBehavior().attach(region);

        region.run({info: {format: "square"}, item: null});

        expect(region.element.getAttribute("data-lp-format")).toBe("square");
    });

    it("follows the item inside a playlist", () => {
        const region = fakeRegion();
        new FormatBehavior().attach(region);

        region.run({info: {format: "landscape"}, item: {format: "landscape"}});
        region.run({info: {format: "landscape"}, item: {format: "portrait"}});

        expect(region.element.getAttribute("data-lp-format")).toBe("portrait");
    });

    it("moves the attribute when the region gets another element", () => {
        const region = fakeRegion();
        new FormatBehavior().attach(region);
        const first = region.element;
        region.run({info: {format: "portrait"}, item: {format: "portrait"}});

        const second = document.createElement("div");
        region.element = second;
        region.run({info: {format: "portrait"}, item: {format: "portrait"}});

        expect(first.hasAttribute("data-lp-format")).toBe(false);
        expect(second.getAttribute("data-lp-format")).toBe("portrait");
    });

    it("does not throw when the region has no element", () => {
        const region = fakeRegion({element: null});
        new FormatBehavior().attach(region);

        expect(() => region.run({info: {format: "portrait"}, item: null})).not.toThrow();
    });

    it("dispose() unsubscribes and removes the attribute", () => {
        const region = fakeRegion();
        const behavior = new FormatBehavior();
        behavior.attach(region);
        region.run({info: {format: "portrait"}, item: {format: "portrait"}});

        behavior.dispose();

        expect(region.element.hasAttribute("data-lp-format")).toBe(false);
        expect(region.hookCount()).toBe(0);
    });
});

/* ------------------------------------------------------------------ */
/* MuteBehavior                                                        */
/* ------------------------------------------------------------------ */

describe("MuteBehavior", () => {
    const makeView = (canMute = true) => ({canMute, mute: vi.fn()});
    const mutedInfo = (provider = "youtube") => ({mute: true, provider, key: `${provider}:x`});

    it("mutes the view of a muted info", () => {
        const region = fakeRegion();
        new MuteBehavior().attach(region);
        const view = makeView();

        region.run({info: mutedInfo(), view, reason: "navigate"});

        expect(view.mute).toHaveBeenCalledTimes(1);
    });

    it("applies it once per view", () => {
        const region = fakeRegion();
        new MuteBehavior().attach(region);
        const view = makeView();

        region.run({info: mutedInfo(), view, reason: "navigate"});
        region.run({info: mutedInfo(), view, reason: "item"});
        region.run({info: mutedInfo(), view, reason: "meta"});

        expect(view.mute).toHaveBeenCalledTimes(1);
    });

    it("mutes again for a new view (another info)", () => {
        const region = fakeRegion();
        new MuteBehavior().attach(region);
        const first = makeView();
        const second = makeView();

        region.run({info: mutedInfo(), view: first, reason: "navigate"});
        region.run({info: mutedInfo(), view: second, reason: "navigate"});

        expect(first.mute).toHaveBeenCalledTimes(1);
        expect(second.mute).toHaveBeenCalledTimes(1);
    });

    it("does nothing for an info that is not muted", () => {
        const region = fakeRegion();
        new MuteBehavior().attach(region);
        const view = makeView();

        region.run({info: {mute: false, provider: "youtube"}, view, reason: "navigate"});

        expect(view.mute).not.toHaveBeenCalled();
    });

    it("does nothing without a view or on detach", () => {
        const region = fakeRegion();
        new MuteBehavior().attach(region);
        const view = makeView();

        region.run({info: mutedInfo(), view: null, reason: "navigate"});
        region.run({info: mutedInfo(), view, reason: "detach"});

        expect(view.mute).not.toHaveBeenCalled();
        expect(region.report).not.toHaveBeenCalled();
    });

    it("reports an error when the view cannot be muted (and does not try)", () => {
        const region = fakeRegion();
        new MuteBehavior().attach(region);
        const view = makeView(false);
        const info = mutedInfo("okru");

        region.run({info, view, reason: "navigate"});

        expect(view.mute).not.toHaveBeenCalled();
        expect(region.report).toHaveBeenCalledTimes(1);
        const [error, context] = region.report.mock.calls[0];
        expect(error.message).toBe("mute is not supported by 'okru'");
        expect(context).toEqual({info});
    });

    it("reports the unsupported mute only once per view", () => {
        const region = fakeRegion();
        new MuteBehavior().attach(region);
        const view = makeView(false);

        region.run({info: mutedInfo("okru"), view, reason: "navigate"});
        region.run({info: mutedInfo("okru"), view, reason: "meta"});

        expect(region.report).toHaveBeenCalledTimes(1);
    });

    it("dispose() unsubscribes", () => {
        const region = fakeRegion();
        const behavior = new MuteBehavior();
        behavior.attach(region);

        behavior.dispose();

        expect(region.hookCount()).toBe(0);
    });
});

/* ------------------------------------------------------------------ */
/* MetaBehavior                                                        */
/* ------------------------------------------------------------------ */

describe("MetaBehavior", () => {
    const info = {key: "youtube:x"};

    function setup(ensure) {
        const meta = {ensure: vi.fn(ensure)};
        const region = fakeRegion();
        new MetaBehavior({meta}).attach(region);
        return {meta, region};
    }

    it("asks the meta service to complete the info that is shown", async () => {
        const {meta, region} = setup(async () => false);

        region.run({info, reason: "navigate"});
        await flush();

        expect(meta.ensure).toHaveBeenCalledWith(info);
    });

    it("notifies the region (reason meta) when the info changed and is still the current one", async () => {
        const {region} = setup(async () => true);

        region.run({info, reason: "navigate"});
        await flush();

        expect(region.isCurrent).toHaveBeenCalledWith(info.key);
        expect(region.notify).toHaveBeenCalledWith("meta");
    });

    it("does not notify when nothing changed", async () => {
        const {region} = setup(async () => false);

        region.run({info, reason: "navigate"});
        await flush();

        expect(region.notify).not.toHaveBeenCalled();
    });

    it("does not notify when the user already moved on to another info", async () => {
        const {region} = setup(async () => true);
        region.isCurrent.mockReturnValue(false);

        region.run({info, reason: "navigate"});
        await flush();

        expect(region.notify).not.toHaveBeenCalled();
    });

    it("ignores its own notification (meta) and detach, to avoid a loop", async () => {
        const {meta, region} = setup(async () => true);

        region.run({info, reason: "meta"});
        region.run({info, reason: "detach"});
        await flush();

        expect(meta.ensure).not.toHaveBeenCalled();
    });

    it("reports a failure of the service through the region", async () => {
        const failure = new Error("api down");
        const {region} = setup(async () => {
            throw failure;
        });

        region.run({info, reason: "navigate"});
        await flush();

        expect(region.report).toHaveBeenCalledWith(failure, {info});
        expect(region.notify).not.toHaveBeenCalled();
    });

    it("dispose() unsubscribes", () => {
        const region = fakeRegion();
        const behavior = new MetaBehavior({meta: {ensure: vi.fn()}});
        behavior.attach(region);

        behavior.dispose();

        expect(region.hookCount()).toBe(0);
    });
});

/* ------------------------------------------------------------------ */
/* ActiveLinkBehavior                                                  */
/* ------------------------------------------------------------------ */

describe("ActiveLinkBehavior", () => {
    const link = () => document.createElement("a");

    /** A binder whose triggers are given: key -> elements. */
    function binderOf(map) {
        const triggers = new Map(Object.entries(map).map(([key, elements]) => [key, new Set(elements)]));
        return {triggers: vi.fn(() => triggers)};
    }

    it("marks the links of the current info, and only those", () => {
        const [a1, a2, b] = [link(), link(), link()];
        const region = fakeRegion();
        new ActiveLinkBehavior({binder: binderOf({a: [a1, a2], b: [b]}), activeClass: "is-active"}).attach(region);

        region.run({info: {key: "a"}});

        expect(a1.classList.contains("is-active")).toBe(true);
        expect(a2.classList.contains("is-active")).toBe(true);
        expect(b.classList.contains("is-active")).toBe(false);
    });

    it("moves the mark when the current info changes", () => {
        const [a, b] = [link(), link()];
        const region = fakeRegion();
        new ActiveLinkBehavior({binder: binderOf({a: [a], b: [b]}), activeClass: "on"}).attach(region);

        region.run({info: {key: "a"}});
        region.run({info: {key: "b"}});

        expect(a.classList.contains("on")).toBe(false);
        expect(b.classList.contains("on")).toBe(true);
    });

    it("accepts several classes (array or space-separated string)", () => {
        const [a, b] = [link(), link()];
        const regionA = fakeRegion();
        const regionB = fakeRegion();
        new ActiveLinkBehavior({binder: binderOf({a: [a]}), activeClass: ["x", "y"]}).attach(regionA);
        new ActiveLinkBehavior({binder: binderOf({b: [b]}), activeClass: "m  n"}).attach(regionB);

        regionA.run({info: {key: "a"}});
        regionB.run({info: {key: "b"}});

        expect([...a.classList]).toEqual(["x", "y"]);
        expect([...b.classList]).toEqual(["m", "n"]);
    });

    it("uses the class `active` by default", () => {
        const a = link();
        const region = fakeRegion();
        new ActiveLinkBehavior({binder: binderOf({a: [a]})}).attach(region);

        region.run({info: {key: "a"}});

        expect(a.classList.contains("active")).toBe(true);
    });

    it("does nothing at all when the class is empty or null", () => {
        const regionEmpty = fakeRegion();
        const regionNull = fakeRegion();

        new ActiveLinkBehavior({binder: binderOf({}), activeClass: ""}).attach(regionEmpty);
        new ActiveLinkBehavior({binder: binderOf({}), activeClass: null}).attach(regionNull);

        expect(regionEmpty.hookCount()).toBe(0);
        expect(regionNull.hookCount()).toBe(0);
        expect(regionEmpty.handlerCount("state")).toBe(0);
    });

    it("clears every mark when there is no current state", () => {
        const a = link();
        const region = fakeRegion();
        new ActiveLinkBehavior({binder: binderOf({a: [a]}), activeClass: "on"}).attach(region);
        region.run({info: {key: "a"}});

        region.run(null);

        expect(a.classList.contains("on")).toBe(false);
    });

    describe("whenPlaying", () => {
        it("marks only while the player plays", () => {
            const a = link();
            const ctx = {info: {key: "a"}};
            const region = fakeRegion({context: vi.fn(() => ctx)});
            new ActiveLinkBehavior({
                binder: binderOf({a: [a]}), activeClass: "playing", whenPlaying: true
            }).attach(region);

            region.run(ctx);
            expect(a.classList.contains("playing")).toBe(false);      // shown, not playing

            region.playerState = "playing";
            region.emit("state", {state: "playing"});
            expect(a.classList.contains("playing")).toBe(true);

            region.playerState = "paused";
            region.emit("state", {state: "paused"});
            expect(a.classList.contains("playing")).toBe(false);
        });

        it("without whenPlaying, a state event keeps the mark while the info is shown", () => {
            const a = link();
            const ctx = {info: {key: "a"}};
            const region = fakeRegion({context: vi.fn(() => ctx)});
            new ActiveLinkBehavior({binder: binderOf({a: [a]}), activeClass: "on"}).attach(region);

            region.run(ctx);
            region.playerState = "paused";
            region.emit("state", {state: "paused"});

            expect(a.classList.contains("on")).toBe(true);
        });
    });

    it("dispose() removes the marks and unsubscribes", () => {
        const a = link();
        const region = fakeRegion();
        const behavior = new ActiveLinkBehavior({binder: binderOf({a: [a]}), activeClass: "on"});
        behavior.attach(region);
        region.run({info: {key: "a"}});

        behavior.dispose();

        expect(a.classList.contains("on")).toBe(false);
        expect(region.hookCount()).toBe(0);
        expect(region.handlerCount("state")).toBe(0);
    });
});

/* ------------------------------------------------------------------ */
/* PersistenceBehavior                                                 */
/* ------------------------------------------------------------------ */

describe("PersistenceBehavior", () => {
    it("saves {key, index} at each navigation, under the name of the region", () => {
        const store = new MemoryStore();
        const region = fakeRegion({name: "side"});
        new PersistenceBehavior({store}).attach(region);

        region.run({info: {key: "youtube:x"}, index: 3, reason: "navigate"});

        expect(store.get("state:side")).toEqual({key: "youtube:x", index: 3});
    });

    it("keeps the last state only", () => {
        const store = new MemoryStore();
        const region = fakeRegion();
        new PersistenceBehavior({store}).attach(region);

        region.run({info: {key: "a"}, index: 0, reason: "navigate"});
        region.run({info: {key: "b"}, index: 2, reason: "item"});

        expect(store.get("state:main")).toEqual({key: "b", index: 2});
    });

    it.each(["meta", "immediate", "detach"])("does not save for the reason '%s'", (reason) => {
        const store = new MemoryStore();
        const region = fakeRegion();
        new PersistenceBehavior({store}).attach(region);

        region.run({info: {key: "a"}, index: 1, reason});

        expect(store.get("state:main")).toBeNull();
    });

    it("keeps each region apart", () => {
        const store = new MemoryStore();
        const behavior = new PersistenceBehavior({store});
        const main = fakeRegion({name: "main"});
        const side = fakeRegion({name: "side"});
        behavior.attach(main);
        behavior.attach(side);

        main.run({info: {key: "a"}, index: 0, reason: "navigate"});
        side.run({info: {key: "b"}, index: 1, reason: "navigate"});

        expect(store.get("state:main")).toEqual({key: "a", index: 0});
        expect(store.get("state:side")).toEqual({key: "b", index: 1});
    });

    describe("read() / restore()", () => {
        it("reads nothing when nothing was saved", () => {
            const behavior = new PersistenceBehavior({store: new MemoryStore()});

            expect(behavior.read(fakeRegion())).toBeNull();
        });

        it("reads the saved state", () => {
            const store = new MemoryStore();
            store.set("state:main", {key: "a", index: 4});

            expect(new PersistenceBehavior({store}).read(fakeRegion())).toEqual({key: "a", index: 4});
        });

        it.each([[-1], [1.5], ["2"], [undefined], [null]])("sanitizes the saved index %j to 0", (index) => {
            const store = new MemoryStore();
            store.set("state:main", {key: "a", index});

            expect(new PersistenceBehavior({store}).read(fakeRegion()).index).toBe(0);
        });

        it("ignores a saved state without a key", () => {
            const store = new MemoryStore();
            store.set("state:main", {index: 2});

            expect(new PersistenceBehavior({store}).read(fakeRegion())).toBeNull();
        });

        it("restore() gives the saved state to the region and returns its answer", () => {
            const store = new MemoryStore();
            store.set("state:main", {key: "a", index: 2});
            const region = fakeRegion();
            const behavior = new PersistenceBehavior({store});

            expect(behavior.restore(region)).toBe(true);
            expect(region.restore).toHaveBeenCalledWith("a", {index: 2});

            region.restore.mockReturnValue(false);       // the key does not exist anymore
            expect(behavior.restore(region)).toBe(false);
        });

        it("restore() is false and does not call the region when nothing was saved", () => {
            const region = fakeRegion();

            expect(new PersistenceBehavior({store: new MemoryStore()}).restore(region)).toBe(false);
            expect(region.restore).not.toHaveBeenCalled();
        });
    });

    describe("disabled", () => {
        it("registers no hook, saves nothing, restores nothing", () => {
            const store = new MemoryStore();
            store.set("state:main", {key: "a", index: 1});
            const region = fakeRegion();
            const behavior = new PersistenceBehavior({store, enabled: false});

            behavior.attach(region);
            region.run({info: {key: "b"}, index: 0, reason: "navigate"});

            expect(region.hookCount()).toBe(0);
            expect(store.get("state:main")).toEqual({key: "a", index: 1});
            expect(behavior.read(region)).toBeNull();
            expect(behavior.restore(region)).toBe(false);
        });
    });

    it("dispose(region) stops saving for that region only", () => {
        const store = new MemoryStore();
        const behavior = new PersistenceBehavior({store});
        const main = fakeRegion({name: "main"});
        const side = fakeRegion({name: "side"});
        behavior.attach(main);
        behavior.attach(side);

        behavior.dispose(main);
        main.run({info: {key: "a"}, index: 0, reason: "navigate"});
        side.run({info: {key: "b"}, index: 0, reason: "navigate"});

        expect(store.get("state:main")).toBeNull();
        expect(store.get("state:side")).toEqual({key: "b", index: 0});
    });
});

/* ------------------------------------------------------------------ */
/* PanelBehavior                                                       */
/* ------------------------------------------------------------------ */

describe("PanelBehavior", () => {
    const makePanel = () => ({render: vi.fn(), setCurrent: vi.fn(), clear: vi.fn(), destroy: vi.fn()});
    const playlist = () => ({key: "youtube:list:a,b", isPlaylist: true});
    const single = () => ({key: "youtube:a", isPlaylist: false});

    function setup() {
        const panel = makePanel();
        const region = fakeRegion();
        const behavior = new PanelBehavior({panel});
        behavior.attach(region);
        const ctx = (o = {}) => ({
            region,
            info: playlist(),
            index: 0,
            view: {root: document.createElement("iframe"), togglePosition: "bottom-left"},
            reason: "navigate",
            ...o
        });
        return {panel, region, behavior, ctx};
    }

    it("draws the panel of a playlist next to the view", () => {
        const {panel, region, ctx} = setup();
        const c = ctx({index: 2});

        region.run(c);

        expect(panel.clear).toHaveBeenCalledTimes(1);
        expect(panel.render).toHaveBeenCalledTimes(1);
        const options = panel.render.mock.calls[0][0];
        expect(options.host).toBe(region.element);
        expect(options.iframe).toBe(c.view.root);
        expect(options.info).toBe(c.info);
        expect(options.current).toBe(2);
        expect(options.togglePosition).toBe("bottom-left");
    });

    it("lets the panel choose the toggle position when the view has none", () => {
        const {panel, region, ctx} = setup();

        region.run(ctx({view: {root: document.createElement("iframe")}}));

        expect(panel.render.mock.calls[0][0].togglePosition).toBeUndefined();
    });

    it("selecting a row asks the region for that item", () => {
        const {panel, region, ctx} = setup();
        region.run(ctx());

        panel.render.mock.calls[0][0].onSelectItem(3);

        expect(region.selectItem).toHaveBeenCalledWith(3);
    });

    it("only moves the current item when the same info and view are shown again", () => {
        const {panel, region, ctx} = setup();
        const first = ctx();

        region.run(first);
        region.run({...first, index: 1, reason: "item"});

        expect(panel.render).toHaveBeenCalledTimes(1);
        expect(panel.setCurrent).toHaveBeenCalledWith(1);
    });

    it("draws again when the metadata changed (reason meta)", () => {
        const {panel, region, ctx} = setup();
        const first = ctx();

        region.run(first);
        region.run({...first, reason: "meta"});

        expect(panel.render).toHaveBeenCalledTimes(2);
        expect(panel.setCurrent).not.toHaveBeenCalled();
    });

    it("draws again for another view or another info", () => {
        const {panel, region, ctx} = setup();
        const first = ctx();

        region.run(first);
        region.run({...first, view: {root: document.createElement("iframe")}});
        region.run({...first, info: playlist()});

        expect(panel.render).toHaveBeenCalledTimes(3);
    });

    it("clears the panel when a single video replaces a playlist", () => {
        const {panel, region, ctx} = setup();
        region.run(ctx());
        panel.clear.mockClear();

        region.run(ctx({info: single()}));

        expect(panel.clear).toHaveBeenCalledTimes(1);
    });

    it("clears the panel when there is no view", () => {
        const {panel, region, ctx} = setup();
        region.run(ctx());
        panel.clear.mockClear();

        region.run(ctx({view: null}));

        expect(panel.clear).toHaveBeenCalledTimes(1);
    });

    it("does not touch the panel for a single video when nothing is drawn", () => {
        const {panel, region, ctx} = setup();

        region.run(ctx({info: single()}));
        region.run(ctx({view: null}));

        expect(panel.clear).not.toHaveBeenCalled();
        expect(panel.render).not.toHaveBeenCalled();
    });

    it("dispose() unsubscribes and destroys the panel", () => {
        const {panel, region, behavior} = setup();

        behavior.dispose();

        expect(panel.destroy).toHaveBeenCalledTimes(1);
        expect(region.hookCount()).toBe(0);
    });
});
