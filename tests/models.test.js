import {describe, expect, it} from "vitest";
import {VideoInfo} from "../src/models/VideoInfo.js";
import {VideoListInfo} from "../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../src/models/PlaylistInfo.js";
import {UrlInfo} from "../src/models/UrlInfo.js";
import {YouTubeThumbnailUrlBuilder} from "../src/providers/youtube/YouTubeThumbnailUrlBuilder.js";

const base = {provider: "youtube", target: "t-1", videoId: "abc"};

describe("VideoInfo", () => {
    it("exposes its values and key", () => {
        const v = new VideoInfo({...base, autoplay: "click", startSeconds: 5, title: "T", channel: "C", thumbnail: "u", showOnInit: true});
        expect(v.key).toBe("youtube:abc");
        expect(v.isPlaylist).toBe(false);
        expect(v).toMatchObject({provider: "youtube", target: "t-1", videoId: "abc", autoplay: "click", startSeconds: 5, title: "T", channel: "C", thumbnail: "u", showOnInit: true});
    });

    it.each(["provider", "target", "videoId"])("requires %s", (field) => {
        expect(() => new VideoInfo({...base, [field]: ""})).toThrow();
        expect(() => new VideoInfo({...base, [field]: undefined})).toThrow();
    });

    it("the key depends on the provider", () => {
        expect(new VideoInfo({...base, provider: "okru"}).key).toBe("okru:abc");
    });

    it("two links to the same video have the same key (even with a different start time)", () => {
        expect(new VideoInfo({...base, startSeconds: 10}).key).toBe(new VideoInfo({...base, startSeconds: 99}).key);
    });
});

describe("VideoListInfo", () => {
    const make = () => new VideoListInfo("youtube", "t-1", ["a", "b"], 1, true);

    it("exposes its values and key", () => {
        const l = make();
        expect(l.key).toBe("youtube:list:a,b");
        expect(l.isPlaylist).toBe(true);
        expect(l.index).toBe(1);
        expect(l.showOnInit).toBe(true);
        expect(l.videoIds).toEqual(["a", "b"]);
    });

    it("returns frozen copies", () => {
        const l = make();
        expect(Object.isFrozen(l.videoIds)).toBe(true);
        expect(() => l.videoIds.push("c")).toThrow(TypeError);
        expect(() => l.videos.push({})).toThrow(TypeError);
    });

    it("addVideo appends in order", () => {
        const l = make();
        l.addVideo({videoId: "a"});
        l.addVideo({videoId: "b"});
        expect(l.videos.map((v) => v.videoId)).toEqual(["a", "b"]);
    });

    it("the key depends on the order of the IDs", () => {
        expect(new VideoListInfo("youtube", "t", ["b", "a"]).key).not.toBe(make().key);
    });

    it("requires provider, target, and videoIds", () => {
        expect(() => new VideoListInfo("", "t", ["a"])).toThrow();
        expect(() => new VideoListInfo("youtube", "", ["a"])).toThrow();
        expect(() => new VideoListInfo("youtube", "t", undefined)).toThrow();
    });
});

describe("PlaylistInfo", () => {
    it("exposes its values and key", () => {
        const p = new PlaylistInfo("youtube", "t-1", "PL1", "abc", true);
        expect(p.key).toBe("youtube:playlist:PL1");
        expect(p.isPlaylist).toBe(true);
        expect(p).toMatchObject({playlistId: "PL1", videoId: "abc", showOnInit: true, target: "t-1"});
        expect(p.videos).toEqual([]);
    });

    it("videoId is optional", () => {
        expect(new PlaylistInfo("youtube", "t", "PL1", null).videoId).toBeNull();
    });

    it.each([[""], [null], [undefined]])("requires playlistId (%j)", (id) => {
        expect(() => new PlaylistInfo("youtube", "t", id)).toThrow();
    });

    it("returns a frozen copy of the videos", () => {
        const p = new PlaylistInfo("youtube", "t", "PL1");
        p.addVideo({videoId: "x"});
        expect(p.videos).toHaveLength(1);
        expect(() => p.videos.push({})).toThrow(TypeError);
    });
});

describe("UrlInfo", () => {
    it("exposes what is given to it", () => {
        const u = new UrlInfo({kind: "videoList", videoIds: ["1"], index: 2, labels: ["A"], startSeconds: 3, playlistId: "PL", videoId: "v"});
        expect(u).toMatchObject({kind: "videoList", videoIds: ["1"], index: 2, labels: ["A"], startSeconds: 3, playlistId: "PL", videoId: "v"});
    });

    it("absent fields evaluate to undefined", () => {
        const u = new UrlInfo({kind: "video", videoId: "v"});
        expect(u.labels).toBeUndefined();
        expect(u.videoIds).toBeUndefined();
    });
});

describe("YouTubeThumbnailUrlBuilder", () => {
    it("builds the mqdefault URL", () => {
        expect(new YouTubeThumbnailUrlBuilder().getThumbnailUrl("abc")).toBe("https://i.ytimg.com/vi/abc/mqdefault.jpg");
    });

    it.each([[""], [null], [undefined]])("requires a videoId (%j)", (id) => {
        expect(() => new YouTubeThumbnailUrlBuilder().getThumbnailUrl(id)).toThrow();
    });
});