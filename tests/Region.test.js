// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {makeInfo, makePanel, makePlayer} from "./fixtures.js";
import {Region} from "../src/Region.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A region on a #t container, with fake providers / players / panel. Nothing real is created. */
function setup({listen = true, resolveMeta = null} = {}) {
    document.body.innerHTML = '<div id="t"></div>';
    const host = document.getElementById("t");
    const players = [];
    const providers = {};
    const provider = (id) =>
        (providers[id] ??= {
            id,
            createPlayer: vi.fn((options = {}) => {
                const player = makePlayer({kind: id, iframe: options.iframe});
                players.push(player);
                return player;
            })
        });
    const registry = {get: (id) => provider(id)};
    const panel = makePanel();
    const region = new Region({target: "t", registry, panelRenderer: panel, resolveMeta});
    const events = [];
    if (listen) region.on("*", (event) => events.push(event));
    return {region, host, players, panel, provider, events};
}

const single = (key, props = {}) => makeInfo({key, ...props});
const playlist = (key, props = {}) => makeInfo({key, isPlaylist: true, ...props});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

describe("construction", () => {
    it("throws when the target element does not exist", () => {
        document.body.innerHTML = "";
        expect(() => new Region({target: "nope", registry: {}, panelRenderer: makePanel()})).toThrow("Target #nope not found");
    });

    it("starts empty and visible", () => {
        const {region} = setup();
        expect(region.target).toBe("t");
        expect(region.infos).toEqual([]);
        expect(region.current).toBeNull();
        expect(region.currentIndex).toBe(0);
        expect(region.isVisible).toBe(true);
    });
});

describe("infos", () => {
    it("add returns true, then false for a key already known (the first one is kept)", () => {
        const {region} = setup();
        const first = single("a");
        expect(region.add(first)).toBe(true);
        expect(region.add(single("a"))).toBe(false);
        expect(region.get("a")).toBe(first);
        expect(region.infos).toHaveLength(1);
    });

    it("has / get", () => {
        const {region} = setup();
        region.add(single("a"));
        expect(region.has("a")).toBe(true);
        expect(region.has("b")).toBe(false);
        expect(region.get("b")).toBeUndefined();
    });

    it("infos keeps the order and is frozen", () => {
        const {region} = setup();
        region.add(single("b"));
        region.add(single("a"));
        expect(region.infos.map((i) => i.key)).toEqual(["b", "a"]);
        expect(() => region.infos.push(single("c"))).toThrow();
    });
});

describe("navigate", () => {
    it("loads the info in a player, puts its iframe in the target and announces it", () => {
        const {region, host, players, events, provider} = setup();
        const a = single("a");
        region.add(a);

        region.navigate(a, {autoplay: true, index: 2, params: {from: "grid"}});

        expect(provider("fake").createPlayer).toHaveBeenCalledTimes(1);
        expect(players[0].load).toHaveBeenCalledWith(a, {autoplay: true, index: 2});
        expect(host.firstChild).toBe(players[0].iframe);
        expect(host.hidden).toBe(false);
        expect(region.current).toBe(a);
        expect(region.currentIndex).toBe(2);

        const change = events.at(-1);
        expect(change).toMatchObject({type: "change", reason: "navigate", info: a, index: 2, params: {from: "grid"}, visible: true});
        expect(change.region).toBe(region);
    });

    it("defaults: no autoplay, index 0, no params", () => {
        const {region, players, events} = setup();
        const a = single("a");
        region.navigate(a);
        expect(players[0].load).toHaveBeenCalledWith(a, {autoplay: false, index: 0});
        expect(events.at(-1).params).toBeNull();
    });

    it("reuses the same player (one iframe per region) for the same provider", () => {
        const {region, players, provider} = setup();
        const a = single("a");
        const b = single("b");
        region.navigate(a);
        region.navigate(b);
        expect(provider("fake").createPlayer).toHaveBeenCalledTimes(1);
        expect(players[0].load).toHaveBeenCalledTimes(2);
        expect(players[0].dispose).not.toHaveBeenCalled();
    });

    it("replaces the player when the provider changes, and removes the old iframe", () => {
        const {region, host, players} = setup();
        region.navigate(single("a"));
        region.navigate(single("x", {provider: "other"}));

        expect(players).toHaveLength(2);
        expect(players[0].dispose).toHaveBeenCalled();
        expect(players[0].iframe.isConnected).toBe(false);
        expect(host.children).toHaveLength(1);
        expect(host.firstChild).toBe(players[1].iframe);
    });

    it("navigating to the info that is already current toggles the view instead", () => {
        const {region, host, players, events} = setup();
        const a = single("a");

        region.navigate(a);
        region.navigate(a);
        expect(host.hidden).toBe(true);
        expect(players[0].pause).toHaveBeenCalled();
        expect(players[0].load).toHaveBeenCalledTimes(1);
        expect(events.at(-1)).toMatchObject({reason: "visibility", visible: false});
        expect(region.canGoBack).toBe(false); // no new journal entry

        region.navigate(a);
        expect(host.hidden).toBe(false);
    });

    it("show / hide / toggle announce the visibility", () => {
        const {region, host, players, events} = setup();
        region.navigate(single("a"));

        region.hide();
        expect(host.hidden).toBe(true);
        expect(players[0].pause).toHaveBeenCalled();
        expect(events.at(-1)).toMatchObject({reason: "visibility", visible: false});

        region.show();
        expect(events.at(-1)).toMatchObject({reason: "visibility", visible: true});

        region.toggle();
        expect(host.hidden).toBe(true);
    });
});

