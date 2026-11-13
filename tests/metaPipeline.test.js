import {afterEach, describe, expect, it, vi} from "vitest";
// Adjust these paths to your project
import {applyDefinition, applyItems, resolveDefinition} from "../src/metaMerge.js";
import {YouTubeMetaResolver} from "../src/providers/youtube/YouTubeMetaResolver.js";
import {VideoInfo} from "../src/models/VideoInfo.js";
import {VideoListInfo} from "../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../src/models/PlaylistInfo.js";
import {MemoryStore} from "../src/storage.js";

afterEach(() => vi.restoreAllMocks());

// ───────── builders ─────────

const video = (id, extra = {}) =>
    new VideoInfo({provider: "youtube", target: "#p", videoId: id, title: "", channel: "", thumbnail: "", ...extra});

const list = (ids, videos = ids.map((id) => video(id))) => {
    const l = new VideoListInfo({provider:"youtube", target:"#p", videoIds:ids});
    videos.forEach((v) => l.addVideo(v));
    return l;
};

const playlist = (id, videos = [], videoId = null) => {
    const p = new PlaylistInfo({provider:"youtube",target: "#p",playlistId: id, videoId});
    videos.forEach((v) => p.addVideo(v));
    return p;
};

/** What YouTubeDataApi gives for a video / a playlist entry. */
const meta = (n) => ({
    title: `T${n}`,
    description: `D${n}`,
    channel: `C${n}`,
    channelUrl: `https://www.youtube.com/channel/${n}`,
    thumbnail: `https://img.test/${n}.jpg`,
    duration: n * 10
});

function fakeApi({videos = {}, playlists = {}, available = true} = {}) {
    return {
        available,
        videos: vi.fn(async (ids) => new Map(ids.filter((id) => videos[id]).map((id) => [id, videos[id]]))),
        playlistItems: vi.fn(async (id) => playlists[id] ?? [])
    };
}

const titles = (items) => items.map((i) => i.title);
const ids = (items) => items.map((i) => i.id);

// ───────── applyItems ─────────

describe("applyItems", () => {
    it("replaces the videos in place: the info keeps its identity and its ids", () => {
        const l = list(["a", "b"]);
        const same = l;
        applyItems(l, [{title: "A"}, {title: "B"}]);
        expect(l).toBe(same);
        expect(l.videoIds).toEqual(["a", "b"]);
        expect(l.videos.map((v) => v.title)).toEqual(["A", "B"]);
    });

    it("a list gets its ids from the list: items are positional", () => {
        const l = list(["a", "b"], []);
        applyItems(l, [{title: "A"}, {title: "B"}]);
        expect(l.videos.map((v) => v.videoId)).toEqual(["a", "b"]);
    });

    it("an item fills the empty fields, all of them", () => {
        const l = list(["a"]);
        applyItems(l, [{id: "a", ...meta(1)}]);
        expect(l.videos[0]).toMatchObject(meta(1));
    });

    it("what is declared wins, field by field", () => {
        const l = list(["a"], [video("a", {title: "Mine", description: "Mine", duration: 5})]);
        applyItems(l, [{id: "a", ...meta(1)}]);
        expect(l.videos[0]).toMatchObject({
            title: "Mine",
            description: "Mine",
            duration: 5,
            channel: "C1", // empty: filled
            channelUrl: meta(1).channelUrl
        });
    });

    it("an existing video keeps what the item does not know: autoplay, start, key, extra, showOnInit", () => {
        const old = video("a", {autoplay: "click", startSeconds: 0, key: "mine", extra: {a: 1}, showOnInit: false});
        const l = list(["a"], [old]);
        applyItems(l, [{id: "a", ...meta(1), startSeconds: 30, key: "other", extra: {b: 2}, showOnInit: true}]);

        expect(l.videos[0]).toMatchObject({autoplay: "click", startSeconds: 0, key: "mine", extra: {a: 1}, showOnInit: false});
    });

    it("a field nobody knows stays unknown, it does not become an empty string", () => {
        const p = playlist("PL1");
        applyItems(p, [{id: "x1", title: "T"}]);
        const v = p.videos[0];

        expect(v.duration).toBeUndefined();
        expect(v.startSeconds).toBeUndefined();
        expect(v.extra).toBeNull();
        expect(v.key).toBe("youtube:x1"); // the default key, not ""
    });

    it("a new video can bring its own key, extra and showOnInit", () => {
        const p = playlist("PL1");
        applyItems(p, [{id: "x1", key: "mine", extra: {a: 1}, showOnInit: true, autoplay: "click", startSeconds: 30}]);
        expect(p.videos[0]).toMatchObject({key: "mine", extra: {a: 1}, showOnInit: true, autoplay: "click", startSeconds: 30});
    });

    it("texts are never undefined", () => {
        const p = playlist("PL1");
        applyItems(p, [{id: "x1"}]);
        expect(p.videos[0]).toMatchObject({title: "", description: "", channel: "", channelUrl: "", thumbnail: ""});
    });

    it("a playlist without ids gets placeholder ids, in order", () => {
        const p = playlist("PL1");
        applyItems(p, [{title: "A"}, {title: "B"}]);
        expect(p.videos.map((v) => v.videoId)).toEqual(["PL1#0", "PL1#1"]);
    });

    it("an item without any id is dropped when nothing can give it one", () => {
        const l = new VideoListInfo({provider:"youtube",target: "#p",videoIds: ["a"]});
        const fake = {...l, provider: "youtube", target: "#p", videos: [], videoIds: undefined, playlistId: undefined, setVideos: vi.fn()};
        applyItems(fake, [{title: "no id"}]);
        expect(fake.setVideos).toHaveBeenCalledWith([]);
    });

    it("the video that was declared for an id is found even when the order changed", () => {
        const l = list(["a", "b"], [video("a", {title: "A"}), video("b", {title: "B"})]);
        applyItems(l, [{id: "b", channel: "CB"}, {id: "a", channel: "CA"}]);
        expect(l.videos.map((v) => [v.videoId, v.title, v.channel])).toEqual([["b", "B", "CB"], ["a", "A", "CA"]]);
    });
});

