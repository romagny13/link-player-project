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

describe("Region", () => {
    describe("construction and initial state", () => {
        it("rejects an unknown boundaryBehavior", () => {
            expect(() => new Region({
                name: "x", adapter: new SingleActiveAdapter(), views: {}, boundaryBehavior: "bounce"
            })).toThrow(/Invalid boundaryBehavior/);
        });

        it("starts empty", () => {
            const {region} = makeRegion({attach: false});

            expect(region.name).toBe("main");
            expect(region.element).toBeNull();
            expect(region.view).toBeNull();
            expect(region.current).toBeNull();
            expect(region.currentIndex).toBe(0);
            expect(region.currentParams).toEqual({});
            expect(region.itemCount).toBe(0);
            expect(region.infos).toEqual([]);
            expect(region.playerState).toBeNull();
            expect(region.isVisible).toBe(false);
            expect(region.canMute).toBe(false);
            expect(region.muted).toBeNull();
            expect(region.volume).toBeNull();
            expect(region.canGoBack).toBe(false);
            expect(region.canGoForward).toBe(false);
            expect(region.context()).toBeNull();
        });
    });

    describe("infos", () => {
        it("add() keeps the first info of a key and returns the one the region holds", () => {
            const {region} = makeRegion();
            const first = single("a");
            const second = single("a");

            expect(region.add(first)).toBe(first);
            expect(region.add(second)).toBe(first);
            expect(region.has("fake:a")).toBe(true);
            expect(region.get("fake:a")).toBe(first);
            expect(region.infos).toEqual([first]);
        });

        it("navigate() throws for an unknown key", () => {
            const {region} = makeRegion();

            expect(() => region.navigate("fake:nope")).toThrow("No info found for key 'fake:nope' in region 'main'");
        });
    });

    describe("navigate()", () => {
        it("creates a view in the element and loads the info", () => {
            const {region, factory, views, element} = makeRegion();
            region.add(single("a"));

            region.navigate("fake:a");

            expect(factory.create).toHaveBeenCalledTimes(1);
            expect(views[0].calls).toEqual([["load", "fake:a", {autoplay: false, index: 0}]]);
            expect(element.contains(views[0].root)).toBe(true);
            expect(region.view).toBe(views[0]);
            expect(region.current.key).toBe("fake:a");
            expect(region.isCurrent("fake:a")).toBe(true);
            expect(region.isVisible).toBe(true);
        });

        it("passes autoplay and the index to the view", () => {
            const {region, views} = makeRegion();
            region.add(list());

            region.navigate("fake:list:x,y,z", {autoplay: true, index: 2});

            expect(views[0].calls[0]).toEqual(["load", "fake:list:x,y,z", {autoplay: true, index: 2}]);
            expect(region.currentIndex).toBe(2);
        });

        it.each([[-1], [1.5], ["2"], [undefined], [null]])("takes %j as the first item", (index) => {
            const {region} = makeRegion();
            region.add(list());

            region.navigate("fake:list:x,y,z", {index});

            expect(region.currentIndex).toBe(0);
        });

        it("another info replaces the view: the previous one is disposed and removed", () => {
            const {region, views, element} = makeRegion();
            region.add(single("a"));
            region.add(single("b"));

            region.navigate("fake:a");
            const firstRoot = views[0].root;
            region.navigate("fake:b");

            expect(views).toHaveLength(2);
            expect(views[0].disposed).toBe(true);
            expect(firstRoot.isConnected).toBe(false);
            expect(element.querySelectorAll("iframe")).toHaveLength(1);
            expect(region.view).toBe(views[1]);
        });

        it("the same info reuses the view: a single player command, no new view", () => {
            const {region, factory, views} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");

            region.navigate("fake:a");                       // no autoplay: nothing to say to the player
            region.navigate("fake:a", {autoplay: true});

            expect(factory.create).toHaveBeenCalledTimes(1);
            expect(views[0].named("load")).toHaveLength(1);
            expect(views[0].named("play")).toHaveLength(1);
        });

        it("the same info shows the region again when it was hidden", () => {
            const {region} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");
            region.hide();

            region.navigate("fake:a");

            expect(region.isVisible).toBe(true);
        });

        it("another item of the same list is a command of the same view, not a new view", () => {
            const {region, factory, views} = makeRegion();
            region.add(list());
            region.navigate("fake:list:x,y,z");

            region.navigate("fake:list:x,y,z", {index: 1, autoplay: true});

            expect(factory.create).toHaveBeenCalledTimes(1);
            expect(views[0].named("selectItem")).toEqual([["selectItem", 1, true]]);
        });

        it("keeps the params of the navigation as a frozen snapshot", () => {
            const {region} = makeRegion();
            region.add(single("a"));
            const params = {from: "menu"};

            region.navigate("fake:a", {params});
            params.from = "changed";

            expect(region.currentParams).toEqual({from: "menu"});
            expect(Object.isFrozen(region.currentParams)).toBe(true);
        });

        it("emits a change with the whole context", () => {
            const {region, views} = makeRegion();
            const info = single("a");
            region.add(info);
            const changes = [];
            region.on("change", (event) => changes.push(event));

            region.navigate("fake:a", {params: {why: "test"}});

            expect(changes).toHaveLength(1);
            const [event] = changes;
            expect(event.type).toBe("change");
            expect(event.region).toBe(region);
            expect(event.info).toBe(info);
            expect(event.item).toBe(info);
            expect(event.index).toBe(0);
            expect(event.params).toEqual({why: "test"});
            expect(event.reason).toBe("navigate");
            expect(event.view).toBe(views[0]);
        });

        it("a list gives the item at the index (null while unknown)", () => {
            const {region} = makeRegion();
            const info = list();
            region.add(info);
            const bare = new VideoListInfo({provider: "fake", target: "main", videoIds: ["p", "q"]});
            region.add(bare);

            region.navigate(info.key, {index: 1});
            expect(region.context().item).toBe(info.videos[1]);

            region.navigate(bare.key, {index: 1});
            expect(region.context().item).toBeNull();
        });
    });

    describe("journal", () => {
        it("back() and forward() move the state, never add an entry", () => {
            const {region, views} = makeRegion();
            region.add(single("a"));
            region.add(single("b"));
            region.navigate("fake:a", {params: {n: 1}});
            region.navigate("fake:b");
            const reasons = [];
            region.on("change", (event) => reasons.push(event.reason));

            expect(region.canGoBack).toBe(true);
            expect(region.back()).toBe(true);
            expect(region.current.key).toBe("fake:a");
            expect(region.currentParams).toEqual({n: 1});
            expect(region.canGoForward).toBe(true);
            expect(region.forward()).toBe(true);
            expect(region.current.key).toBe("fake:b");

            expect(reasons).toEqual(["back", "forward"]);
            expect(views[views.length - 1].named("load").at(-1)[2].autoplay).toBe(false);
        });

        it("back() / forward() return false at the ends", () => {
            const {region} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");

            expect(region.back()).toBe(false);
            expect(region.forward()).toBe(false);
        });

        it("navigating after a back() drops the forward history", () => {
            const {region} = makeRegion();
            ["a", "b", "c"].forEach((id) => region.add(single(id)));
            region.navigate("fake:a");
            region.navigate("fake:b");
            region.back();

            region.navigate("fake:c");

            expect(region.canGoForward).toBe(false);
        });

        it("replace() changes the current entry without adding one", () => {
            const {region} = makeRegion();
            region.add(single("a"));
            region.add(single("b"));
            region.navigate("fake:a");

            region.replace("fake:b");

            expect(region.current.key).toBe("fake:b");
            expect(region.canGoBack).toBe(false);
        });

        it("replace() on an empty journal adds the first entry", () => {
            const {region} = makeRegion();
            region.add(single("a"));

            region.replace("fake:a");

            expect(region.current.key).toBe("fake:a");
        });
    });

    describe("restore()", () => {
        it("returns false for an unknown key", () => {
            const {region} = makeRegion();

            expect(region.restore("fake:nope")).toBe(false);
        });

        it("shows the info without ever playing", () => {
            const {region, views} = makeRegion();
            region.add(single("a"));
            const reasons = [];
            region.on("change", (event) => reasons.push(event.reason));

            expect(region.restore("fake:a")).toBe(true);

            expect(views[0].calls).toEqual([["load", "fake:a", {autoplay: false, index: 0}]]);
            expect(reasons).toEqual(["restore"]);
        });

        it("does nothing when the info and the item already are the current ones", () => {
            const {region} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");
            const changes = vi.fn();
            region.on("change", changes);

            expect(region.restore("fake:a")).toBe(true);

            expect(changes).not.toHaveBeenCalled();
        });

        it("moves to another item of the current list", () => {
            const {region, views} = makeRegion();
            region.add(list());
            region.navigate("fake:list:x,y,z");

            region.restore("fake:list:x,y,z", {index: 2});

            expect(region.currentIndex).toBe(2);
            expect(views[0].named("selectItem")).toEqual([["selectItem", 2, false]]);
        });
    });

    describe("activate() (what a click does)", () => {
        const shown = (options) => {
            const context = makeRegion(options);
            context.region.add(single("a"));
            context.region.add(single("b"));
            context.region.navigate("fake:a");
            return context;
        };

        it("navigates when the info is not the current one, and returns true", () => {
            const {region} = shown();

            expect(region.activate("fake:b")).toBe(true);
            expect(region.current.key).toBe("fake:b");
        });

        it("navigates when the info is the current one but there is no view", () => {
            const {region} = makeRegion({attach: false});
            region.add(single("a"));
            region.navigate("fake:a");

            expect(region.activate("fake:a")).toBe(true);
            expect(region.canGoBack).toBe(true);              // a second entry was pushed
        });

        it("toggle (default): hides, then shows the current info", () => {
            const {region, views} = shown();

            region.activate("fake:a");
            expect(region.isVisible).toBe(false);
            expect(views[0].named("pause")).toHaveLength(1);

            region.activate("fake:a");
            expect(region.isVisible).toBe(true);
            expect(views[0].named("play")).toHaveLength(0);
        });

        it("toggle: shows and plays when autoplay is requested", () => {
            const {region, views} = shown();
            region.hide();

            region.activate("fake:a", {autoplay: true});

            expect(region.isVisible).toBe(true);
            expect(views[0].named("play")).toHaveLength(1);
        });

        it("skip: nothing happens", () => {
            const {region, views} = shown({currentBehavior: "skip"});

            expect(region.activate("fake:a")).toBe(false);

            expect(region.isVisible).toBe(true);
            expect(views[0].calls).toHaveLength(1);           // only the load
        });

        it("playPause: plays or pauses, the visibility does not change", () => {
            const {region, views} = shown({currentBehavior: "playPause"});

            region.activate("fake:a");
            expect(views[0].named("play")).toHaveLength(1);
            expect(region.playerState).toBe("playing");

            region.activate("fake:a");
            expect(views[0].named("pause")).toHaveLength(1);
            expect(region.playerState).toBe("paused");
            expect(region.isVisible).toBe(true);
        });

        it("navigate() always navigates, whatever currentBehavior says", () => {
            const {region} = shown({currentBehavior: "skip"});

            region.navigate("fake:a");

            expect(region.canGoBack).toBe(true);
        });
    });

    describe("between infos", () => {
        const withThree = (options) => {
            const context = makeRegion(options);
            ["a", "b", "c"].forEach((id) => context.region.add(single(id)));
            return context;
        };

        it("nextInfo() / previousInfo() navigate with autoplay on", () => {
            const {region, views} = withThree();
            region.navigate("fake:b");

            expect(region.nextInfo()).toBe(true);
            expect(region.current.key).toBe("fake:c");
            expect(views.at(-1).named("load")[0][2].autoplay).toBe(true);

            expect(region.previousInfo()).toBe(true);
            expect(region.current.key).toBe("fake:b");
        });

        it("the options given override the defaults", () => {
            const {region, views} = withThree();
            region.navigate("fake:a");

            region.nextInfo({autoplay: false});

            expect(views.at(-1).named("load")[0][2].autoplay).toBe(false);
        });

        it("stop (default): returns false at the ends", () => {
            const {region} = withThree();
            region.navigate("fake:a");

            expect(region.canGoPreviousInfo).toBe(false);
            expect(region.previousInfo()).toBe(false);

            region.navigate("fake:c");
            expect(region.canGoNextInfo).toBe(false);
            expect(region.nextInfo()).toBe(false);
            expect(region.current.key).toBe("fake:c");
        });

        it("loop: wraps around at the ends", () => {
            const {region} = withThree({boundaryBehavior: "loop"});
            region.navigate("fake:c");

            expect(region.canGoNextInfo).toBe(true);
            region.nextInfo();
            expect(region.current.key).toBe("fake:a");

            expect(region.canGoPreviousInfo).toBe(true);
            region.previousInfo();
            expect(region.current.key).toBe("fake:c");
        });

        it("loop needs two infos or more", () => {
            const {region} = makeRegion({boundaryBehavior: "loop"});
            region.add(single("a"));
            region.navigate("fake:a");

            expect(region.canGoNextInfo).toBe(false);
            expect(region.nextInfo()).toBe(false);
        });

        it("without a current info, nextInfo() goes to the first one", () => {
            const {region} = withThree();

            expect(region.canGoNextInfo).toBe(true);
            region.nextInfo();

            expect(region.current.key).toBe("fake:a");
        });
    });

    describe("inside a list", () => {
        it("tells what can be done", () => {
            const {region} = makeRegion();
            region.add(list());
            region.navigate("fake:list:x,y,z");

            expect(region.itemCount).toBe(3);
            expect(region.canGoPreviousItem).toBe(false);
            expect(region.canGoNextItem).toBe(true);

            region.selectItem(2, {autoplay: false});
            expect(region.canGoPreviousItem).toBe(true);
            expect(region.canGoNextItem).toBe(false);
        });

        it("a single video has no items", () => {
            const {region} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");

            expect(region.itemCount).toBe(0);
            expect(region.canGoNextItem).toBe(false);
            expect(region.selectItem(1)).toBe(false);
        });

        it("a playlist of unknown length can always go forward", () => {
            const {region, views} = makeRegion();
            region.add(playlist());
            region.navigate("fake:playlist:PL1");

            expect(region.itemCount).toBeNull();
            expect(region.canGoNextItem).toBe(true);
            expect(region.nextItem()).toBe(true);
            expect(views[0].named("next")).toHaveLength(1);
        });

        it("selectItem() updates the item, asks the view (autoplay by default) and emits item", () => {
            const {region, views} = makeRegion();
            region.add(list());
            region.navigate("fake:list:x,y,z");
            const reasons = [];
            region.on("change", (event) => reasons.push(event.reason));

            expect(region.selectItem(1)).toBe(true);
            region.selectItem(2, {autoplay: false});

            expect(region.currentIndex).toBe(2);
            expect(views[0].named("selectItem")).toEqual([["selectItem", 1, true], ["selectItem", 2, false]]);
            expect(reasons).toEqual(["item", "item"]);
        });

        it("nextItem() / previousItem() drive the view, within the bounds", () => {
            const {region, views} = makeRegion();
            region.add(list());
            region.navigate("fake:list:x,y,z");

            expect(region.previousItem()).toBe(false);
            expect(region.nextItem()).toBe(true);
            expect(views[0].named("next")).toHaveLength(1);

            region.selectItem(2, {autoplay: false});
            expect(region.nextItem()).toBe(false);
            expect(region.previousItem()).toBe(true);
            expect(views[0].named("previous")).toHaveLength(1);
        });

        it("nextItem() / previousItem() do nothing without a view", () => {
            const {region} = makeRegion({attach: false});
            region.add(list());
            region.navigate("fake:list:x,y,z");

            expect(region.nextItem()).toBe(false);
            expect(region.previousItem()).toBe(false);
        });
    });

    describe("what the view says", () => {
        const withList = () => {
            const context = makeRegion();
            context.region.add(list());
            context.region.navigate("fake:list:x,y,z");
            return context;
        };

        it("believes an announced item and emits item", () => {
            const {region, views} = withList();
            const changes = [];
            region.on("change", (event) => changes.push([event.reason, event.index]));

            views[0].emit({type: "itemChange", index: 2});

            expect(region.currentIndex).toBe(2);
            expect(changes).toEqual([["item", 2]]);
        });

        it.each([[3], [-1], [1.5], ["1"], [undefined], [0]])("ignores the announced item %j", (index) => {
            const {region, views} = withList();
            const changes = vi.fn();
            region.on("change", changes);

            views[0].emit({type: "itemChange", index});

            expect(changes).not.toHaveBeenCalled();
            expect(region.currentIndex).toBe(0);
        });

        it("tracks the state of the player and emits state", () => {
            const {region, views} = withList();
            const states = [];
            region.on("state", (event) => states.push([event.state, event.index]));

            views[0].emit({type: "state", state: "playing"});
            views[0].emit({type: "state", state: "ended", index: 1});

            expect(region.playerState).toBe("ended");
            expect(states).toEqual([["playing", 0], ["ended", 1]]);
        });

        it("tracks the sound and emits sound; a missing value keeps the last one", () => {
            const {region, views} = withList();
            const sounds = [];
            region.on("sound", (event) => sounds.push([event.muted, event.volume]));

            views[0].emit({type: "sound", muted: true, volume: 0.5});
            views[0].emit({type: "sound", muted: false, volume: null});

            expect(region.muted).toBe(false);
            expect(region.volume).toBe(0.5);
            expect(sounds).toEqual([[true, 0.5], [false, 0.5]]);
        });

        it("forwards a view error as an error event", () => {
            const {region, views} = withList();
            const handler = vi.fn();
            region.on("error", handler);
            const error = new Error("player error");

            views[0].emit({type: "error", error});

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0][0].error).toBe(error);
            expect(handler.mock.calls[0][0].region).toBe(region);
        });

        it("sound and state are forgotten when the view changes", () => {
            const {region, views} = withList();
            region.add(single("a"));
            views[0].emit({type: "state", state: "playing"});
            views[0].emit({type: "sound", muted: true, volume: 0.2});

            region.navigate("fake:a");

            expect(region.playerState).toBeNull();
            expect(region.muted).toBeNull();
            expect(region.volume).toBeNull();
        });
    });

    describe("player commands", () => {
        const shown = () => {
            const context = makeRegion();
            context.region.add(single("a"));
            context.region.navigate("fake:a");
            return context;
        };

        it("do nothing without a view", () => {
            const {region} = makeRegion({attach: false});

            expect(() => {
                region.play();
                region.pause();
                region.seekTo(5);
                region.mute();
                region.unmute();
                region.toggleMute();
                region.setVolume(0.5);
            }).not.toThrow();
            expect(region.playerState).toBeNull();
        });

        it("play() / pause() ask the view and assume the state at once, once", () => {
            const {region, views} = shown();
            const states = [];
            region.on("state", (event) => states.push(event.state));

            region.play();
            region.play();
            region.pause();

            expect(views[0].named("play")).toHaveLength(2);
            expect(states).toEqual(["playing", "paused"]);
        });

        it("seekTo() plays by default", () => {
            const {region, views} = shown();

            region.seekTo(30);

            expect(views[0].named("seekTo")).toEqual([["seekTo", 30, {play: true}]]);
            expect(region.playerState).toBe("playing");
        });

        it("seekTo(..., {play: false}) does not assume playing", () => {
            const {region, views} = shown();

            region.seekTo(30, {play: false});

            expect(views[0].named("seekTo")).toEqual([["seekTo", 30, {play: false}]]);
            expect(region.playerState).toBeNull();
        });

        it("mute / unmute / toggleMute", () => {
            const {region, views} = shown();

            region.mute();
            region.unmute();
            region.toggleMute();                                    // muted is unknown (falsy): mute
            views[0].emit({type: "sound", muted: true, volume: 1});
            region.toggleMute();                                    // muted: unmute

            expect(views[0].calls.slice(1).map(([name]) => name)).toEqual(["mute", "unmute", "mute", "unmute"]);
        });

        it("setVolume() is clamped to 0..1", () => {
            const {region, views} = shown();

            region.setVolume(2);
            region.setVolume(-1);
            region.setVolume("abc");
            region.setVolume(0.4);

            expect(views[0].named("setVolume").map(([, volume]) => volume)).toEqual([1, 0, 0, 0.4]);
        });

        it("canMute follows the view", () => {
            const {region} = shown();

            expect(region.canMute).toBe(true);
        });
    });

    describe("visibility", () => {
        it("show() / hide() / toggle() act on the element", () => {
            const {region, element} = makeRegion();

            region.hide();
            expect(element.hidden).toBe(true);
            expect(region.isVisible).toBe(false);

            region.show();
            expect(region.isVisible).toBe(true);

            region.toggle();
            expect(region.isVisible).toBe(false);
            region.toggle();
            expect(region.isVisible).toBe(true);
        });

        it("hide() pauses the player", () => {
            const {region, views} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");
            const states = [];
            region.on("state", (event) => states.push(event.state));

            region.hide();

            expect(views[0].named("pause")).toHaveLength(1);
            expect(states).toEqual(["paused"]);
        });

        it("hide() does nothing without an element, and does not stop the navigation", () => {
            const {region} = makeRegion({attach: false});
            region.add(single("a"));

            region.hide();
            region.show();
            region.navigate("fake:a");

            expect(region.current.key).toBe("fake:a");
        });

        it("show() / hide() do not run the hooks nor emit change", () => {
            const {region} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");
            const hook = vi.fn();
            const change = vi.fn();
            region.afterNavigate(hook);
            region.on("change", change);

            region.hide();
            region.show();

            expect(hook).not.toHaveBeenCalled();
            expect(change).not.toHaveBeenCalled();
        });
    });

    describe("two-step life (the element comes after)", () => {
        it("navigate() without an element only moves the journal, and still emits change", () => {
            const {region, factory} = makeRegion({attach: false});
            region.add(single("a"));
            const changes = [];
            region.on("change", (event) => changes.push([event.reason, event.view]));

            region.navigate("fake:a");

            expect(factory.create).not.toHaveBeenCalled();
            expect(region.view).toBeNull();
            expect(region.current.key).toBe("fake:a");
            expect(changes).toEqual([["navigate", null]]);
        });

        it("attach() shows the CURRENT state only (not every navigation)", () => {
            const {region, factory, views, element} = makeRegion({attach: false});
            region.add(single("a"));
            region.add(single("b"));
            region.navigate("fake:a");
            region.navigate("fake:b");
            const reasons = [];
            region.on("change", (event) => reasons.push(event.reason));

            region.attach(element);

            expect(factory.create).toHaveBeenCalledTimes(1);
            expect(views[0].calls[0][1]).toBe("fake:b");
            expect(reasons).toEqual(["attach"]);
            expect(region.element).toBe(element);
        });

        it("attach() with an empty journal only binds the element", () => {
            const {region, factory, element} = makeRegion({attach: false});
            const changes = vi.fn();
            region.on("change", changes);

            region.attach(element);

            expect(region.element).toBe(element);
            expect(factory.create).not.toHaveBeenCalled();
            expect(changes).not.toHaveBeenCalled();
            expect(region.isVisible).toBe(true);
        });

        it("attaching the same element again does nothing", () => {
            const {region, factory, element} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");

            region.attach(element);

            expect(factory.create).toHaveBeenCalledTimes(1);
        });

        it("attaching another element detaches the first one", () => {
            const {region, views, element} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");
            const other = document.createElement("div");
            document.body.append(other);

            region.attach(other);

            expect(element.querySelector("iframe")).toBeNull();
            expect(other.querySelector("iframe")).toBe(views[1].root);
            expect(views[0].disposed).toBe(true);
        });

        it("keeps the autoplay requested before the element, for 2 seconds only", () => {
            const now = vi.spyOn(Date, "now").mockReturnValue(1000);
            const soon = makeRegion({attach: false});
            soon.region.add(single("a"));
            soon.region.navigate("fake:a", {autoplay: true});
            now.mockReturnValue(2500);
            soon.region.attach(soon.element);
            expect(soon.views[0].calls[0][2].autoplay).toBe(true);

            now.mockReturnValue(1000);
            const late = makeRegion({attach: false});
            late.region.add(single("a"));
            late.region.navigate("fake:a", {autoplay: true});
            now.mockReturnValue(4000);
            late.region.attach(late.element);
            expect(late.views[0].calls[0][2].autoplay).toBe(false);
        });

        it("detach() drops the view but keeps the state", () => {
            const {region, views, element} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");
            const reasons = [];
            region.afterNavigate((ctx) => reasons.push([ctx.reason, ctx.view]));

            region.detach();

            expect(region.element).toBeNull();
            expect(region.view).toBeNull();
            expect(region.current.key).toBe("fake:a");
            expect(element.querySelector("iframe")).toBeNull();
            expect(views[0].disposed).toBe(true);
            expect(reasons).toEqual([["detach", null]]);
        });

        it("detach() without an element does nothing", () => {
            const {region} = makeRegion({attach: false});
            const hook = vi.fn();
            region.afterNavigate(hook);

            region.detach();

            expect(hook).not.toHaveBeenCalled();
        });

        it("a new element shows the current state again", () => {
            const {region, factory} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");
            region.detach();
            const next = document.createElement("div");
            document.body.append(next);

            region.attach(next);

            expect(factory.create).toHaveBeenCalledTimes(2);
            expect(next.querySelector("iframe")).not.toBeNull();
        });
    });

    describe("adopt()", () => {
        function withIframe() {
            const context = makeRegion();
            const iframe = document.createElement("iframe");
            context.element.append(iframe);
            return {...context, iframe};
        }

        it("makes the iframe the current view, in place", () => {
            const {region, factory, views, element, iframe} = withIframe();
            const info = single("a");
            const changes = [];
            region.on("change", (event) => changes.push(event.reason));

            region.adopt(iframe, info);

            expect(factory.adopt).toHaveBeenCalledWith(iframe, info);
            expect(region.view).toBe(views[0]);
            expect(region.current).toBe(info);
            expect(region.has(info.key)).toBe(true);
            expect(iframe.parentElement).toBe(element);
            expect(changes).toEqual(["adopt"]);
        });

        it("throws when the iframe is not a child of the element, or there is no element", () => {
            const {region} = makeRegion();
            const stray = document.createElement("iframe");
            document.body.append(stray);
            expect(() => region.adopt(stray, single("a"))).toThrow(/must be a child of the region element/);

            const {region: bare} = makeRegion({attach: false});
            expect(() => bare.adopt(stray, single("a"))).toThrow(/must be a child of the region element/);
        });

        it("navigating to the adopted info reuses its view", () => {
            const {region, factory, views, iframe} = withIframe();
            const info = single("a");
            region.adopt(iframe, info);

            region.navigate(info.key, {autoplay: true});

            expect(factory.create).not.toHaveBeenCalled();
            expect(views[0].named("play")).toHaveLength(1);
        });

        it("navigating elsewhere replaces the adopted iframe by the new view, at the same place", () => {
            const {region, views, element, iframe} = withIframe();
            region.adopt(iframe, single("a"));
            region.add(single("b"));

            region.navigate("fake:b");

            expect(iframe.isConnected).toBe(false);
            expect(element.querySelectorAll("iframe")).toHaveLength(1);
            expect(element.querySelector("iframe")).toBe(views[1].root);
        });

        it("detach() leaves an adopted iframe where the page put it", () => {
            const {region, element, iframe} = withIframe();
            region.adopt(iframe, single("a"));

            region.detach();

            expect(iframe.parentElement).toBe(element);
        });
    });

    describe("hooks", () => {
        const shown = () => {
            const context = makeRegion();
            context.region.add(single("a"));
            context.region.add(single("b"));
            return context;
        };

        it("afterNavigate() runs after each navigation with the context and the previous one", () => {
            const {region} = shown();
            const calls = [];
            region.afterNavigate((ctx, from) => calls.push([ctx.reason, ctx.info.key, from?.info.key ?? null]));

            region.navigate("fake:a");
            region.navigate("fake:b");
            region.back();

            expect(calls).toEqual([
                ["navigate", "fake:a", null],
                ["navigate", "fake:b", "fake:a"],
                ["back", "fake:a", "fake:b"]
            ]);
        });

        it("the context is frozen and carries the active view", () => {
            const {region, views} = shown();
            let seen;
            region.afterNavigate((ctx) => { seen = ctx; });

            region.navigate("fake:a");

            expect(Object.isFrozen(seen)).toBe(true);
            expect(seen.view).toBe(views[0]);
            expect(seen.region).toBe(region);
        });

        it("{immediate: true} also runs it now for the current state", () => {
            const {region} = shown();
            region.navigate("fake:a");
            const reasons = [];

            region.afterNavigate((ctx) => reasons.push(ctx.reason), {immediate: true});

            expect(reasons).toEqual(["immediate"]);
        });

        it("{immediate: true} does nothing when nothing was navigated to", () => {
            const {region} = shown();
            const hook = vi.fn();

            region.afterNavigate(hook, {immediate: true});

            expect(hook).not.toHaveBeenCalled();
        });

        it("returns an unsubscribe function", () => {
            const {region} = shown();
            const hook = vi.fn();
            const off = region.afterNavigate(hook);

            off();
            region.navigate("fake:a");

            expect(hook).not.toHaveBeenCalled();
        });

        it("the same function registered twice runs once", () => {
            const {region} = shown();
            const hook = vi.fn();
            region.afterNavigate(hook);
            region.afterNavigate(hook);

            region.navigate("fake:a");

            expect(hook).toHaveBeenCalledTimes(1);
        });

        it("a failing hook is reported and does not stop the others", () => {
            const {region} = shown();
            const boom = new Error("boom");
            const bad = () => { throw boom; };
            const good = vi.fn();
            const errors = [];
            region.on("error", (event) => errors.push(event));
            region.afterNavigate(bad);
            region.afterNavigate(good);

            expect(() => region.navigate("fake:a")).not.toThrow();

            expect(good).toHaveBeenCalledTimes(1);
            expect(errors).toHaveLength(1);
            expect(errors[0].error).toBe(boom);
            expect(errors[0].hook).toBe(bad);
        });

        it("runs on item changes, attach and detach too", () => {
            const {region} = makeRegion({attach: false});
            region.add(list());
            const element = document.createElement("div");
            document.body.append(element);
            region.navigate("fake:list:x,y,z");
            const reasons = [];
            region.afterNavigate((ctx) => reasons.push(ctx.reason));

            region.attach(element);
            region.selectItem(1);
            region.detach();

            expect(reasons).toEqual(["attach", "item", "detach"]);
        });

        it("notify() runs the hooks but emits no change for meta / immediate", () => {
            const {region} = shown();
            region.navigate("fake:a");
            const reasons = [];
            const change = vi.fn();
            region.afterNavigate((ctx) => reasons.push(ctx.reason));
            region.on("change", change);

            region.notify("meta");
            region.notify();                                    // immediate by default

            expect(reasons).toEqual(["meta", "immediate"]);
            expect(change).not.toHaveBeenCalled();
        });

        it("notify() does nothing before any navigation", () => {
            const {region} = shown();
            const hook = vi.fn();
            region.afterNavigate(hook);

            region.notify("meta");

            expect(hook).not.toHaveBeenCalled();
        });
    });

    describe("behaviors and lifecycle", () => {
        it("use() attaches the behavior to the region and returns the region", () => {
            const {region} = makeRegion();
            const behavior = {attach: vi.fn(), dispose: vi.fn()};

            expect(region.use(behavior)).toBe(region);
            expect(behavior.attach).toHaveBeenCalledWith(region);
        });

        it("dispose() detaches, disposes the behaviors and clears hooks and events", () => {
            const {region, element} = makeRegion();
            region.add(single("a"));
            region.navigate("fake:a");
            const behavior = {attach: vi.fn(), dispose: vi.fn()};
            region.use(behavior);
            const hook = vi.fn();
            const handler = vi.fn();
            region.afterNavigate(hook);
            region.on("change", handler);

            region.dispose();
            hook.mockClear();
            handler.mockClear();
            region.notify("meta");

            expect(behavior.dispose).toHaveBeenCalledWith(region);
            expect(element.querySelector("iframe")).toBeNull();
            expect(hook).not.toHaveBeenCalled();
            expect(handler).not.toHaveBeenCalled();
        });

        it("on() returns an unsubscribe function, off() removes a handler", () => {
            const {region} = makeRegion();
            region.add(single("a"));
            const first = vi.fn();
            const second = vi.fn();
            const off = region.on("change", first);
            region.on("change", second);

            off();
            region.off("change", second);
            region.navigate("fake:a");

            expect(first).not.toHaveBeenCalled();
            expect(second).not.toHaveBeenCalled();
        });
    });

    describe("errors", () => {
        it("report() emits an error event with its context", () => {
            const {region} = makeRegion();
            const handler = vi.fn();
            region.on("error", handler);
            const error = new Error("x");

            region.report(error, {info: "the info"});

            expect(handler.mock.calls[0][0]).toMatchObject({type: "error", region, error, info: "the info"});
        });

        it("report() warns in the console when nobody listens", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const {region} = makeRegion();
            const error = new Error("x");

            region.report(error);

            expect(warn).toHaveBeenCalledWith("[Region main]", error);
        });

        it("a view that cannot be created is reported, navigate() does not throw", () => {
            const {region, factory} = makeRegion();
            region.add(single("a"));
            const errors = [];
            region.on("error", (event) => errors.push(event));
            factory.create.mockImplementationOnce(() => { throw new Error("no provider"); });

            expect(() => region.navigate("fake:a")).not.toThrow();

            expect(errors).toHaveLength(1);
            expect(errors[0].error.message).toBe("no provider");
            expect(region.view).toBeNull();
            expect(region.current.key).toBe("fake:a");           // the state moved anyway
        });

        it("a view that fails to load keeps the previous view", () => {
            const {region, factory, views} = makeRegion();
            const b = single("b");
            region.add(single("a"));
            region.add(b);
            region.navigate("fake:a");
            const errors = [];
            region.on("error", (event) => errors.push(event));
            factory.create.mockImplementationOnce(() => {
                const view = new FakeView();
                view.load = () => { throw new Error("boom"); };
                return view;
            });

            expect(() => region.navigate("fake:b")).not.toThrow();

            expect(errors).toHaveLength(1);
            expect(errors[0].error.message).toBe("boom");
            expect(errors[0].info).toBe(b);
            expect(region.view).toBe(views[0]);
            expect(views[0].disposed).toBe(false);
        });
    });
});
