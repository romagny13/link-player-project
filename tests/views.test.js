// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";

import {CommandBinder} from "../src/views/CommandBinder.js";
import {IframeFactory} from "../src/views/IframeFactory.js";
import {MediaView} from "../src/views/MediaView.js";
import {ViewFactory} from "../src/views/ViewFactory.js";
import {ProviderRegistry} from "../src/providers/ProviderRegistry.js";
import {claim} from "../src/utils/ownership.js";

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* CommandBinder                                                       */
/* ------------------------------------------------------------------ */

describe("CommandBinder", () => {
    const fakeRegion = () => ({activate: vi.fn()});
    const link = () => {
        const a = document.createElement("a");
        a.href = "https://youtu.be/dQw4w9WgXcQ";
        document.body.append(a);
        return a;
    };
    const click = (element) => {
        const event = new MouseEvent("click", {bubbles: true, cancelable: true});
        element.dispatchEvent(event);
        return event;
    };

    it("a click prevents the default action and activates the key on the region", () => {
        const binder = new CommandBinder();
        const region = fakeRegion();
        const a = link();

        expect(binder.bind(a, region, "youtube:x")).toBe(true);
        const event = click(a);

        expect(event.defaultPrevented).toBe(true);
        expect(region.activate).toHaveBeenCalledTimes(1);
        expect(region.activate).toHaveBeenCalledWith("youtube:x", {
            autoplay: false, index: undefined, params: undefined
        });
    });

    it("passes autoplay, index and params to activate()", () => {
        const binder = new CommandBinder();
        const region = fakeRegion();
        const a = link();
        const params = {from: "menu"};

        binder.bind(a, region, "k", {autoplay: true, index: 3, params});
        click(a);

        expect(region.activate).toHaveBeenCalledWith("k", {autoplay: true, index: 3, params});
    });

    it("marks the element as handled (data-lp)", () => {
        const binder = new CommandBinder();
        const a = link();

        binder.bind(a, fakeRegion(), "k");

        expect(a.dataset.lp).toBeDefined();
    });

    it("returns false for an element that is already a command (same binder)", () => {
        const binder = new CommandBinder();
        const region = fakeRegion();
        const a = link();
        binder.bind(a, region, "k");

        expect(binder.bind(a, region, "k")).toBe(false);

        click(a);
        expect(region.activate).toHaveBeenCalledTimes(1);          // no second listener
    });

    it("returns false for an element owned by somebody else", () => {
        const binder = new CommandBinder();
        const region = fakeRegion();
        const a = link();
        claim(a, {name: "other"});

        expect(binder.bind(a, region, "k")).toBe(false);

        click(a);
        expect(region.activate).not.toHaveBeenCalled();
    });

    describe("triggers()", () => {
        it("groups the elements of a region by key", () => {
            const binder = new CommandBinder();
            const region = fakeRegion();
            const [a1, a2, b] = [link(), link(), link()];
            binder.bind(a1, region, "a");
            binder.bind(a2, region, "a");
            binder.bind(b, region, "b");

            const triggers = binder.triggers(region);

            expect([...triggers.keys()]).toEqual(["a", "b"]);
            expect([...triggers.get("a")]).toEqual([a1, a2]);
            expect([...triggers.get("b")]).toEqual([b]);
        });

        it("only returns the elements of the region asked", () => {
            const binder = new CommandBinder();
            const one = fakeRegion();
            const two = fakeRegion();
            const [a, b] = [link(), link()];
            binder.bind(a, one, "a");
            binder.bind(b, two, "b");

            expect([...binder.triggers(one).keys()]).toEqual(["a"]);
            expect([...binder.triggers(two).keys()]).toEqual(["b"]);
        });

        it("is empty for an unknown region", () => {
            expect(new CommandBinder().triggers(fakeRegion()).size).toBe(0);
        });
    });

    describe("unbind() / dispose()", () => {
        it("unbind() removes the listener, releases the element and forgets the trigger", () => {
            const binder = new CommandBinder();
            const region = fakeRegion();
            const a = link();
            binder.bind(a, region, "k");

            binder.unbind(a);
            click(a);

            expect(region.activate).not.toHaveBeenCalled();
            expect(a.dataset.lp).toBeUndefined();
            expect(binder.triggers(region).size).toBe(0);
        });

        it("a released element can be bound again", () => {
            const binder = new CommandBinder();
            const a = link();
            binder.bind(a, fakeRegion(), "k");
            binder.unbind(a);

            expect(binder.bind(a, fakeRegion(), "k")).toBe(true);
        });

        it("unbind() of an unknown element does nothing", () => {
            expect(() => new CommandBinder().unbind(link())).not.toThrow();
        });

        it("dispose() unbinds everything", () => {
            const binder = new CommandBinder();
            const region = fakeRegion();
            const [a, b] = [link(), link()];
            binder.bind(a, region, "a");
            binder.bind(b, region, "b");

            binder.dispose();
            click(a);
            click(b);

            expect(region.activate).not.toHaveBeenCalled();
            expect(binder.triggers(region).size).toBe(0);
        });
    });
});