describe("navigateByKey / replaceByKey", () => {
    it("navigateByKey navigates to the info with this key", () => {
        const {region, players} = setup();
        const a = single("a");
        region.add(a);
        region.navigateByKey("a", {autoplay: true});
        expect(region.current).toBe(a);
        expect(players[0].load).toHaveBeenCalledWith(a, {autoplay: true, index: 0});
    });

    it("replaceByKey replaces the current entry with the info of this key", () => {
        const {region} = setup();
        region.add(single("a"));
        region.add(single("b"));
        region.navigateByKey("a");
        region.replaceByKey("b");
        expect(region.current.key).toBe("b");
        expect(region.canGoBack).toBe(false);
    });

    it.each(["navigateByKey", "replaceByKey"])("%s throws for an unknown key", (method) => {
        const {region} = setup();
        expect(() => region[method]("nope")).toThrow("No info found for key 'nope'");
    });
});

describe("journal: back / forward / replace", () => {
    function threeSteps() {
        const ctx = setup();
        const [a, b, c] = ["a", "b", "c"].map((key) => single(key));
        ctx.region.navigate(a, {index: 1, params: {from: "first"}});
        ctx.region.navigate(b);
        ctx.region.navigate(c);
        return {...ctx, a, b, c};
    }

    it("goBack restores the previous state without playing, goForward goes back to it", () => {
        const {region, players, a, b, c} = threeSteps();

        expect(region.goBack()).toBe(true);
        expect(region.current).toBe(b);
        expect(players[0].load).toHaveBeenLastCalledWith(b, {autoplay: false, index: 0});
        expect(region.canGoForward).toBe(true);

        expect(region.goBack()).toBe(true);
        expect(region.current).toBe(a);
        expect(players[0].load).toHaveBeenLastCalledWith(a, {autoplay: false, index: 1}); // the index comes back too
        expect(region.goBack()).toBe(false);
        expect(region.canGoBack).toBe(false);

        expect(region.goForward()).toBe(true);
        expect(region.current).toBe(b);
        expect(region.goForward()).toBe(true);
        expect(region.goForward()).toBe(false);
        expect(region.current).toBe(c);
    });

    it("going back announces the state, with the params of that entry", () => {
        const {region, events} = threeSteps();
        region.goBack();
        region.goBack();
        expect(events.at(-1)).toMatchObject({reason: "back", params: {from: "first"}});
        region.goForward();
        expect(events.at(-1)).toMatchObject({reason: "forward", params: null});
    });

    it("navigating from the middle drops the forward history", () => {
        const {region, b} = threeSteps();
        region.goBack(); // on b
        region.navigate(single("d"));
        expect(region.canGoForward).toBe(false);
        expect(region.goBack()).toBe(true);
        expect(region.current).toBe(b);
    });

    it("replace shows another info in place of the current entry (no new entry)", () => {
        const {region, players, events} = setup();
        const a = single("a");
        const b = single("b");
        region.navigate(a);
        region.replace(b, {autoplay: true, params: {why: "redirect"}});

        expect(region.current).toBe(b);
        expect(region.canGoBack).toBe(false);
        expect(players[0].load).toHaveBeenLastCalledWith(b, {autoplay: true, index: 0});
        expect(events.at(-1)).toMatchObject({reason: "replace", info: b, params: {why: "redirect"}});
    });

    it("replace on an empty journal simply starts it", () => {
        const {region} = setup();
        region.replace(single("a"));
        expect(region.current.key).toBe("a");
        expect(region.canGoBack).toBe(false);
    });

    it("replace never toggles, even for the info that is already current", () => {
        const {region, host} = setup();
        const a = single("a");
        region.navigate(a);
        region.replace(a);
        expect(host.hidden).toBe(false);
    });
});

