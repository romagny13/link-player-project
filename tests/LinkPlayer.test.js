// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";

import {Region} from "../src/core/Region.js";
import {LinkPlayer} from "../src/LinkPlayer.js";
import {SingleActiveAdapter} from "../src/views/adapters/SingleActiveAdapter.js";
import {MediaView} from "../src/views/MediaView.js";
import {VideoInfo} from "../src/models/VideoInfo.js";
import {VideoListInfo} from "../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../src/models/PlaylistInfo.js";
import {MemoryStore} from "../src/utils/storage.js";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const regions = [];
const players = [];

afterEach(() => {
    regions.splice(0).forEach((region) => {
        try { region.dispose(); } catch { /* already disposed */ }
    });
    players.splice(0).forEach((lp) => {
        try { lp.dispose(); } catch { /* already disposed */ }
    });
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Region                                                              */
/* ------------------------------------------------------------------ */

/** A view that records what the region asks of it. `emit()` plays the part of the player. */
class FakeView extends MediaView {
    kind = "fake";
    calls = [];
    disposed = false;

    constructor({iframe = null} = {}) {
        super();
        if (iframe) this.setRoot(iframe, false);
    }

    get canMute() { return true; }

    load(info, {autoplay = false, index = 0} = {}) {
        this.calls.push(["load", info.key, {autoplay, index}]);
        if (!this.root) this.setRoot(document.createElement("iframe"), true);
    }

    play() { this.calls.push(["play"]); }
    pause() { this.calls.push(["pause"]); }
    next() { this.calls.push(["next"]); }
    previous() { this.calls.push(["previous"]); }
    playAt(index) { this.calls.push(["playAt", index]); }
    seekTo(seconds, options) { this.calls.push(["seekTo", seconds, options]); }
    mute() { this.calls.push(["mute"]); }
    unmute() { this.calls.push(["unmute"]); }
    setVolume(volume) { this.calls.push(["setVolume", volume]); }
    selectItem(info, index, {autoplay = true} = {}) { this.calls.push(["selectItem", index, autoplay]); }

    dispose() {
        this.disposed = true;
        super.dispose();
    }

    named(name) { return this.calls.filter(([call]) => call === name); }
}

const single = (id) => new VideoInfo({provider: "fake", target: "main", videoId: id});

const list = (ids = ["x", "y", "z"]) => {
    const info = new VideoListInfo({provider: "fake", target: "main", videoIds: ids});
    ids.forEach((id) => info.addVideo(single(id)));
    return info;
};

const playlist = () => new PlaylistInfo({provider: "fake", target: "main", playlistId: "PL1"});

function makeRegion({attach = true, ...options} = {}) {
    const views = [];
    const factory = {
        create: vi.fn(() => {
            const view = new FakeView();
            views.push(view);
            return view;
        }),
        adopt: vi.fn((iframe) => {
            const view = new FakeView({iframe});
            views.push(view);
            return view;
        })
    };
    const element = document.createElement("div");
    document.body.append(element);
    const region = new Region({name: "main", adapter: new SingleActiveAdapter(), views: factory, ...options});
    regions.push(region);
    if (attach) region.attach(element);
    return {region, factory, views, element};
}

describe("LinkPlayer", () => {
    const A = "dQw4w9WgXcQ";
    const B = "aaaaaaaaaaa";
    const C = "bbbbbbbbbbb";
    const keyOf = (id) => `youtube:${id}`;

    const make = (options = {}) => {
        const lp = new LinkPlayer({tooltip: false, useStorage: false, ...options});
        players.push(lp);
        return lp;
    };

    const html = (markup) => {
        const root = document.createElement("div");
        root.innerHTML = markup;
        document.body.append(root);
        return root;
    };

    const link = (id, attrs = "", target = "main", linkId = `l-${id}`) =>
        `<a id="${linkId}" href="https://youtu.be/${id}" data-link data-target="${target}" ${attrs}>${id}</a>`;

    const click = (element) => {
        const event = new MouseEvent("click", {bubbles: true, cancelable: true});
        element.dispatchEvent(event);
        return event;
    };

    const $ = (id) => document.getElementById(id);
    const iframeOf = (id) => $(id).querySelector("iframe");
    const srcOf = (id) => new URL(iframeOf(id).src);

    const fromPlayer = (iframe, payload) =>
        window.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify(payload),
            source: iframe.contentWindow
        }));

    describe("links", () => {
        it("renders the player in the target when the link is clicked (and prevents the navigation)", () => {
            html(`${link(A)}<div id="main"></div>`);
            make();

            const event = click($(`l-${A}`));

            expect(event.defaultPrevented).toBe(true);
            expect(iframeOf("main")).not.toBeNull();
            expect(srcOf("main").pathname).toBe(`/embed/${A}`);
            expect(srcOf("main").searchParams.has("autoplay")).toBe(false);
        });

        it("binds a non-<a> element through data-url", () => {
            html(`<button id="b" data-link data-target="main" data-url="https://youtu.be/${A}">Go</button><div id="main"></div>`);
            make();

            click($("b"));

            expect(srcOf("main").pathname).toBe(`/embed/${A}`);
        });

        it("replaces the player when another link is clicked", () => {
            html(`${link(A)}${link(B)}<div id="main"></div>`);
            make();

            click($(`l-${A}`));
            click($(`l-${B}`));

            expect($("main").querySelectorAll("iframe")).toHaveLength(1);
            expect(srcOf("main").pathname).toBe(`/embed/${B}`);
        });

        it("uses defaultTarget when a link has no target, and writes it on the element", () => {
            html(`<a id="l" href="https://youtu.be/${A}" data-link>x</a><div id="main"></div>`);
            make({defaultTarget: "main"});

            click($("l"));

            expect($("l").dataset.target).toBe("main");
            expect(iframeOf("main")).not.toBeNull();
        });

        it("reports a link without a target through the error event and goes on", () => {
            const onError = vi.fn();
            html(`<a id="bad" href="https://youtu.be/${A}" data-link>x</a>${link(B)}<div id="main"></div>`);
            make({onError});

            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError.mock.calls[0][0].error.message).toMatch(/Target not provided/);
            expect(onError.mock.calls[0][0].element).toBe($("bad"));
            click($(`l-${B}`));
            expect(iframeOf("main")).not.toBeNull();
        });

        it("reports a link to an unknown host", () => {
            const onError = vi.fn();
            html(`<a id="bad" href="https://example.com/x" data-link data-target="main">x</a><div id="main"></div>`);

            make({onError});

            expect(onError.mock.calls[0][0].error.message).toBe("No provider handles 'demo.com'");
            expect(onError.mock.calls[0][0].element).toBe($("bad"));
        });

        it("reports an invalid data-videos JSON", () => {
            const onError = vi.fn();
            html(`<a id="bad" href="https://www.youtube.com/watch_videos?video_ids=${B},${C}" data-link data-target="main" data-videos="not json">x</a><div id="main"></div>`);

            make({onError});

            expect(onError.mock.calls[0][0].error.message).toMatch(/Invalid JSON in data-videos/);
        });

        it("autoScan: false binds nothing until scan() is called", () => {
            html(`${link(A)}<div id="main"></div>`);
            const lp = make({autoScan: false});

            expect($(`l-${A}`).dataset.lp).toBeUndefined();
            expect(lp.regions).toEqual([]);

            lp.scan();
            expect($(`l-${A}`).dataset.lp).toBeDefined();
            expect(lp.getRegion("main").element).toBe($("main"));
        });
    });

    describe("data attributes", () => {
        it.each([
            ["data-autoplay", true],
            ['data-autoplay=""', true],
            ['data-autoplay="true"', true],
            ['data-autoplay="init"', true],
            ['data-autoplay="click"', true],
            ['data-autoplay="false"', false],
            ["", false]
        ])("%s: autoplay on click is %s", (attr, autoplay) => {
            html(`${link(A, attr)}<div id="main"></div>`);
            make();

            click($(`l-${A}`));

            expect(srcOf("main").searchParams.get("autoplay")).toBe(autoplay ? "1" : null);
        });

        it("data-start (1m30s) becomes start=90", () => {
            html(`${link(A, 'data-start="1m30s"')}<div id="main"></div>`);
            make();

            click($(`l-${A}`));

            expect(srcOf("main").searchParams.get("start")).toBe("90");
        });

        it("data-mute puts mute=1 in the src", () => {
            html(`${link(A, "data-mute")}<div id="main"></div>`);
            make();

            click($(`l-${A}`));

            expect(srcOf("main").searchParams.get("mute")).toBe("1");
        });

        it("data-key gives the info its own key", () => {
            html(`${link(A, 'data-key="intro"')}<div id="main"></div>`);
            const lp = make();

            expect(lp.getRegion("main").has("intro")).toBe(true);
            expect(lp.getRegion("main").has(keyOf(A))).toBe(false);
        });

        it("two links to the same video share one info: the first one wins", () => {
            html(`${link(A, 'data-title="First"', "main", "one")}${link(A, 'data-title="Second"', "main", "two")}<div id="main"></div>`);
            const lp = make();

            expect(lp.getRegion("main").infos).toHaveLength(1);
            expect(lp.getRegion("main").get(keyOf(A)).title).toBe("First");
        });
    });

    describe("format", () => {
        it("is landscape by default", () => {
            html(`${link(A)}<div id="main"></div>`);
            make();

            click($(`l-${A}`));

            expect($("main").getAttribute("data-lp-format")).toBe("landscape");
        });

        it("a Shorts link is detected as portrait", () => {
            html(`<a id="s" href="https://www.youtube.com/shorts/${A}" data-link data-target="main">s</a><div id="main"></div>`);
            make();

            click($("s"));

            expect($("main").getAttribute("data-lp-format")).toBe("portrait");
        });

        it("data-format forces it (aliases accepted)", () => {
            html(`${link(A, 'data-format="9/16"')}<div id="main"></div>`);
            make();

            click($(`l-${A}`));

            expect($("main").getAttribute("data-lp-format")).toBe("portrait");
        });
    });

    describe("definitions", () => {
        it("registers an info and lets the code navigate to it", () => {
            html(`<div id="main"></div>`);
            const lp = make({definitions: [{url: `https://youtu.be/${A}`, target: "main", title: "Intro"}]});
            const region = lp.getRegion("main");

            expect(region.get(keyOf(A)).title).toBe("Intro");
            region.navigate(keyOf(A));

            expect(srcOf("main").pathname).toBe(`/embed/${A}`);
        });

        it("builds the url from a provider and an id", () => {
            html(`<div id="main"></div>`);
            const lp = make({definitions: [{provider: "youtube", videoId: A, target: "main"}]});

            expect(lp.getRegion("main").has(keyOf(A))).toBe(true);
        });

        it("uses defaultTarget for a definition without a target", () => {
            html(`<div id="main"></div>`);
            const lp = make({defaultTarget: "main", definitions: [{url: `https://youtu.be/${A}`}]});

            expect(lp.getRegion("main").has(keyOf(A))).toBe(true);
        });

        it("showOnInit shows the info when the page loads", () => {
            html(`<div id="main"></div>`);
            const lp = make({definitions: [{url: `https://youtu.be/${A}`, target: "main", showOnInit: true}]});

            expect(lp.getRegion("main").current.key).toBe(keyOf(A));
            expect(iframeOf("main")).not.toBeNull();
        });

        it("a definition wins over a link with the same key", () => {
            html(`${link(A, 'data-title="Link title"')}<div id="main"></div>`);
            const lp = make({definitions: [{url: `https://youtu.be/${A}`, target: "main", title: "Definition title"}]});

            expect(lp.getRegion("main").get(keyOf(A)).title).toBe("Definition title");
            click($(`l-${A}`));
            expect(lp.getRegion("main").current.title).toBe("Definition title");
        });

        it("throws from the constructor for an invalid definition", () => {
            expect(() => make({definitions: "nope"})).toThrow(TypeError);
            expect(() => make({definitions: [{provider: "nope", videoId: "1", target: "main"}]}))
                .toThrow('Unknown provider: "nope"');
            expect(() => make({definitions: [{url: `https://youtu.be/${A}`}]})).toThrow(/Target is required/);
            expect(() => make({definitions: [{url: "https://example.com/x", target: "main"}]}))
                .toThrow("No provider handles 'demo.com'");
        });
    });

    describe("scope and instances", () => {
        const scoped = () => html(`
            ${link(A, "", "main", "out")}
            <section id="scope">${link(B, "", "main", "in")}<div id="main"></div></section>`);

        it("only scans inside the scope (id, selector or element)", () => {
            for (const scope of ["scope", "#scope", () => $("scope")]) {
                document.body.innerHTML = "";
                scoped();
                const lp = make({scope: typeof scope === "function" ? scope() : scope});

                expect($("in").dataset.lp).toBeDefined();
                expect($("out").dataset.lp).toBeUndefined();
                expect(lp.isGlobal).toBe(false);
            }
        });

        it("builds its id from the scope", () => {
            scoped();

            expect(make({scope: "scope"}).id).toBe("lp-scope");
            expect(make({scope: $("scope")}).id).toBe("lp-scope");
            expect(make().id).toBe("lp-global");
            expect(make().isGlobal).toBe(true);
        });

        it("throws for an unknown scope", () => {
            expect(() => make({scope: "#nope"})).toThrow(/Scope not found/);
        });

        it("a scoped instance created first keeps its elements: the global one skips them", () => {
            scoped();
            make({scope: "scope"});
            make();

            expect($("out").dataset.lp).toBeDefined();           // taken by the global instance
            click($("in"));
            expect($("main").querySelectorAll("iframe")).toHaveLength(1);
        });
    });

    describe("regions", () => {
        it("getRegion() creates the region and always returns the same one", () => {
            const lp = make();

            const region = lp.getRegion("later");

            expect(lp.getRegion("later")).toBe(region);
            expect(lp.regions).toContain(region);
            expect(region.element).toBeNull();
        });

        it("a region exists before its container: scan() shows the current state when it arrives", () => {
            const root = html(link(A));
            const lp = make();
            const region = lp.getRegion("main");
            region.navigate(keyOf(A));
            expect(region.view).toBeNull();

            root.insertAdjacentHTML("beforeend", `<div id="main"></div>`);
            lp.scan();

            expect(srcOf("main").pathname).toBe(`/embed/${A}`);
        });

        it("a container that leaves the page is released at the next scan, the state stays", () => {
            const root = html(`${link(A)}<div id="main"></div>`);
            const lp = make();
            click($(`l-${A}`));
            const region = lp.getRegion("main");

            $("main").remove();
            lp.scan();

            expect(region.element).toBeNull();
            expect(region.current.key).toBe(keyOf(A));

            root.insertAdjacentHTML("beforeend", `<div id="main"></div>`);
            lp.scan();
            expect(region.element).toBe($("main"));
            expect(iframeOf("main")).not.toBeNull();
        });

        it("scan() is idempotent: nothing is bound twice", () => {
            html(`${link(A)}<div id="main"></div>`);
            const lp = make();
            const changes = vi.fn();
            lp.on("change", changes);

            lp.scan();
            lp.scan();
            click($(`l-${A}`));

            expect(changes).toHaveBeenCalledTimes(1);
            expect(lp.regions).toHaveLength(1);
        });

        it("scan() binds what was added to the page", () => {
            const root = html(`<div id="main"></div>`);
            const lp = make();

            root.insertAdjacentHTML("beforeend", link(A));
            lp.scan();
            click($(`l-${A}`));

            expect(iframeOf("main")).not.toBeNull();
        });

        it("region.navigate() throws for an unknown key but accepts an unknown target", () => {
            const lp = make();

            expect(() => lp.getRegion("main").navigate("youtube:nope")).toThrow(/No info found/);
            expect(() => lp.getRegion("never-seen")).not.toThrow();
        });
    });

    describe("show on init and persistence", () => {
        it("shows the first showOnInit info, without autoplay unless it is 'init'", () => {
            html(`${link(A, "data-show-on-init")}${link(B, "data-show-on-init")}<div id="main"></div>`);
            const lp = make();

            expect(lp.getRegion("main").current.key).toBe(keyOf(A));
            expect(srcOf("main").searchParams.has("autoplay")).toBe(false);
        });

        it("autoplays on init for data-autoplay, but not for data-autoplay=click", () => {
            html(`${link(A, "data-show-on-init data-autoplay")}<div id="main"></div>`);
            make();
            expect(srcOf("main").searchParams.get("autoplay")).toBe("1");

            document.body.innerHTML = "";
            html(`${link(B, 'data-show-on-init data-autoplay="click"')}<div id="main"></div>`);
            make();
            expect(srcOf("main").searchParams.has("autoplay")).toBe(false);
        });

        it("initialises a region once: a second scan does not navigate again", () => {
            html(`${link(A, "data-show-on-init")}${link(B)}<div id="main"></div>`);
            const lp = make();
            const region = lp.getRegion("main");
            region.navigate(keyOf(B));

            lp.scan();

            expect(region.current.key).toBe(keyOf(B));
        });

        it("saves {key, index} and restores it at the next page load (without playing)", () => {
            const store = new MemoryStore();
            html(`${link(A, "data-show-on-init")}${link(B)}<div id="main"></div>`);
            const first = make({useStorage: true, store});
            click($(`l-${B}`));
            expect(store.get("state:main")).toEqual({key: keyOf(B), index: 0});
            first.dispose();

            document.body.innerHTML = "";
            html(`${link(A, "data-show-on-init")}${link(B, "data-autoplay")}<div id="main"></div>`);
            const second = make({useStorage: true, store});

            expect(second.getRegion("main").current.key).toBe(keyOf(B));
            expect(srcOf("main").pathname).toBe(`/embed/${B}`);
            expect(srcOf("main").searchParams.has("autoplay")).toBe(false);
        });

        it("ignores a saved key that no longer exists", () => {
            const store = new MemoryStore();
            store.set("state:main", {key: "youtube:gone", index: 0});
            html(`${link(A, "data-show-on-init")}<div id="main"></div>`);

            const lp = make({useStorage: true, store});

            expect(lp.getRegion("main").current.key).toBe(keyOf(A));
        });

        it("useStorage: false saves nothing in the given store", () => {
            const store = new MemoryStore();
            html(`${link(A)}<div id="main"></div>`);
            make({useStorage: false, store});

            click($(`l-${A}`));

            expect(store.get("state:main")).toBeNull();
        });
    });

    describe("currentBehavior", () => {
        const clicked = (currentBehavior) => {
            html(`${link(A)}<div id="main"></div>`);
            make({currentBehavior});
            click($(`l-${A}`));
            return iframeOf("main");
        };

        it("toggle (default): a click on the shown info hides, then shows the container", () => {
            const iframe = clicked();

            click($(`l-${A}`));
            expect($("main").hidden).toBe(true);

            click($(`l-${A}`));
            expect($("main").hidden).toBe(false);
            expect(iframeOf("main")).toBe(iframe);
        });

        it("skip: nothing happens", () => {
            const iframe = clicked("skip");

            click($(`l-${A}`));

            expect($("main").hidden).toBe(false);
            expect(iframeOf("main")).toBe(iframe);
        });

        it("playPause: the visibility does not change", () => {
            const iframe = clicked("playPause");

            click($(`l-${A}`));
            click($(`l-${A}`));

            expect($("main").hidden).toBe(false);
            expect(iframeOf("main")).toBe(iframe);
        });
    });

    describe("active class", () => {
        it("marks the link of the info being shown (is-active by default)", () => {
            html(`${link(A)}${link(B)}<div id="main"></div>`);
            make();

            click($(`l-${A}`));
            expect($(`l-${A}`).classList.contains("is-active")).toBe(true);
            expect($(`l-${B}`).classList.contains("is-active")).toBe(false);

            click($(`l-${B}`));
            expect($(`l-${A}`).classList.contains("is-active")).toBe(false);
            expect($(`l-${B}`).classList.contains("is-active")).toBe(true);
        });

        it("accepts a custom class", () => {
            html(`${link(A)}<div id="main"></div>`);
            make({activeClass: "now"});

            click($(`l-${A}`));

            expect($(`l-${A}`).classList.contains("now")).toBe(true);
        });

        it.each([[null], [""]])("activeClass %j disables it", (activeClass) => {
            html(`${link(A)}<div id="main"></div>`);
            make({activeClass});

            click($(`l-${A}`));

            expect($(`l-${A}`).classList.length).toBe(0);
        });

        it("activeWhenPlaying: only while the player plays", () => {
            html(`${link(A)}<div id="main"></div>`);
            make({activeClass: "playing", activeWhenPlaying: true});
            click($(`l-${A}`));
            expect($(`l-${A}`).classList.contains("playing")).toBe(false);

            fromPlayer(iframeOf("main"), {event: "onStateChange", info: 1});
            expect($(`l-${A}`).classList.contains("playing")).toBe(true);

            fromPlayer(iframeOf("main"), {event: "onStateChange", info: 2});
            expect($(`l-${A}`).classList.contains("playing")).toBe(false);
        });
    });

    describe("events", () => {
        it("lp.on() receives the events of every region and returns an unsubscribe function", () => {
            html(`${link(A, "", "one")}${link(B, "", "two")}<div id="one"></div><div id="two"></div>`);
            const lp = make();
            const seen = [];
            const off = lp.on("change", (event) => seen.push([event.region.name, event.reason]));

            click($(`l-${A}`));
            click($(`l-${B}`));
            off();
            lp.getRegion("one").navigate(keyOf(A));

            expect(seen).toEqual([["one", "navigate"], ["two", "navigate"]]);
        });

        it("onChange / onState / onError are wired as lp.on()", () => {
            html(`${link(A)}<div id="main"></div>`);
            const onChange = vi.fn();
            const onState = vi.fn();
            const onError = vi.fn();
            const lp = make({onChange, onState, onError});

            click($(`l-${A}`));
            lp.getRegion("main").play();
            fromPlayer(iframeOf("main"), {event: "onError", info: 150});

            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onState.mock.calls[0][0]).toMatchObject({type: "state", state: "playing"});
            expect(onError.mock.calls[0][0].error.message).toBe("YouTube player error 150");
        });

        it("'*' receives every event", () => {
            html(`${link(A)}<div id="main"></div>`);
            const lp = make();
            const types = [];
            lp.on("*", (event) => types.push(event.type));

            click($(`l-${A}`));
            lp.getRegion("main").play();

            expect(types).toEqual(["change", "state"]);
        });

        it("emits sound when the player reports it", () => {
            html(`${link(A)}<div id="main"></div>`);
            const lp = make();
            const handler = vi.fn();
            lp.on("sound", handler);
            click($(`l-${A}`));

            fromPlayer(iframeOf("main"), {event: "infoDelivery", info: {volume: 40, muted: true}});

            expect(handler).toHaveBeenCalled();
            expect(lp.getRegion("main").muted).toBe(true);
            expect(lp.getRegion("main").volume).toBe(0.4);
        });
    });

    describe("adopting iframes", () => {
        it("adopts a YouTube iframe: its parent becomes the region, the iframe stays", () => {
            html(`<div id="host"><iframe id="f" src="https://www.youtube.com/embed/${A}"></iframe></div>`);
            const onChange = vi.fn();
            const lp = make({onChange});
            const region = lp.getRegion("host");

            expect(region.current.key).toBe(keyOf(A));
            expect(region.view.root).toBe($("f"));
            expect(iframeOf("host")).toBe($("f"));
            expect(new URL($("f").src).searchParams.get("enablejsapi")).toBe("1");
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange.mock.calls[0][0].reason).toBe("adopt");
        });

        it("does not adopt it twice", () => {
            html(`<div id="host"><iframe src="https://www.youtube.com/embed/${A}"></iframe></div>`);
            const onChange = vi.fn();
            const lp = make({onChange});

            lp.scan();
            lp.scan();

            expect(onChange).toHaveBeenCalledTimes(1);
        });

        it("an adopted iframe with mute=1 is a muted info", () => {
            html(`<div id="host"><iframe src="https://www.youtube.com/embed/${A}?mute=1"></iframe></div>`);
            const lp = make();

            expect(lp.getRegion("host").current.mute).toBe(true);
        });

        it("scanEmbeds: false leaves iframes alone", () => {
            html(`<div id="host"><iframe src="https://www.youtube.com/embed/${A}"></iframe></div>`);
            const lp = make({scanEmbeds: false});

            expect(lp.regions).toEqual([]);
        });

        it("ignores an iframe of another site, without any error", () => {
            const onError = vi.fn();
            html(`<div id="host"><iframe src="https://example.com/"></iframe></div>`);

            const lp = make({onError});

            expect(lp.regions).toEqual([]);
            expect(onError).not.toHaveBeenCalled();
        });

        it("a link can replace an adopted iframe by another video", () => {
            html(`<div id="host"><iframe id="f" src="https://www.youtube.com/embed/${A}"></iframe></div>${link(B, "", "host")}`);
            make();
            const adopted = $("f");

            click($(`l-${B}`));

            expect(adopted.isConnected).toBe(false);
            expect($("host").querySelectorAll("iframe")).toHaveLength(1);
            expect(srcOf("host").pathname).toBe(`/embed/${B}`);
        });
    });

    describe("metadata", () => {
        it("asks the resolver for a single video only with youtubeMetaScope 'all', and fills the info", async () => {
            const resolver = {resolve: vi.fn().mockResolvedValueOnce([{id: A, title: "Fetched title", channel: "Chan"}])};
            html(`${link(A)}<div id="main"></div>`);
            const lp = make({youtubeMeta: resolver, youtubeMetaScope: "all"});
            const reasons = [];
            lp.getRegion("main").afterNavigate((ctx) => reasons.push(ctx.reason));

            click($(`l-${A}`));
            await flush();

            const info = lp.getRegion("main").get(keyOf(A));
            expect(resolver.resolve).toHaveBeenCalledTimes(1);
            expect(resolver.resolve.mock.calls[0][0]).toBe(info);
            expect(info.title).toBe("Fetched title");
            expect(info.channel).toBe("Chan");
            expect(reasons).toContain("meta");
        });

        it("does not look up a single video by default", async () => {
            const resolver = {resolve: vi.fn()};
            html(`${link(A)}<div id="main"></div>`);
            make({youtubeMeta: resolver});

            click($(`l-${A}`));
            await flush();

            expect(resolver.resolve).not.toHaveBeenCalled();
        });

        it("never overwrites what the page declared", async () => {
            const resolver = {resolve: vi.fn().mockResolvedValue([{id: A, title: "From the API", channel: "Chan"}])};
            html(`${link(A, 'data-title="Mine"')}<div id="main"></div>`);
            const lp = make({youtubeMeta: resolver, youtubeMetaScope: "all"});

            click($(`l-${A}`));
            await flush();

            const info = lp.getRegion("main").get(keyOf(A));
            expect(info.title).toBe("Mine");
            expect(info.channel).toBe("Chan");
        });

        it("refreshMeta() asks again (forced) and tells whether something changed", async () => {
            const resolver = {
                resolve: vi.fn()
                    .mockResolvedValueOnce([{id: A, title: "T"}])
                    .mockResolvedValueOnce([{id: A, title: "T2", description: "Desc"}])
            };
            html(`${link(A)}<div id="main"></div>`);
            const lp = make({youtubeMeta: resolver, youtubeMetaScope: "all"});
            click($(`l-${A}`));
            await flush();

            const changed = await lp.refreshMeta("main");

            expect(changed).toBe(true);
            expect(resolver.resolve.mock.calls[1][1]).toEqual({force: true});
            const info = lp.getRegion("main").get(keyOf(A));
            expect(info.title).toBe("T");                       // declared (already filled) values stay
            expect(info.description).toBe("Desc");
        });

        it("refreshMeta() is false for an unknown key or a region with nothing shown", async () => {
            const lp = make({youtubeMeta: {resolve: vi.fn()}});

            expect(await lp.refreshMeta("nothing")).toBe(false);
            expect(await lp.refreshMeta("nothing", "youtube:nope")).toBe(false);
        });
    });

    describe("dispose()", () => {
        it("removes views, links and regions", () => {
            html(`${link(A)}<div id="main"></div>`);
            const lp = make();
            click($(`l-${A}`));

            lp.dispose();

            expect(iframeOf("main")).toBeNull();
            expect($(`l-${A}`).dataset.lp).toBeUndefined();
            expect(lp.regions).toEqual([]);
        });

        it("stops the events", () => {
            html(`${link(A)}<div id="main"></div>`);
            const lp = make();
            const handler = vi.fn();
            lp.on("error", handler);

            lp.dispose();
            lp.getRegion("main").report(new Error("after dispose"));   // a fresh region: the old handlers are gone

            expect(handler).not.toHaveBeenCalled();
        });

        it("works with the tooltip enabled", () => {
            html(`${link(A)}<div id="main"></div>`);
            const lp = new LinkPlayer({useStorage: false});
            players.push(lp);

            expect(() => lp.dispose()).not.toThrow();
        });
    });
});