/* ------------------------------------------------------------------ */
/* IframeFactory                                                       */
/* ------------------------------------------------------------------ */

describe("IframeFactory", () => {
    const SRC = "https://example.test/embed/1";

    it("creates a YouTube iframe from the preset", () => {
        const iframe = new IframeFactory().create("youtube", SRC);

        expect(iframe.tagName).toBe("IFRAME");
        expect(iframe.getAttribute("src")).toBe(SRC);
        expect(iframe.width).toBe("560");
        expect(iframe.height).toBe("315");
        expect(iframe.title).toBe("YouTube video player");
        expect(iframe.frameBorder).toBe("0");
        expect(iframe.allow).toContain("autoplay");
        expect(iframe.allow).toContain("encrypted-media");
        expect(iframe.referrerPolicy).toBe("strict-origin-when-cross-origin");
        expect(iframe.allowFullscreen).toBe(true);
    });

    it("creates an OK.ru iframe from the preset", () => {
        const iframe = new IframeFactory().create("okru", SRC);

        expect(iframe.title).toBe("OK.ru video player");
        expect(iframe.allow).toBe("autoplay; fullscreen");
        expect(iframe.width).toBe("560");
        expect(iframe.height).toBe("315");
    });

    it("the overrides win over the preset", () => {
        const iframe = new IframeFactory().create("youtube", SRC, {
            width: "320", title: "Mine", allowFullscreen: false
        });

        expect(iframe.width).toBe("320");
        expect(iframe.height).toBe("315");                 // from the preset
        expect(iframe.title).toBe("Mine");
        expect(iframe.allowFullscreen).toBeFalsy();
    });

    it("accepts extra attributes", () => {
        const iframe = new IframeFactory().create("youtube", SRC, {extraAttrs: {loading: "lazy", "data-x": "1"}});

        expect(iframe.getAttribute("loading")).toBe("lazy");
        expect(iframe.getAttribute("data-x")).toBe("1");
    });

    it("an unknown name only applies the overrides", () => {
        const iframe = new IframeFactory().create("whatever", SRC, {title: "Plain"});

        expect(iframe.title).toBe("Plain");
        expect(iframe.getAttribute("width")).toBeNull();
        expect(iframe.getAttribute("src")).toBe(SRC);
    });

    it("throws without a src", () => {
        expect(() => new IframeFactory().create("youtube")).toThrow(/src is required/);
        expect(() => new IframeFactory().create("youtube", "")).toThrow(TypeError);
    });

    it("register() adds a preset and returns the factory", () => {
        const factory = new IframeFactory();

        expect(factory.register("tiktok", {width: "360", height: "640", title: "TikTok"})).toBe(factory);
        const iframe = factory.create("tiktok", SRC);

        expect(iframe.width).toBe("360");
        expect(iframe.height).toBe("640");
        expect(iframe.title).toBe("TikTok");
    });

    it("register() replaces a preset", () => {
        const factory = new IframeFactory();

        factory.register("youtube", {title: "Custom"});

        expect(factory.create("youtube", SRC).title).toBe("Custom");
        expect(factory.create("youtube", SRC).getAttribute("width")).toBeNull();
    });

    it("keeps a copy of the preset: changing the original later has no effect", () => {
        const factory = new IframeFactory();
        const preset = {title: "Before"};
        factory.register("copy", preset);

        preset.title = "After";

        expect(factory.create("copy", SRC).title).toBe("Before");
    });

    it("takes its own presets instead of the default ones", () => {
        const factory = new IframeFactory({only: {title: "Only"}});

        expect(factory.create("only", SRC).title).toBe("Only");
        expect(factory.create("youtube", SRC).title).toBe("");   // no default preset anymore
    });

    it("the default presets are frozen", () => {
        expect(Object.isFrozen(IframeFactory.defaultPresets)).toBe(true);
    });
});

/* ------------------------------------------------------------------ */
/* MediaView                                                           */
/* ------------------------------------------------------------------ */