describe("applyDefinition", () => {
    it("nothing to apply", () => {
        expect(applyDefinition(video("a"), null)).toBe(false);
        expect(applyDefinition(list(["a"]), {})).toBe(false);
        expect(applyDefinition(list(["a"]), {videos: []})).toBe(false);
    });

    it("a single video: fills the empty fields, and tells it", () => {
        const v = video("a");
        expect(applyDefinition(v, meta(1))).toBe(true);
        expect(v).toMatchObject(meta(1));
        expect(applyDefinition(v, meta(2))).toBe(false); // nothing empty any more
        expect(v.title).toBe("T1");
    });

    it("a list: applies the videos", () => {
        const l = list(["a", "b"]);
        expect(applyDefinition(l, {videos: [{title: "A"}, {title: "B"}]})).toBe(true);
        expect(l.videos.map((v) => v.title)).toEqual(["A", "B"]);
    });
});

describe("resolveDefinition", () => {
    const info = video("a");

    it("by the key of the info, yours or the default", () => {
        expect(resolveDefinition({"youtube:a": {title: "T"}}, info)).toEqual({title: "T"});
        expect(resolveDefinition({mine: {title: "T"}}, video("a", {key: "mine"}))).toEqual({title: "T"});
    });

    it("null when there is nothing", () => {
        expect(resolveDefinition({}, info)).toBeNull();
        expect(resolveDefinition(null, info)).toBeNull();
    });

    it("a function is asked", () => {
        expect(resolveDefinition((i) => ({title: i.key}), info)).toEqual({title: "youtube:a"});
        expect(resolveDefinition(() => undefined, info)).toBeNull();
    });
});

// ───────── YouTubeMetaResolver ─────────