describe("navigation between infos", () => {
    function withThree() {
        const ctx = setup();
        const infos = ["a", "b", "c"].map((key) => single(key));
        infos.forEach((info) => ctx.region.add(info));
        return {...ctx, infos};
    }

    it("tells what can be done, from the first to the last info", () => {
        const {region, infos} = withThree();
        expect([region.canGoPreviousInfo, region.canGoNextInfo]).toEqual([false, true]); // nothing shown yet

        region.navigate(infos[0]);
        expect([region.canGoPreviousInfo, region.canGoNextInfo]).toEqual([false, true]);
        region.navigate(infos[1]);
        expect([region.canGoPreviousInfo, region.canGoNextInfo]).toEqual([true, true]);
        region.navigate(infos[2]);
        expect([region.canGoPreviousInfo, region.canGoNextInfo]).toEqual([true, false]);
    });

    it("nextInfo / previousInfo navigate with autoplay, and return false at the ends", () => {
        const {region, players, infos} = withThree();
        region.navigate(infos[2]);
        expect(region.nextInfo()).toBe(false);

        expect(region.previousInfo()).toBe(true);
        expect(region.current).toBe(infos[1]);
        expect(players[0].load).toHaveBeenLastCalledWith(infos[1], {autoplay: true, index: 0});

        region.previousInfo();
        expect(region.previousInfo()).toBe(false);
    });

    it("nextInfo starts with the first info when nothing is shown", () => {
        const {region, infos} = withThree();
        expect(region.nextInfo()).toBe(true);
        expect(region.current).toBe(infos[0]);
    });

    it("nothing to do without infos", () => {
        const {region} = setup();
        expect(region.canGoNextInfo).toBe(false);
        expect(region.nextInfo()).toBe(false);
    });
});

describe("items of a playlist", () => {
    it("a single video has no items", () => {
        const {region} = setup();
        region.navigate(single("a"));
        expect(region.itemCount).toBe(0);
        expect([region.canGoPreviousItem, region.canGoNextItem]).toEqual([false, false]);
    });

    it("a list of videos knows its length", () => {
        const {region} = setup();
        const list = playlist("l", {videoIds: ["a", "b", "c"]});

        region.navigate(list);
        expect(region.itemCount).toBe(3);
        expect([region.canGoPreviousItem, region.canGoNextItem]).toEqual([false, true]);

        region.replace(list, {index: 1});
        expect([region.canGoPreviousItem, region.canGoNextItem]).toEqual([true, true]);

        region.replace(list, {index: 2});
        expect([region.canGoPreviousItem, region.canGoNextItem]).toEqual([true, false]);
    });

    it("a playlist counts its known videos, and does not know its length when it has none", () => {
        const {region} = setup();
        region.navigate(playlist("p", {videos: [1, 2]}));
        expect(region.itemCount).toBe(2);

        region.navigate(playlist("q"));
        expect(region.itemCount).toBeNull();
        expect(region.canGoNextItem).toBe(true); // unknown: not disabled
    });

    it("nextItem / previousItem / playAt are the player's business", () => {
        const {region, players} = setup();
        region.navigate(playlist("l", {videoIds: ["a", "b"]}));

        region.nextItem();
        region.previousItem();
        expect(players[0].next).toHaveBeenCalledTimes(1);
        expect(players[0].previous).toHaveBeenCalledTimes(1);
    });

    it("playAt plays the item, keeps it in the journal and announces it", () => {
        const {region, players, panel, events} = setup();
        region.navigate(playlist("l", {videoIds: ["a", "b", "c"]}));
        region.playAt(2);

        expect(players[0].playAt).toHaveBeenCalledWith(2);
        expect(region.currentIndex).toBe(2);
        expect(panel.setCurrent).toHaveBeenCalledWith(2);
        expect(events.at(-1)).toMatchObject({reason: "item", index: 2});
    });
});