describe("MediaView", () => {
    class TestView extends MediaView {
        playAtCalls = [];
        playAt(index) { this.playAtCalls.push(index); }
    }

    it("has neutral defaults", () => {
        const view = new MediaView();

        expect(view.kind).toBe("media");
        expect(view.togglePosition).toBeNull();
        expect(view.root).toBeNull();
        expect(view.owned).toBe(false);
        expect(view.canMute).toBe(false);
    });

    it("setRoot() stores the iframe and who created it", () => {
        const view = new MediaView();
        const iframe = document.createElement("iframe");

        view.setRoot(iframe, true);

        expect(view.root).toBe(iframe);
        expect(view.owned).toBe(true);
    });

    it("load() must be implemented by the subclass", () => {
        expect(() => new MediaView().load({})).toThrow("MediaView must implement load().");
        expect(() => new TestView().load({})).toThrow("TestView must implement load().");
    });

    it("the other commands are no-ops", () => {
        const view = new MediaView();

        expect(() => {
            view.play();
            view.pause();
            view.mute();
            view.unmute();
            view.setVolume(0.5);
            view.next();
            view.previous();
            view.playAt(1);
            view.seekTo(10);
        }).not.toThrow();
    });

    describe("events", () => {
        it("emit() gives the event to every subscriber", () => {
            const view = new MediaView();
            const first = vi.fn();
            const second = vi.fn();
            view.subscribe(first);
            view.subscribe(second);

            view.emit({type: "state", state: "playing"});

            expect(first).toHaveBeenCalledWith({type: "state", state: "playing"});
            expect(second).toHaveBeenCalledWith({type: "state", state: "playing"});
        });

        it("subscribe() returns an unsubscribe function", () => {
            const view = new MediaView();
            const listener = vi.fn();
            const off = view.subscribe(listener);

            off();
            view.emit({type: "state", state: "paused"});

            expect(listener).not.toHaveBeenCalled();
        });

        it("a subscriber that unsubscribes while being called does not skip the others", () => {
            const view = new MediaView();
            const second = vi.fn();
            const off = view.subscribe(() => off());
            view.subscribe(second);

            view.emit({type: "state", state: "playing"});

            expect(second).toHaveBeenCalledTimes(1);
        });
    });

    describe("selectItem()", () => {
        it("plays the item by default", () => {
            const view = new TestView();

            view.selectItem({}, 2);

            expect(view.playAtCalls).toEqual([2]);
        });

        it("does nothing without autoplay", () => {
            const view = new TestView();

            view.selectItem({}, 2, {autoplay: false});

            expect(view.playAtCalls).toEqual([]);
        });
    });

    it("dispose() clears the subscribers and the root", () => {
        const view = new MediaView();
        const listener = vi.fn();
        view.setRoot(document.createElement("iframe"), true);
        view.subscribe(listener);

        view.dispose();
        view.emit({type: "state", state: "playing"});

        expect(view.root).toBeNull();
        expect(listener).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------ */
/* ViewFactory                                                         */
/* ------------------------------------------------------------------ */

describe("ViewFactory", () => {
    const makeProvider = (id = "fake") => ({
        id,
        hosts: [`${id}.test`],
        createView: vi.fn((options) => ({provider: id, options}))
    });

    it("create() asks the provider of the info for a new view", () => {
        const provider = makeProvider();
        const registry = {get: vi.fn(() => provider)};
        const factory = new ViewFactory(registry);

        const view = factory.create({provider: "fake"});

        expect(registry.get).toHaveBeenCalledWith("fake");
        expect(provider.createView).toHaveBeenCalledWith();
        expect(view).toEqual({provider: "fake", options: undefined});
    });

    it("adopt() asks the provider for a view that adopts the iframe", () => {
        const provider = makeProvider();
        const factory = new ViewFactory({get: () => provider});
        const iframe = document.createElement("iframe");

        const view = factory.adopt(iframe, {provider: "fake"});

        expect(provider.createView).toHaveBeenCalledWith({iframe});
        expect(view.options.iframe).toBe(iframe);
    });

    it("picks the provider by the provider id of the info", () => {
        const one = makeProvider("one");
        const two = makeProvider("two");
        const factory = new ViewFactory(new ProviderRegistry([one, two]));

        expect(factory.create({provider: "two"}).provider).toBe("two");
        expect(factory.create({provider: "one"}).provider).toBe("one");
    });

    it("an unknown provider is an error (from the registry)", () => {
        const factory = new ViewFactory(new ProviderRegistry([makeProvider()]));

        expect(() => factory.create({provider: "nope"})).toThrow('Unknown provider: "nope"');
        expect(() => factory.adopt(document.createElement("iframe"), {provider: "nope"}))
            .toThrow('Unknown provider: "nope"');
    });
});
