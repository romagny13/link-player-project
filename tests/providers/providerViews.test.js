// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";

import {YouTubeView} from "../../src/providers/youtube/YouTubeView.js";
import {YouTubeEmbedSrcBuilder} from "../../src/providers/youtube/YouTubeEmbedSrcBuilder.js";
import {OkruView} from "../../src/providers/okru/OkruView.js";
import {OkruEmbedSrcBuilder} from "../../src/providers/okru/OkruEmbedSrcBuilder.js";
import {VideoInfo} from "../../src/models/VideoInfo.js";
import {VideoListInfo} from "../../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../../src/models/PlaylistInfo.js";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const ORIGIN = "http://localhost:3000";
const YT_A = "AAAAAAAAAAA";
const YT_B = "BBBBBBBBBBB";
const YT_C = "CCCCCCCCCCC";

/** Lets jsdom fire the `load` event of an iframe that was just appended. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Simulates a message posted by the player inside `iframe`. */
const fromPlayer = (iframe, payload) =>
    window.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify(payload),
        source: iframe.contentWindow
    }));

const makeIframe = (src) => {
    const iframe = document.createElement("iframe");
    iframe.src = src;
    return iframe;
};

const created = [];   // views to dispose after each test

afterEach(() => {
    created.splice(0).forEach((view) => view.dispose());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* YouTubeView                                                         */
/* ------------------------------------------------------------------ */

describe("YouTubeView", () => {
    const video = (o = {}) => new VideoInfo({provider: "youtube", target: "t", videoId: YT_A, ...o});
    const list = (o = {}) => new VideoListInfo({provider: "youtube", target: "t", videoIds: [YT_A, YT_B, YT_C], ...o});
    const playlist = (o = {}) => new PlaylistInfo({provider: "youtube", target: "t", playlistId: "PL1", ...o});

    const builder = () => new YouTubeEmbedSrcBuilder({enablejsapi: true, origin: ORIGIN});

    /** Creates the view, loads `info`, mounts the iframe and spies on what is sent to the player. */
    async function setup({info = video(), autoplay = false, index = 0} = {}) {
        const createIframe = vi.fn(makeIframe);
        const view = new YouTubeView({builder: builder(), createIframe});
        created.push(view);
        const events = [];
        view.subscribe((e) => events.push(e));

        view.load(info, {autoplay, index});
        document.body.append(view.root);
        await settle();

        const post = vi.spyOn(view.root.contentWindow, "postMessage");
        const iframe = view.root;
        const commands = () => post.mock.calls
            .map(([message]) => JSON.parse(message))
            .filter((m) => m.event === "command")
            .map(({func, args}) => ({func, args}));
        const ready = () => fromPlayer(iframe, {event: "onReady"});

        return {view, createIframe, events, iframe, commands, ready};
    }

    describe("first load", () => {
        it("creates one owned iframe with the JS API enabled", async () => {
            const {view, createIframe, iframe} = await setup();

            expect(createIframe).toHaveBeenCalledTimes(1);
            expect(view.owned).toBe(true);
            expect(view.kind).toBe("youtube");
            expect(view.canMute).toBe(true);

            const url = new URL(iframe.src);
            expect(url.pathname).toBe(`/embed/${YT_A}`);
            expect(url.searchParams.get("enablejsapi")).toBe("1");
            expect(url.searchParams.get("origin")).toBe(ORIGIN);
            expect(url.searchParams.has("autoplay")).toBe(false);
        });

        it("puts autoplay, mute and start in the src", async () => {
            const {iframe} = await setup({
                info: video({mute: true, startSeconds: 42}),
                autoplay: true
            });

            const url = new URL(iframe.src);
            expect(url.searchParams.get("autoplay")).toBe("1");
            expect(url.searchParams.get("mute")).toBe("1");
            expect(url.searchParams.get("start")).toBe("42");
        });

        it("builds a video list src with `playlist`", async () => {
            const {iframe} = await setup({info: list()});

            const url = new URL(iframe.src);
            expect(url.pathname).toBe(`/embed/${YT_A}`);
            expect(url.searchParams.get("playlist")).toBe(`${YT_A},${YT_B},${YT_C}`);
        });

        it("builds a playlist src with `list` (videoseries without a start video)", async () => {
            const {iframe} = await setup({info: playlist()});

            const url = new URL(iframe.src);
            expect(url.pathname).toBe("/embed/videoseries");
            expect(url.searchParams.get("list")).toBe("PL1");
        });

        it("queues a playlist command when starting above index 0 (list)", async () => {
            const {commands, ready} = await setup({info: list(), index: 2});
            expect(commands()).toEqual([]);              // not ready yet: queued

            ready();
            expect(commands()).toEqual([
                {func: "cuePlaylist", args: [[YT_A, YT_B, YT_C], 2, 0]}
            ]);
        });

        it("uses loadPlaylist instead of cuePlaylist with autoplay (playlist)", async () => {
            const {commands, ready} = await setup({info: playlist(), index: 3, autoplay: true});

            ready();
            expect(commands()).toEqual([
                {func: "loadPlaylist", args: [{list: "PL1", listType: "playlist", index: 3, startSeconds: 0}]}
            ]);
        });

        it("rejects something that is not a VideoInfo / VideoListInfo / PlaylistInfo on a loaded view", async () => {
            const {view} = await setup();
            expect(() => view.load({})).toThrow(/VideoInfo, VideoListInfo or PlaylistInfo expected/);
        });
    });

    describe("loading another info in the same view", () => {
        it("keeps the iframe and sends cueVideoById / loadVideoById", async () => {
            const {view, createIframe, iframe, commands, ready} = await setup();
            ready();

            view.load(video({videoId: YT_B, startSeconds: 10}));
            view.load(video({videoId: YT_C}), {autoplay: true});

            expect(createIframe).toHaveBeenCalledTimes(1);
            expect(view.root).toBe(iframe);
            expect(commands()).toEqual([
                {func: "cueVideoById", args: [YT_B, 10]},
                {func: "loadVideoById", args: [YT_C, 0]}
            ]);
        });

        it("loads a list or a playlist with a command", async () => {
            const {view, commands, ready} = await setup();
            ready();

            view.load(list(), {autoplay: true, index: 1});
            view.load(playlist({videoId: YT_B}), {autoplay: false});

            expect(commands()).toEqual([
                {func: "loadPlaylist", args: [[YT_A, YT_B, YT_C], 1, 0]},
                {func: "cuePlaylist", args: [{list: "PL1", listType: "playlist", index: 0, startSeconds: 0}]}
            ]);
        });

        it("mutes the player when the new info is muted", async () => {
            const {view, commands, ready} = await setup();
            ready();

            view.load(video({videoId: YT_B, mute: true}));

            expect(commands().map((c) => c.func)).toEqual(["cueVideoById", "mute"]);
        });
    });

    describe("commands", () => {
        it("queues commands until the player is ready, then flushes them in order", async () => {
            const {view, commands, ready} = await setup();

            view.play();
            view.pause();
            expect(commands()).toEqual([]);

            ready();
            expect(commands()).toEqual([
                {func: "playVideo", args: []},
                {func: "pauseVideo", args: []}
            ]);
        });

        it("sends the playback commands", async () => {
            const {view, commands, ready} = await setup({info: list()});
            ready();

            view.play();
            view.pause();
            view.next();
            view.previous();
            view.playAt(2);

            expect(commands()).toEqual([
                {func: "playVideo", args: []},
                {func: "pauseVideo", args: []},
                {func: "nextVideo", args: []},
                {func: "previousVideo", args: []},
                {func: "playVideoAt", args: [2]}
            ]);
        });

        it("seekTo seeks, and plays unless told otherwise", async () => {
            const {view, commands, ready} = await setup();
            ready();

            view.seekTo(30);
            view.seekTo(60, {play: false});

            expect(commands()).toEqual([
                {func: "seekTo", args: [30, true]},
                {func: "playVideo", args: []},
                {func: "seekTo", args: [60, true]}
            ]);
        });

        it("controls the sound (volume 0..1 becomes 0..100)", async () => {
            const {view, commands, ready} = await setup();
            ready();

            view.mute();
            view.unmute();
            view.setVolume(0.35);

            expect(commands()).toEqual([
                {func: "mute", args: []},
                {func: "unMute", args: []},
                {func: "setVolume", args: [35]}
            ]);
        });

        it("selectItem plays the item when autoplay is on", async () => {
            const {view, commands, ready} = await setup({info: list()});
            ready();

            view.selectItem(list(), 1, {autoplay: true});

            expect(commands()).toEqual([{func: "playVideoAt", args: [1]}]);
        });

        it("selectItem only cues the item without autoplay", async () => {
            const {view, commands, ready} = await setup();
            ready();

            const l = list();
            const p = playlist();
            view.selectItem(l, 2, {autoplay: false});
            view.selectItem(p, 4, {autoplay: false});

            expect(commands()).toEqual([
                {func: "cuePlaylist", args: [[YT_A, YT_B, YT_C], 2, 0]},
                {func: "cuePlaylist", args: [{list: "PL1", listType: "playlist", index: 4, startSeconds: 0}]}
            ]);
        });
    });

    describe("events", () => {
        it("emits itemChange when the player moves to another item", async () => {
            const {events, iframe} = await setup({info: list()});

            fromPlayer(iframe, {event: "infoDelivery", info: {playlistIndex: 2}});
            fromPlayer(iframe, {event: "infoDelivery", info: {playlistIndex: 2}});   // same index: ignored

            expect(events.filter((e) => e.type === "itemChange")).toEqual([{type: "itemChange", index: 2}]);
        });

        it("emits playing / paused / ended", async () => {
            const {events, iframe} = await setup();

            fromPlayer(iframe, {event: "onStateChange", info: 1});
            fromPlayer(iframe, {event: "onStateChange", info: 2});
            fromPlayer(iframe, {event: "onStateChange", info: 0});

            expect(events.filter((e) => e.type === "state").map((e) => e.state))
                .toEqual(["playing", "paused", "ended"]);
        });

        it("does not repeat the same state", async () => {
            const {events, iframe} = await setup();

            fromPlayer(iframe, {event: "onStateChange", info: 1});
            fromPlayer(iframe, {event: "onStateChange", info: 1});

            expect(events.filter((e) => e.type === "state")).toHaveLength(1);
        });

        it("emits sound with muted and a 0..1 volume", async () => {
            const {events, iframe} = await setup();

            fromPlayer(iframe, {event: "infoDelivery", info: {volume: 50, muted: true}});

            expect(events.filter((e) => e.type === "sound"))
                .toContainEqual({type: "sound", muted: true, volume: 0.5});
        });

        it("emits an error with the player error code", async () => {
            const {events, iframe} = await setup();

            fromPlayer(iframe, {event: "onError", info: 150});

            const error = events.find((e) => e.type === "error");
            expect(error.error).toBeInstanceOf(Error);
            expect(error.error.message).toBe("YouTube player error 150");
        });

        it("ignores messages that do not come from its iframe", async () => {
            const {events} = await setup();
            const other = document.createElement("iframe");
            document.body.append(other);

            fromPlayer(other, {event: "onStateChange", info: 1});

            expect(events).toEqual([]);
        });

        it("subscribe returns an unsubscribe function", async () => {
            const {view, iframe} = await setup();
            const listener = vi.fn();
            const off = view.subscribe(listener);

            off();
            fromPlayer(iframe, {event: "onStateChange", info: 1});

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe("adopting an existing iframe", () => {
        it("does not own the iframe and reloads it once with enablejsapi and origin", () => {
            const iframe = makeIframe(`https://www.youtube.com/embed/${YT_A}`);
            document.body.append(iframe);

            const view = new YouTubeView({builder: builder(), iframe});
            created.push(view);

            expect(view.root).toBe(iframe);
            expect(view.owned).toBe(false);
            const url = new URL(iframe.src);
            expect(url.searchParams.get("enablejsapi")).toBe("1");
            expect(url.searchParams.get("origin")).toBe(ORIGIN);
        });

        it("leaves the src alone when it already has enablejsapi and origin", () => {
            const src = `https://www.youtube.com/embed/${YT_A}?enablejsapi=1&origin=${encodeURIComponent(ORIGIN)}`;
            const iframe = makeIframe(src);
            document.body.append(iframe);

            created.push(new YouTubeView({builder: builder(), iframe}));

            expect(iframe.src).toBe(src);
        });

        it("keeps the other parameters of the adopted src (mute=1...)", () => {
            const iframe = makeIframe(`https://www.youtube.com/embed/${YT_A}?mute=1`);
            document.body.append(iframe);

            created.push(new YouTubeView({builder: builder(), iframe}));

            expect(new URL(iframe.src).searchParams.get("mute")).toBe("1");
        });

        it("drives the adopted iframe with commands, never creating another one", async () => {
            const iframe = makeIframe(`https://www.youtube.com/embed/${YT_A}`);
            document.body.append(iframe);
            const createIframe = vi.fn(makeIframe);
            const view = new YouTubeView({builder: builder(), createIframe, iframe});
            created.push(view);
            await settle();
            const post = vi.spyOn(iframe.contentWindow, "postMessage");

            fromPlayer(iframe, {event: "onReady"});
            view.load(video({videoId: YT_B}), {autoplay: true});

            expect(createIframe).not.toHaveBeenCalled();
            const sent = post.mock.calls.map(([m]) => JSON.parse(m)).filter((m) => m.event === "command");
            expect(sent).toEqual([{event: "command", func: "loadVideoById", args: [YT_B, 0]}]);
        });
    });

    describe("dispose", () => {
        it("releases the root, stops listening and turns the commands into no-ops", async () => {
            const {view, events, iframe, commands, ready} = await setup();
            ready();

            view.dispose();

            expect(view.root).toBeNull();
            expect(() => view.play()).not.toThrow();
            expect(commands()).toEqual([]);

            fromPlayer(iframe, {event: "onStateChange", info: 1});
            expect(events).toEqual([]);
        });
    });
});

/* ------------------------------------------------------------------ */
/* OkruView                                                            */
/* ------------------------------------------------------------------ */

describe("OkruView", () => {
    const video = (o = {}) => new VideoInfo({provider: "okru", target: "t", videoId: "111", ...o});
    const list = (o = {}) => new VideoListInfo({provider: "okru", target: "t", videoIds: ["111", "222", "333"], ...o});

    /** Creates the view, loads `info`, mounts the iframe and spies on what is sent to the player. */
    async function setup({info = video(), autoplay = false, index = 0, urlBuilder = new OkruEmbedSrcBuilder()} = {}) {
        const createIframe = vi.fn(makeIframe);
        const view = new OkruView({urlBuilder, createIframe});
        created.push(view);
        const events = [];
        view.subscribe((e) => events.push(e));

        view.load(info, {autoplay, index});
        document.body.append(view.root);
        await settle();

        const iframe = view.root;
        const post = vi.spyOn(iframe.contentWindow, "postMessage");
        const commands = () => post.mock.calls
            .map(([message]) => JSON.parse(message))
            .map(({method, args}) => ({method, args}));
        // Ok.ru has no "ready" message: the first message of the player marks it as ready.
        const ready = () => fromPlayer(iframe, {event: "started"});
        const srcUrl = () => new URL(view.root.src);

        return {view, createIframe, events, iframe, commands, ready, srcUrl};
    }

    describe("loading", () => {
        it("creates one owned iframe on the embed url", async () => {
            const {view, createIframe, srcUrl} = await setup();

            expect(createIframe).toHaveBeenCalledTimes(1);
            expect(view.owned).toBe(true);
            expect(view.kind).toBe("okru");
            expect(srcUrl().origin + srcUrl().pathname).toBe("https://ok.ru/videoembed/111");
            expect(srcUrl().searchParams.has("autoplay")).toBe(false);
        });

        it("adds autoplay and the start time", async () => {
            const {srcUrl} = await setup({info: video({startSeconds: 90}), autoplay: true});

            expect(srcUrl().searchParams.get("autoplay")).toBe("1");
            expect(srcUrl().searchParams.get("fromTime")).toBe("90");
        });

        it("starts at the requested index of a list, with the start time of that item", async () => {
            const l = list();
            l.setVideos([
                video({videoId: "111"}),
                video({videoId: "222", startSeconds: 30}),
                video({videoId: "333"})
            ]);

            const {srcUrl} = await setup({info: l, index: 1, autoplay: true});

            expect(srcUrl().pathname).toBe("/videoembed/222");
            expect(srcUrl().searchParams.get("fromTime")).toBe("30");
            expect(srcUrl().searchParams.get("autoplay")).toBe("1");
        });

        it("loading another info changes the src of the same iframe (no new iframe)", async () => {
            const {view, createIframe, iframe, srcUrl} = await setup();

            view.load(video({videoId: "999"}), {autoplay: true});

            expect(createIframe).toHaveBeenCalledTimes(1);
            expect(view.root).toBe(iframe);
            expect(srcUrl().pathname).toBe("/videoembed/999");
            expect(srcUrl().searchParams.get("autoplay")).toBe("1");
        });

        it("uses the relay when the builder has one", async () => {
            const urlBuilder = new OkruEmbedSrcBuilder({
                relayBaseUrl: "https://relay.test/player.html",
                parentOrigin: ORIGIN
            });

            const {srcUrl} = await setup({info: video({startSeconds: 5}), autoplay: true, urlBuilder});

            expect(srcUrl().origin + srcUrl().pathname).toBe("https://relay.test/player.html");
            expect(srcUrl().searchParams.get("videoId")).toBe("111");
            expect(srcUrl().searchParams.get("autoplay")).toBe("1");
            expect(srcUrl().searchParams.get("startSeconds")).toBe("5");
            expect(srcUrl().searchParams.get("parentOrigin")).toBe(ORIGIN);
        });

        it("throws when there is no iframe to adopt and no createIframe", () => {
            const view = new OkruView({urlBuilder: new OkruEmbedSrcBuilder()});
            created.push(view);

            expect(() => view.load(video())).toThrow(/createIframe is required/);
        });
    });

    describe("items (a list is emulated by the view)", () => {
        it("a single video has no items: no itemChange", async () => {
            const {events} = await setup();

            expect(events.filter((e) => e.type === "itemChange")).toEqual([]);
        });

        it("a list announces the item it starts on", async () => {
            const {events} = await setup({info: list(), index: 1});

            expect(events.filter((e) => e.type === "itemChange")).toEqual([{type: "itemChange", index: 1}]);
        });

        it("next / previous / playAt change the src with autoplay and announce the item", async () => {
            const {view, events, srcUrl} = await setup({info: list()});
            events.length = 0;

            view.next();
            expect(srcUrl().pathname).toBe("/videoembed/222");
            expect(srcUrl().searchParams.get("autoplay")).toBe("1");

            view.playAt(2);
            expect(srcUrl().pathname).toBe("/videoembed/333");

            view.previous();
            expect(srcUrl().pathname).toBe("/videoembed/222");

            expect(events.filter((e) => e.type === "itemChange").map((e) => e.index)).toEqual([1, 2, 1]);
        });

        it("ignores a move outside the list", async () => {
            const {view, events, srcUrl} = await setup({info: list()});
            events.length = 0;

            view.previous();          // before the first
            view.playAt(7);           // after the last

            expect(srcUrl().pathname).toBe("/videoembed/111");
            expect(events).toEqual([]);
        });

        it("goes to the next video when one ends", async () => {
            const {events, iframe, srcUrl} = await setup({info: list()});
            events.length = 0;

            fromPlayer(iframe, {event: "ended"});

            expect(events).toEqual([
                {type: "state", state: "ended", index: 0},
                {type: "itemChange", index: 1}
            ]);
            expect(srcUrl().pathname).toBe("/videoembed/222");
            expect(srcUrl().searchParams.get("autoplay")).toBe("1");
        });

        it("does not go further after the last video, nor after a single video", async () => {
            const last = await setup({info: list(), index: 2});
            last.events.length = 0;
            fromPlayer(last.iframe, {event: "ended"});
            expect(last.events).toEqual([{type: "state", state: "ended", index: 2}]);
            expect(last.srcUrl().pathname).toBe("/videoembed/333");

            const single = await setup();
            single.events.length = 0;
            fromPlayer(single.iframe, {event: "ended"});
            expect(single.events).toEqual([{type: "state", state: "ended", index: 0}]);
        });

        it("seekTo reloads the current item at that time", async () => {
            const {view, srcUrl} = await setup({info: list(), index: 1});

            view.seekTo(120);
            expect(srcUrl().pathname).toBe("/videoembed/222");
            expect(srcUrl().searchParams.get("fromTime")).toBe("120");
            expect(srcUrl().searchParams.get("autoplay")).toBe("1");

            view.seekTo(60, {play: false});
            expect(srcUrl().searchParams.get("fromTime")).toBe("60");
            expect(srcUrl().searchParams.has("autoplay")).toBe(false);
        });
    });

    describe("commands", () => {
        it("queues play / pause until the player has sent a message, then flushes them", async () => {
            const {view, commands, ready} = await setup();

            view.play();
            view.pause();
            expect(commands()).toEqual([]);

            ready();
            expect(commands()).toEqual([
                {method: "play", args: null},
                {method: "pause", args: null}
            ]);
        });

        it("sends immediately once ready", async () => {
            const {view, commands, ready} = await setup();
            ready();

            view.pause();

            expect(commands()).toEqual([{method: "pause", args: null}]);
        });

        it("cannot be muted (no known way), and the sound commands do nothing", async () => {
            const {view, commands, ready} = await setup();
            ready();

            // The docs say `canMute` is false; the current builder has no `supportsMute`, so it is undefined.
            expect(view.canMute).toBeFalsy();

            view.mute();
            view.unmute();
            view.setVolume(0.5);

            expect(commands()).toEqual([]);
        });
    });

    describe("events", () => {
        it("emits playing / paused with the index of the item", async () => {
            const {events, iframe} = await setup({info: list(), index: 1});
            events.length = 0;

            fromPlayer(iframe, {event: "started"});
            fromPlayer(iframe, {event: "paused"});
            fromPlayer(iframe, {event: "resumed"});

            expect(events).toEqual([
                {type: "state", state: "playing", index: 1},
                {type: "state", state: "paused", index: 1},
                {type: "state", state: "playing", index: 1}
            ]);
        });

        it("emits sound for mute / unmute messages", async () => {
            const {events, iframe} = await setup();

            fromPlayer(iframe, {event: "mute"});
            fromPlayer(iframe, {event: "unmute"});

            expect(events.filter((e) => e.type === "sound")).toEqual([
                {type: "sound", muted: true, volume: null},
                {type: "sound", muted: false, volume: null}
            ]);
        });

        it("emits sound for volumechange (0..1 volume, kept as is)", async () => {
            const {events, iframe} = await setup();

            fromPlayer(iframe, {event: "volumechange", volume: 0.5, muted: false});

            expect(events.filter((e) => e.type === "sound"))
                .toContainEqual({type: "sound", muted: false, volume: 0.5});
        });

        it("emits an error with the message of the player", async () => {
            const {events, iframe} = await setup();

            fromPlayer(iframe, {event: "error", message: "boom"});

            const error = events.find((e) => e.type === "error");
            expect(error.error).toBeInstanceOf(Error);
            expect(error.error.message).toBe("boom");
        });

        it("ignores messages that do not come from its iframe", async () => {
            const {events} = await setup();
            const other = document.createElement("iframe");
            document.body.append(other);

            fromPlayer(other, {event: "started"});

            expect(events).toEqual([]);
        });
    });

    describe("adopting an existing iframe", () => {
        it("does not own the iframe, and does not touch its src until a load", async () => {
            const src = "https://ok.ru/videoembed/111";
            const iframe = makeIframe(src);
            document.body.append(iframe);

            const view = new OkruView({urlBuilder: new OkruEmbedSrcBuilder(), iframe});
            created.push(view);

            expect(view.root).toBe(iframe);
            expect(view.owned).toBe(false);
            expect(iframe.src).toBe(src);
        });

        it("changes the src of the adopted iframe on load", () => {
            const iframe = makeIframe("https://ok.ru/videoembed/111");
            document.body.append(iframe);
            const view = new OkruView({urlBuilder: new OkruEmbedSrcBuilder(), iframe});
            created.push(view);

            view.load(video({videoId: "222"}), {autoplay: true});

            const url = new URL(iframe.src);
            expect(url.pathname).toBe("/videoembed/222");
            expect(url.searchParams.get("autoplay")).toBe("1");
        });
    });

    describe("dispose", () => {
        it("releases the root, stops listening and turns the commands into no-ops", async () => {
            const {view, events, iframe, commands, ready} = await setup();
            ready();
            events.length = 0;

            view.dispose();

            expect(view.root).toBeNull();
            expect(() => view.play()).not.toThrow();
            expect(commands()).toEqual([]);

            fromPlayer(iframe, {event: "started"});
            expect(events).toEqual([]);
        });
    });
});