describe("events of the player", () => {
    it("itemChange: the journal, the panel and the listeners follow", () => {
        const {region, players, panel, events} = setup();
        region.navigate(playlist("l", {videoIds: ["a", "b", "c"]}));

        players[0].emit({type: "itemChange", index: 2});

        expect(region.currentIndex).toBe(2);
        expect(panel.setCurrent).toHaveBeenCalledWith(2);
        expect(events.at(-1)).toMatchObject({type: "change", reason: "item", index: 2});
    });

    it("state is forwarded, with the index of the player or the current one", () => {
        const {region, players, events} = setup();
        region.navigate(single("a"));

        players[0].emit({type: "state", state: "playing", index: 4});
        expect(events.at(-1)).toMatchObject({type: "state", state: "playing", index: 4});

        players[0].emit({type: "state", state: "paused"});
        expect(events.at(-1)).toMatchObject({type: "state", state: "paused", index: 0});
        expect(events.at(-1).region).toBe(region);
    });

    it("error: the failure is announced with the current info", () => {
        const {region, players, events} = setup();
        const a = single("a");
        region.navigate(a);
        const error = new Error("boom");

        players[0].emit({type: "error", error});
        expect(events.at(-1)).toMatchObject({type: "error", error, info: a});
    });
});

describe("panel", () => {
    it("a single video clears the panel", () => {
        const {region, panel} = setup();
        region.navigate(single("a"));
        expect(panel.clear).toHaveBeenCalled();
        expect(panel.render).not.toHaveBeenCalled();
    });

    it("a playlist draws the panel for this host, iframe and item", () => {
        const {region, panel, host, players} = setup();
        const list = playlist("l", {videoIds: ["a", "b"]});
        region.navigate(list, {index: 1});

        expect(panel.render).toHaveBeenCalledTimes(1);
        expect(panel.render).toHaveBeenCalledWith(
            expect.objectContaining({host, iframe: players[0].iframe, info: list, current: 1})
        );
    });

    it("choosing an item in the panel plays it", () => {
        const {region, panel, players} = setup();
        region.navigate(playlist("l", {videoIds: ["a", "b"]}));

        panel.render.mock.calls[0][0].onSelectItem(1);
        expect(players[0].playAt).toHaveBeenCalledWith(1);
    });

    it("the panel is not drawn again for the playlist it already shows", () => {
        const {region, panel} = setup();
        const list = playlist("l", {videoIds: ["a", "b", "c"]});
        region.navigate(list);
        region.replace(list, {index: 2});

        expect(panel.render).toHaveBeenCalledTimes(1);
        expect(panel.setCurrent).toHaveBeenCalledWith(2);
    });

    it("it is drawn again when coming back to a playlist after another info", () => {
        const {region, panel} = setup();
        const list = playlist("l", {videoIds: ["a"]});
        region.navigate(list);
        region.navigate(single("s"));
        region.navigate(list);
        expect(panel.render).toHaveBeenCalledTimes(2);
    });
});