describe("YouTubeMetaResolver.resolve", () => {
    describe("when there is nothing to do", () => {
        it("a single video, or another provider", async () => {
            const resolver = new YouTubeMetaResolver();
            expect(await resolver.resolve(video("a"))).toBeNull();

            const okru = new VideoListInfo({provider:"okru", target: "#p", videoIds: ["1"]});
            expect(await resolver.resolve(okru)).toBeNull();
        });

        it("every required field is known: the API is not called", async () => {
            const api = fakeApi();
            const l = list(["a", "b"], [video("a", {title: "A"}), video("b", {title: "B"})]);
            expect(await new YouTubeMetaResolver({api}).resolve(l)).toBeNull();
            expect(api.videos).not.toHaveBeenCalled();
        });

        it("a playlist without videos and without API has nothing to give", async () => {
            expect(await new YouTubeMetaResolver().resolve(playlist("PL1"))).toEqual([]);
        });
    });

    describe("without the API (no key, or refused)", () => {
        it("gives the fallback title to the items that have none", async () => {
            const items = await new YouTubeMetaResolver().resolve(list(["a", "b"]));
            expect(ids(items)).toEqual(["a", "b"]);
            expect(titles(items)).toEqual(["Video 1", "Video 2"]);
        });

        it("keeps the titles that are declared", async () => {
            const l = list(["a", "b"], [video("a", {title: "Mine"}), video("b")]);
            expect(titles(await new YouTubeMetaResolver().resolve(l))).toEqual(["Mine", "Video 2"]);
        });

        it("the fallback title is a function of the position", async () => {
            const resolver = new YouTubeMetaResolver({fallbackTitle: (i) => `Part ${i + 1}`});
            expect(titles(await resolver.resolve(list(["a", "b"])))).toEqual(["Part 1", "Part 2"]);
        });

        it("an API that is not available is not called", async () => {
            const api = fakeApi({available: false});
            await new YouTubeMetaResolver({api}).resolve(list(["a"]));
            expect(api.videos).not.toHaveBeenCalled();
        });
    });

    describe("a list of videos, with the API", () => {
        it("fills the empty fields, all of them, for every video", async () => {
            const api = fakeApi({videos: {a: meta(1), b: meta(2)}});
            const items = await new YouTubeMetaResolver({api}).resolve(list(["a", "b"]));

            expect(api.videos).toHaveBeenCalledWith(["a", "b"]);
            expect(items).toEqual([{id: "a", ...meta(1)}, {id: "b", ...meta(2)}]);
        });

        it("what is declared wins, the rest comes from the API", async () => {
            const api = fakeApi({videos: {a: meta(1), b: meta(2)}});
            const l = list(["a", "b"], [video("a", {title: "Mine", channel: "Mine"}), video("b")]);
            const [a, b] = await new YouTubeMetaResolver({api}).resolve(l);

            expect(a).toMatchObject({title: "Mine", channel: "Mine", description: "D1", duration: 10});
            expect(b.title).toBe("T2");
        });

        it("a video the API does not know keeps its place, with the fallback title", async () => {
            const api = fakeApi({videos: {a: meta(1)}});
            const items = await new YouTubeMetaResolver({api}).resolve(list(["a", "gone"]));
            expect(ids(items)).toEqual(["a", "gone"]);
            expect(titles(items)).toEqual(["T1", "Video 2"]);
        });

        it("a list with no video declared keeps every id, the API only knows some of them", async () => {
            const api = fakeApi({videos: {a: meta(1), c: meta(3)}});
            const items = await new YouTubeMetaResolver({api}).resolve(list(["a", "b", "c"], []));
            expect(ids(items)).toEqual(["a", "b", "c"]);
            expect(titles(items)).toEqual(["T1", "Video 2", "T3"]);
        });
    });

    describe("a playlist, with the API", () => {
        const entries = [{id: "x1", meta: meta(1)}, {id: "x2", meta: meta(2)}];

        it("gives what the API says, in order", async () => {
            const api = fakeApi({playlists: {PL1: entries}});
            const items = await new YouTubeMetaResolver({api}).resolve(playlist("PL1"));

            expect(api.playlistItems).toHaveBeenCalledWith("PL1");
            expect(ids(items)).toEqual(["x1", "x2"]);
            expect(titles(items)).toEqual(["T1", "T2"]);
        });

        it("keeps the videos that are declared, by id", async () => {
            const api = fakeApi({playlists: {PL1: entries}});
            const p = playlist("PL1", [video("x1", {title: "Mine"}), video("x2")]);
            expect(titles(await new YouTubeMetaResolver({api}).resolve(p))).toEqual(["Mine", "T2"]);
        });

        it("placeholder ids are matched by position, and replaced by the real ids", async () => {
            const api = fakeApi({playlists: {PL1: entries}});
            const p = playlist("PL1", [video("PL1#0"), video("PL1#1")]);
            const items = await new YouTubeMetaResolver({api}).resolve(p);

            expect(ids(items)).toEqual(["x1", "x2"]);
            expect(titles(items)).toEqual(["T1", "T2"]);
        });

        it("without the API, placeholders get the fallback titles", async () => {
            const p = playlist("PL1", [video("PL1#0"), video("PL1#1")]);
            const items = await new YouTubeMetaResolver().resolve(p);
            expect(ids(items)).toEqual(["PL1#0", "PL1#1"]);
            expect(titles(items)).toEqual(["Video 1", "Video 2"]);
        });
    });

    describe("required fields", () => {
        it("a missing description does not matter by default", async () => {
            const api = fakeApi({videos: {a: meta(1)}});
            const l = list(["a"], [video("a", {title: "A"})]);
            expect(await new YouTubeMetaResolver({api}).resolve(l)).toBeNull();
        });

        it("but it is asked for when it is required: everything empty is then filled", async () => {
            const api = fakeApi({videos: {a: meta(1)}});
            const l = list(["a"], [video("a", {title: "A"})]);
            const [item] = await new YouTubeMetaResolver({api, required: ["title", "description"]}).resolve(l);

            expect(item).toMatchObject({title: "A", description: "D1", duration: 10});
        });
    });

    describe("cache", () => {
        it("a video is asked once, even for another list", async () => {
            const api = fakeApi({videos: {a: meta(1), b: meta(2), c: meta(3)}});
            const resolver = new YouTubeMetaResolver({api, cache: new MemoryStore()});

            await resolver.resolve(list(["a", "b"]));
            const items = await resolver.resolve(list(["b", "c"]));

            expect(api.videos).toHaveBeenLastCalledWith(["c"]);
            expect(titles(items)).toEqual(["T2", "T3"]);
        });

        it("a playlist is asked once", async () => {
            const api = fakeApi({playlists: {PL1: [{id: "x1", meta: meta(1)}]}});
            const resolver = new YouTubeMetaResolver({api, cache: new MemoryStore()});

            await resolver.resolve(playlist("PL1"));
            const items = await resolver.resolve(playlist("PL1"));

            expect(api.playlistItems).toHaveBeenCalledTimes(1);
            expect(titles(items)).toEqual(["T1"]);
        });

        it("an empty playlist is not cached", async () => {
            const api = fakeApi();
            const resolver = new YouTubeMetaResolver({api, cache: new MemoryStore()});
            await resolver.resolve(playlist("PL1"));
            await resolver.resolve(playlist("PL1"));
            expect(api.playlistItems).toHaveBeenCalledTimes(2);
        });
    });

    describe("failures", () => {
        it("an API that fails gives the fallback titles, and never rejects", async () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            const api = fakeApi();
            api.videos.mockRejectedValue(new Error("quota"));

            const items = await new YouTubeMetaResolver({api}).resolve(list(["a", "b"]));
            expect(titles(items)).toEqual(["Video 1", "Video 2"]);
            expect(warn).toHaveBeenCalled();
        });
    });
});