describe("metadata of a playlist (resolveMeta)", () => {
    it("is asked once per playlist, never for a single video", () => {
        const resolveMeta = vi.fn().mockResolvedValue(false);
        const {region} = setup({resolveMeta});
        const list = playlist("l");

        region.navigate(single("s"));
        expect(resolveMeta).not.toHaveBeenCalled();

        region.navigate(list);
        region.navigate(single("s2"));
        region.navigate(list);
        expect(resolveMeta).toHaveBeenCalledTimes(1);
        expect(resolveMeta).toHaveBeenCalledWith(list);
    });

    it("draws the panel again when it completed something", async () => {
        const resolveMeta = vi.fn().mockResolvedValue(true);
        const {region, panel} = setup({resolveMeta});
        region.navigate(playlist("l"));

        await flush();
        expect(panel.render).toHaveBeenCalledTimes(2);
    });

    it("does nothing more when it changed nothing", async () => {
        const {region, panel} = setup({resolveMeta: vi.fn().mockResolvedValue(false)});
        region.navigate(playlist("l"));

        await flush();
        expect(panel.render).toHaveBeenCalledTimes(1);
    });

    it("does not draw the panel again when another info is shown by then", async () => {
        let settle;
        const resolveMeta = vi.fn(() => new Promise((resolve) => (settle = resolve)));
        const {region, panel} = setup({resolveMeta});
        region.navigate(playlist("l"));
        region.navigate(single("s"));

        settle(true);
        await flush();
        expect(panel.render).toHaveBeenCalledTimes(1);
    });

    it("announces the failure", async () => {
        const error = new Error("api down");
        const list = playlist("l");
        const {region, events} = setup({resolveMeta: vi.fn().mockRejectedValue(error)});
        region.navigate(list);

        await flush();
        expect(events.at(-1)).toMatchObject({type: "error", error, info: list});
    });
});

describe("failures", () => {
    it("a player that cannot be created is announced, not thrown", () => {
        const {region, provider, events} = setup();
        const a = single("a");
        const error = new Error("boom");
        provider("fake").createPlayer.mockImplementationOnce(() => {
            throw error;
        });

        expect(() => region.navigate(a)).not.toThrow();
        expect(events.map((e) => e.type)).toEqual(["error"]);
        expect(events[0]).toMatchObject({error, info: a});
    });

    it("a load that fails is announced, and nothing is announced as changed", () => {
        const {region, players, events} = setup();
        region.navigate(single("a"));
        const error = new Error("load failed");
        players[0].load.mockImplementationOnce(() => {
            throw error;
        });

        region.navigate(single("b"));
        expect(events.at(-1)).toMatchObject({type: "error", error});
        expect(events.filter((e) => e.type === "change")).toHaveLength(1);
    });

    it("without any listener the failure goes to the console", () => {
        const {region, provider} = setup({listen: false});
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        provider("fake").createPlayer.mockImplementationOnce(() => {
            throw new Error("boom");
        });

        region.navigate(single("a"));
        expect(spy).toHaveBeenCalled();
    });
});

describe("adopt (an iframe already in the page)", () => {
    function withIframe(ctx) {
        const iframe = document.createElement("iframe");
        ctx.host.append(iframe);
        return iframe;
    }

    it("the player takes over the iframe, nothing is loaded", () => {
        const ctx = setup();
        const iframe = withIframe(ctx);
        const a = single("a");

        ctx.region.adopt(iframe, a);

        expect(ctx.provider("fake").createPlayer).toHaveBeenCalledWith({iframe});
        expect(ctx.players[0].iframe).toBe(iframe);
        expect(ctx.players[0].load).not.toHaveBeenCalled();
        expect(ctx.region.current).toBe(a);
        expect(ctx.region.has("a")).toBe(true);
        expect(ctx.events.at(-1)).toMatchObject({type: "change", reason: "adopt", info: a});
    });

    it("a playlist gets its panel", () => {
        const ctx = setup();
        const iframe = withIframe(ctx);
        const list = playlist("l", {videoIds: ["a", "b"]});

        ctx.region.adopt(iframe, list);
        expect(ctx.panel.render).toHaveBeenCalledWith(expect.objectContaining({host: ctx.host, iframe, info: list}));
    });

    it("the iframe must be inside the target", () => {
        const {region} = setup();
        expect(() => region.adopt(document.createElement("iframe"), single("a"))).toThrow("The iframe is not inside #t");
    });

    it("an info already added is not an error", () => {
        const ctx = setup();
        const a = single("a");
        ctx.region.add(a);
        expect(() => ctx.region.adopt(withIframe(ctx), a)).not.toThrow();
    });
});

describe("dispose", () => {
    it("disposes the player and the panel, and stops announcing", () => {
        const {region, players, panel, events} = setup();
        region.navigate(single("a"));
        const count = events.length;

        region.dispose();
        expect(players[0].dispose).toHaveBeenCalled();
        expect(panel.destroy).toHaveBeenCalled();

        region.show();
        expect(events).toHaveLength(count);
    });
});