// ───────── resolver -> applyItems ─────────

describe("the whole chain: resolve, then applyItems", () => {
    it("a list: the API fills the gaps, what is declared stays", async () => {
        const api = fakeApi({videos: {a: meta(1), b: meta(2)}});
        const l = list(["a", "b"], [video("a", {title: "Mine", thumbnail: "mine.jpg"}), video("b")]);

        applyItems(l, await new YouTubeMetaResolver({api}).resolve(l));

        expect(l.videos[0]).toMatchObject({videoId: "a", title: "Mine", thumbnail: "mine.jpg", description: "D1", channelUrl: meta(1).channelUrl, duration: 10});
        expect(l.videos[1]).toMatchObject({videoId: "b", title: "T2", thumbnail: meta(2).thumbnail, duration: 20});
        expect(l.videos.map((v) => v.key)).toEqual(["youtube:a", "youtube:b"]);
        expect(l.videos.map((v) => v.extra)).toEqual([null, null]);
    });

    it("a playlist defined by count (placeholders) gets the real ids and titles", async () => {
        const api = fakeApi({playlists: {PL1: [{id: "x1", meta: meta(1)}, {id: "x2", meta: meta(2)}]}});
        const p = playlist("PL1");
        applyItems(p, [{}, {}]); // what DefBuilder.playlist(...).videos(2) gives
        expect(p.videos.map((v) => v.videoId)).toEqual(["PL1#0", "PL1#1"]);

        applyItems(p, await new YouTubeMetaResolver({api}).resolve(p));
        expect(p.videos.map((v) => [v.videoId, v.title])).toEqual([["x1", "T1"], ["x2", "T2"]]);
    });

    it("without API, the fallback titles are stored in the videos", async () => {
        const l = list(["a", "b"]);
        applyItems(l, await new YouTubeMetaResolver().resolve(l));
        expect(l.videos.map((v) => v.title)).toEqual(["Video 1", "Video 2"]);
    });

    it("nothing to do: applying null is the caller's decision (the link player checks it)", async () => {
        const l = list(["a"], [video("a", {title: "A"})]);
        expect(await new YouTubeMetaResolver({api: fakeApi()}).resolve(l)).toBeNull();
    });
});