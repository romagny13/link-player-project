import {afterEach, describe, expect, it, vi} from "vitest";
// Adjust these paths to your project
import {LinkParser} from "../src/providers/LinkParser.js";
import {YouTubeLinkParser} from "../src/providers/youtube/YouTubeLinkParser.js";
import {OkruLinkParser} from "../src/providers/okru/OkruLinkParser.js";

// Fake DOM element: no jsdom needed, the parsers only read tagName, href and dataset.
// data-target is required (VideoInfo needs a non-empty target).
const link = (url, dataset = {}) => ({
    tagName: "A",
    href: url,
    dataset: {target: "#player", ...dataset}
});
const div = (url, dataset = {}) => ({
    tagName: "DIV",
    dataset: {target: "#player", url, ...dataset}
});

afterEach(() => vi.restoreAllMocks());

describe("LinkParser", () => {
    const parser = new LinkParser();

    describe("getUrl", () => {
        it("reads href for an <a>", () => {
            expect(parser.getUrl({tagName: "A", href: "https://a.test/", dataset: {}})).toBe("https://a.test/");
        });

        it("reads data-url for other elements", () => {
            expect(parser.getUrl({tagName: "DIV", dataset: {url: "https://b.test/"}})).toBe("https://b.test/");
        });

        it("returns undefined when there is no dataset", () => {
            expect(parser.getUrl({tagName: "SPAN"})).toBeUndefined();
        });
    });

    describe("parseStartTime", () => {
        it.each([
            ["0", 0],
            ["90", 90],
            [90, 90],
            ["1h", 3600],
            ["2m", 120],
            ["45s", 45],
            ["1m30s", 90],
            ["1h2m3s", 3723],
            ["1H2M3S", 3723]
        ])("converts %j to %i seconds", (input, expected) => {
            expect(parser.parseStartTime(input)).toBe(expected);
        });

        it.each([[undefined], [null], [""], ["abc"], ["1h2"], ["-5"], ["1.5"], ["1m 30s"]])(
            "returns undefined for %j",
            (input) => {
                expect(parser.parseStartTime(input)).toBeUndefined();
            }
        );
    });

    describe("parseJsonAttribute", () => {
        it("returns undefined when the attribute is missing", () => {
            expect(parser.parseJsonAttribute(undefined, "data-videos")).toBeUndefined();
        });

        it("parses an array", () => {
            expect(parser.parseJsonAttribute('[{"a":1}]', "data-videos")).toEqual([{a: 1}]);
            expect(parser.parseJsonAttribute("[]", "data-videos")).toEqual([]);
        });

        it("names the attribute in the invalid JSON error", () => {
            expect(() => parser.parseJsonAttribute("{x", "data-videos")).toThrow("Invalid JSON in data-videos");
        });

        it.each([["{}"], ["null"], ['"text"'], ["3"]])("rejects %s (not an array)", (value) => {
            expect(() => parser.parseJsonAttribute(value, "data-videos")).toThrow("data-videos must be a JSON array");
        });

        it("rejects an empty string (data-videos without a value)", () => {
            expect(() => parser.parseJsonAttribute("", "data-videos")).toThrow("Invalid JSON");
        });
    });

    describe("readLinkData", () => {
        it("gives neutral values for a bare element", () => {
            const d = parser.readLinkData({dataset: {}});
            expect(d.videos).toEqual([]);
            expect(d.showOnInit).toBe(false);
            expect(d.autoplay).toBeUndefined();
            expect(d.target).toBeUndefined();
            expect(d.index).toBeUndefined();
        });

        it("reads the attributes", () => {
            const d = parser.readLinkData({
                dataset: {title: "T", channel: "C", thumbnail: "u", target: "t-1", index: "2", autoplay: "click"}
            });
            expect(d).toMatchObject({title: "T", channel: "C", thumbnail: "u", target: "t-1", index: 2, autoplay: "click"});
        });

        it.each([
            [undefined, false],
            ["", true],
            ["true", true],
            ["false", false]
        ])("data-show-on-init=%j gives %s", (value, expected) => {
            expect(parser.readLinkData({dataset: {showOnInit: value}}).showOnInit).toBe(expected);
        });

        it("keeps data-start raw so that parseStartTime can read it", () => {
            expect(parser.readLinkData({dataset: {start: "1m30s"}}).startSeconds).toBe("1m30s");
        });

        it("parses data-videos", () => {
            const d = parser.readLinkData({dataset: {videos: '[{"title":"A"}]'}});
            expect(d.videos).toEqual([{title: "A"}]);
        });
    });
});

describe("YouTubeLinkParser", () => {
    const parser = new YouTubeLinkParser();

    describe("parseUrl", () => {
        it("parses a single video", () => {
            const r = parser.parseUrl("https://www.youtube.com/watch?v=abc123");
            expect(r.kind).toBe("video");
            expect(r.videoId).toBe("abc123");
            expect(r.startSeconds).toBeUndefined();
        });

        it.each([
            "https://youtu.be/abc123",
            "https://www.youtube.com/embed/abc123",
            "https://www.youtube.com/shorts/abc123",
            "https://www.youtube-nocookie.com/embed/abc123",
            "https://m.youtube.com/watch?v=abc123"
        ])("recognizes %s", (url) => {
            const r = parser.parseUrl(url);
            expect(r.kind).toBe("video");
            expect(r.videoId).toBe("abc123");
        });

        it.each([
            ["90", 90],
            ["1m30s", 90],
            ["1h2m3s", 3723],
            ["45s", 45]
        ])("converts t=%s to %i seconds", (t, expected) => {
            const r = parser.parseUrl(`https://www.youtube.com/watch?v=abc123&t=${t}`);
            expect(r.startSeconds).toBe(expected);
        });

        it("reads t= on a youtu.be link", () => {
            expect(parser.parseUrl("https://youtu.be/abc123?t=30").startSeconds).toBe(30);
        });

        it("ignores an invalid t parameter", () => {
            const r = parser.parseUrl("https://www.youtube.com/watch?v=abc123&t=bla");
            expect(r.startSeconds).toBeUndefined();
        });

        it("parses a video list with an index", () => {
            const r = parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=a,b,%20c,,&index=1");
            expect(r.kind).toBe("videoList");
            expect(r.videoIds).toEqual(["a", "b", "c"]);
            expect(r.index).toBe(1);
        });

        it("video_ids wins over list and v", () => {
            expect(parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=a,b&list=PL1&v=z").kind).toBe("videoList");
        });

        it("index is undefined when missing or invalid", () => {
            expect(parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=a").index).toBeUndefined();
            expect(parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=a&index=x").index).toBeUndefined();
        });

        it("returns null when video_ids is empty", () => {
            expect(parser.parseUrl("https://www.youtube.com/watch_videos?video_ids=,")).toBeNull();
        });

        it("parses a playlist", () => {
            const r = parser.parseUrl("https://www.youtube.com/watch?v=abc&list=PL1");
            expect(r.kind).toBe("playlist");
            expect(r.playlistId).toBe("PL1");
            expect(r.videoId).toBe("abc");
        });

        it("parses a playlist without v", () => {
            const r = parser.parseUrl("https://www.youtube.com/playlist?list=PL1");
            expect(r.kind).toBe("playlist");
            expect(r.videoId).toBeNull();
        });

        it("a youtu.be link with list= is a playlist that keeps the starting video", () => {
            const r = parser.parseUrl("https://youtu.be/abc123?list=PL1");
            expect(r.kind).toBe("playlist");
            expect(r.videoId).toBe("abc123");
        });

        it("embed/videoseries?list= is a playlist without a starting video", () => {
            const r = parser.parseUrl("https://www.youtube.com/embed/videoseries?list=PL1&enablejsapi=1");
            expect(r.kind).toBe("playlist");
            expect(r.playlistId).toBe("PL1");
            expect(r.videoId).toBeNull();
        });

        it("throws without v or list", () => {
            expect(() => parser.parseUrl("https://www.youtube.com/watch")).toThrow("Invalid URL");
        });

        it("throws on a malformed URL", () => {
            expect(() => parser.parseUrl("not a url")).toThrow();
        });
    });

    describe("parse (element)", () => {
        it("throws when the element has no URL", () => {
            expect(() => parser.parse({tagName: "DIV", dataset: {target: "#p"}})).toThrow("No URL found");
        });

        it("throws when parseUrl returns null", () => {
            const el = link("https://www.youtube.com/watch_videos?video_ids=,");
            expect(() => parser.parse(el)).toThrow("Invalid URL");
        });

        it("builds a VideoInfo with default values", () => {
            const v = parser.parse(link("https://www.youtube.com/watch?v=abc123&t=1m30s"));
            expect(v.provider).toBe("youtube");
            expect(v.videoId).toBe("abc123");
            expect(v.target).toBe("#player");
            expect(v.startSeconds).toBe(90);
            expect(v.autoplay).toBe("none");
            expect(v.title).toBe("");
            expect(v.channel).toBe("");
            expect(v.thumbnail).toBe("https://i.ytimg.com/vi/abc123/mqdefault.jpg");
        });

        it("reads the data-* attributes and prefers data-thumbnail", () => {
            const v = parser.parse(link("https://www.youtube.com/watch?v=abc123", {
                title: "Title",
                channel: "Channel",
                thumbnail: "https://example.test/t.jpg",
                autoplay: ""
            }));
            expect(v.title).toBe("Title");
            expect(v.channel).toBe("Channel");
            expect(v.thumbnail).toBe("https://example.test/t.jpg");
            expect(v.autoplay).toBe("init");
        });

        it("accepts data-autoplay=click", () => {
            const v = parser.parse(link("https://www.youtube.com/watch?v=abc123", {autoplay: "click"}));
            expect(v.autoplay).toBe("click");
        });

        it("reads the URL from data-url for an element that is not an <a>", () => {
            const v = parser.parse(div("https://www.youtube.com/watch?v=abc123"));
            expect(v.videoId).toBe("abc123");
        });

        describe("data-start", () => {
            it("data-start wins over t= in the URL", () => {
                const v = parser.parse(link("https://www.youtube.com/watch?v=abc123&t=10", {start: "120"}));
                expect(v.startSeconds).toBe(120);
            });

            it("keeps t= when there is no data-start", () => {
                expect(parser.parse(link("https://www.youtube.com/watch?v=abc123&t=10")).startSeconds).toBe(10);
            });

            it.each([
                ["90", 90],
                ["1m30s", 90]
            ])("data-start=%s gives %i", (start, expected) => {
                expect(parser.parse(link("https://www.youtube.com/watch?v=abc123", {start})).startSeconds).toBe(expected);
            });

            it("ignores an invalid data-start", () => {
                expect(parser.parse(link("https://www.youtube.com/watch?v=abc123", {start: "soon"})).startSeconds).toBeUndefined();
            });
        });

        describe("showOnInit", () => {
            it.each([
                [undefined, false],
                ["", true],
                ["true", true],
                ["false", false]
            ])("data-show-on-init=%j gives %s", (value, expected) => {
                const dataset = value === undefined ? {} : {showOnInit: value};
                expect(parser.parse(link("https://www.youtube.com/watch?v=abc123", dataset)).showOnInit).toBe(expected);
                expect(parser.parse(link("https://www.youtube.com/playlist?list=PL1", dataset)).showOnInit).toBe(expected);
                expect(parser.parse(link("https://www.youtube.com/watch_videos?video_ids=a,b", dataset)).showOnInit).toBe(expected);
            });
        });

        describe("injected thumbnailUrlBuilder", () => {
            it("uses the injected thumbnailUrlBuilder", () => {
                const getThumbnailUrl = vi.fn(() => "https://example.test/custom.jpg");
                const custom = new YouTubeLinkParser({thumbnailUrlBuilder: {getThumbnailUrl}});
                const v = custom.parse(link("https://www.youtube.com/watch?v=abc123"));
                expect(getThumbnailUrl).toHaveBeenCalledWith("abc123");
                expect(v.thumbnail).toBe("https://example.test/custom.jpg");
            });

            const custom = new YouTubeLinkParser({thumbnailUrlBuilder: {getThumbnailUrl: (id) => `https://example.test/${id}.jpg`}});

            it("is used for every video of a list", () => {
                const list = custom.parse(link("https://www.youtube.com/watch_videos?video_ids=a,b"));
                expect(list.videos.map((v) => v.thumbnail)).toEqual(["https://example.test/a.jpg", "https://example.test/b.jpg"]);
            });

            it("is used for the fallback videos of a playlist", () => {
                const videos = JSON.stringify([{id: "x1"}]);
                const pl = custom.parse(link("https://www.youtube.com/playlist?list=PL1", {videos}));
                expect(pl.videos[0].thumbnail).toBe("https://example.test/x1.jpg");
            });

            it("data-thumbnail wins over the builder", () => {
                const v = custom.parse(link("https://www.youtube.com/watch?v=abc", {thumbnail: "https://example.test/own.jpg"}));
                expect(v.thumbnail).toBe("https://example.test/own.jpg");
            });

            it("works without options or with an empty object", () => {
                expect(() => new YouTubeLinkParser()).not.toThrow();
                expect(() => new YouTubeLinkParser({})).not.toThrow();
            });
        });

        it("builds a VideoListInfo without data-videos", () => {
            const list = parser.parse(link("https://www.youtube.com/watch_videos?video_ids=a,b&index=1"));
            expect(list.isPlaylist).toBe(true);
            expect(list.videoIds).toEqual(["a", "b"]);
            expect(list.videos).toHaveLength(2);
            expect(list.videos[0].videoId).toBe("a");
            expect(list.videos[0].title).toBe("");
            expect(list.videos[1].thumbnail).toBe("https://i.ytimg.com/vi/b/mqdefault.jpg");
        });

        it("builds a VideoListInfo with data-videos", () => {
            const videos = JSON.stringify([
                {title: "A", channel: "CA", autoplay: "click"},
                {title: "B"}
            ]);
            const list = parser.parse(link("https://www.youtube.com/watch_videos?video_ids=a,b", {videos}));
            expect(list.videos.map((v) => v.title)).toEqual(["A", "B"]);
            expect(list.videos[0].channel).toBe("CA");
            expect(list.videos[0].autoplay).toBe("click");
            expect(list.videos[1].autoplay).toBe("none");
        });

        it("applies data-start to every video of a list", () => {
            const list = parser.parse(link("https://www.youtube.com/watch_videos?video_ids=a,b", {start: "30"}));
            expect(list.videos.map((v) => v.startSeconds)).toEqual([30, 30]);
        });

        it("accepts empty data-videos entries for a list", () => {
            const list = parser.parse(link("https://www.youtube.com/watch_videos?video_ids=a,b", {videos: "[{}, {}]"}));
            expect(list.videos).toHaveLength(2);
        });

        it("ignores the data-videos entries beyond video_ids", () => {
            const videos = JSON.stringify([{title: "A"}, {title: "B"}, {title: "C"}]);
            const list = parser.parse(link("https://www.youtube.com/watch_videos?video_ids=a,b", {videos}));
            expect(list.videos).toHaveLength(2);
        });

        it("builds a PlaylistInfo with the fallback videos", () => {
            const videos = JSON.stringify([
                {id: "x1", title: "T1", startSeconds: "1m"},
                {id: "x2"}
            ]);
            const pl = parser.parse(link("https://www.youtube.com/watch?v=abc&list=PL1", {videos}));
            expect(pl.playlistId).toBe("PL1");
            expect(pl.videoId).toBe("abc");
            expect(pl.videos).toHaveLength(2);
            expect(pl.videos[0].videoId).toBe("x1");
            expect(pl.videos[0].startSeconds).toBe(60);
            expect(pl.videos[1].thumbnail).toBe("https://i.ytimg.com/vi/x2/mqdefault.jpg");
        });

        it("builds an empty PlaylistInfo without data-videos", () => {
            const pl = parser.parse(link("https://www.youtube.com/playlist?list=PL1"));
            expect(pl.videos).toEqual([]);
        });

        it("fails when a playlist fallback video has no id", () => {
            const videos = JSON.stringify([{title: "no id"}]);
            expect(() => parser.parse(link("https://www.youtube.com/playlist?list=PL1", {videos}))).toThrow();
        });

        it("throws when data-videos is not JSON", () => {
            const el = link("https://www.youtube.com/watch_videos?video_ids=a", {videos: "{not json"});
            expect(() => parser.parse(el)).toThrow("Invalid JSON in data-videos");
        });

        it("throws when data-videos is not an array", () => {
            const el = link("https://www.youtube.com/watch_videos?video_ids=a", {videos: "{}"});
            expect(() => parser.parse(el)).toThrow("data-videos must be a JSON array");
        });

        describe("keys", () => {
            it("a video, a list and a playlist have distinct keys", () => {
                const keys = [
                    parser.parse(link("https://www.youtube.com/watch?v=a")).key,
                    parser.parse(link("https://www.youtube.com/watch_videos?video_ids=a,b")).key,
                    parser.parse(link("https://www.youtube.com/playlist?list=a")).key
                ];
                expect(new Set(keys).size).toBe(3);
            });

            it("the same URL always gives the same key", () => {
                const url = "https://www.youtube.com/watch?v=abc";
                expect(parser.parse(link(url)).key).toBe(parser.parse(link(url)).key);
            });
        });
    });
});

describe("OkruLinkParser", () => {
    const parser = new OkruLinkParser();

    describe("parseUrl", () => {
        it.each([
            "https://ok.ru/video/12345",
            "https://ok.ru/videoembed/12345",
            "https://ok.ru/videoembed/12345?autoplay=1"
        ])("extracts the video id from %s", (url) => {
            const r = parser.parseUrl(url);
            expect(r.kind).toBe("video");
            expect(r.videoId).toBe("12345");
        });

        it("accepts the mobile subdomain", () => {
            expect(parser.parseUrl("https://m.ok.ru/video/12345").videoId).toBe("12345");
        });

        it("returns null when the path does not match", () => {
            expect(parser.parseUrl("https://ok.ru/profile/12345")).toBeNull();
            expect(parser.parseUrl("https://ok.ru/video/abc")).toBeNull();
        });

        it("returns null on a malformed URL", () => {
            expect(parser.parseUrl("not a url")).toBeNull();
        });

        it("parses a video list with an index and labels", () => {
            const r = parser.parseUrl("https://ok.ru/video?video_ids=1,2,3&index=2&labels=A,B%2C%20C,D");
            expect(r.kind).toBe("videoList");
            expect(r.videoIds).toEqual(["1", "2", "3"]);
            expect(r.index).toBe(2);
            // the encoded comma (%2C) stays in the title, the raw comma separates
            expect(r.labels).toEqual(["A", "B, C", "D"]);
        });

        it("a video_ids parameter on a /video/ID path gives a list", () => {
            const r = parser.parseUrl("https://ok.ru/video/1?video_ids=1,2,3");
            expect(r.kind).toBe("videoList");
            expect(r.videoIds).toEqual(["1", "2", "3"]);
        });

        it("index is undefined when missing", () => {
            expect(parser.parseUrl("https://ok.ru/video?video_ids=1,2").index).toBeUndefined();
        });

        it("ignores the spaces around ids", () => {
            expect(parser.parseUrl("https://ok.ru/video?video_ids=1,%202,3%20").videoIds).toEqual(["1", "2", "3"]);
        });

        it("returns empty labels when labels is missing", () => {
            const r = parser.parseUrl("https://ok.ru/video?video_ids=1,2");
            expect(r.labels).toEqual([]);
        });

        it("keeps an empty label at its position", () => {
            const r = parser.parseUrl("https://ok.ru/video?video_ids=1,2,3&labels=A,,C");
            expect(r.labels).toEqual(["A", "", "C"]);
        });

        it("keeps a label with an invalid % sequence as written", () => {
            const r = parser.parseUrl("https://ok.ru/video?video_ids=1,2&labels=100%,B");
            expect(r.labels).toEqual(["100%", "B"]);
        });

        it("decodes encoded labels like in a real URL", () => {
            const url = "https://ok.ru/video/1?video_ids=1,2&labels=La%20Caverne%20d'Or%2C%20%C3%A9p.01,%C3%A9p.02";
            expect(parser.parseUrl(url).labels).toEqual(["La Caverne d'Or, ép.01", "ép.02"]);
        });

        it("returns null when video_ids is empty", () => {
            expect(parser.parseUrl("https://ok.ru/video?video_ids=")).toBeNull();
            expect(parser.parseUrl("https://ok.ru/video?video_ids=,")).toBeNull();
        });
    });

    describe("parse (element)", () => {
        it("throws when the element has no URL", () => {
            expect(() => parser.parse({tagName: "DIV", dataset: {target: "#p"}})).toThrow("No URL found");
        });

        it("throws when the URL is not recognized", () => {
            expect(() => parser.parse(link("https://ok.ru/profile/1"))).toThrow("Invalid URL");
        });

        it("builds a VideoInfo with default values", () => {
            const v = parser.parse(link("https://ok.ru/video/12345"));
            expect(v.provider).toBe("okru");
            expect(v.videoId).toBe("12345");
            expect(v.target).toBe("#player");
            expect(v.autoplay).toBe("none");
            expect(v.title).toBe("");
            expect(v.channel).toBe("");
            expect(v.thumbnail).toBe("");
        });

        it("reads the data-* attributes", () => {
            const v = parser.parse(link("https://ok.ru/video/12345", {
                title: "Title",
                channel: "Channel",
                thumbnail: "https://example.test/t.jpg",
                autoplay: "click",
                start: "90"
            }));
            expect(v.title).toBe("Title");
            expect(v.channel).toBe("Channel");
            expect(v.thumbnail).toBe("https://example.test/t.jpg");
            expect(v.autoplay).toBe("click");
            expect(v.startSeconds).toBe(90);
        });

        it("reads the URL from data-url for an element that is not an <a>", () => {
            expect(parser.parse(div("https://ok.ru/video/12345")).videoId).toBe("12345");
        });

        it.each([
            ["90", 90],
            ["1m30s", 90]
        ])("data-start=%s gives %i", (start, expected) => {
            expect(parser.parse(link("https://ok.ru/video/12345", {start})).startSeconds).toBe(expected);
        });

        it.each([
            [undefined, false],
            ["", true],
            ["true", true],
            ["false", false]
        ])("data-show-on-init=%j gives %s", (value, expected) => {
            const dataset = value === undefined ? {} : {showOnInit: value};
            expect(parser.parse(link("https://ok.ru/video/12345", dataset)).showOnInit).toBe(expected);
            expect(parser.parse(link("https://ok.ru/video?video_ids=1,2", dataset)).showOnInit).toBe(expected);
        });

        it("uses the labels of the URL as titles without data-videos", () => {
            const list = parser.parse(link("https://ok.ru/video?video_ids=1,2&labels=A,B"));
            expect(list.videoIds).toEqual(["1", "2"]);
            expect(list.videos.map((v) => v.title)).toEqual(["A", "B"]);
            expect(list.videos.map((v) => v.videoId)).toEqual(["1", "2"]);
        });

        it("gives data-videos priority over labels", () => {
            const videos = JSON.stringify([{title: "From JSON"}, {title: "Also JSON"}]);
            const list = parser.parse(link("https://ok.ru/video?video_ids=1,2&labels=A,B", {videos}));
            expect(list.videos.map((v) => v.title)).toEqual(["From JSON", "Also JSON"]);
        });

        it("tolerates a data-videos shorter than video_ids", () => {
            const videos = JSON.stringify([{title: "Only"}]);
            const list = parser.parse(link("https://ok.ru/video?video_ids=1,2", {videos}));
            expect(list.videos).toHaveLength(2);
            expect(list.videos[0].title).toBe("Only");
            expect(list.videos[1].title).toBe("");
        });

        it("inherits data-autoplay when the video does not specify one", () => {
            const videos = JSON.stringify([{title: "A"}, {title: "B", autoplay: "click"}]);
            const list = parser.parse(link("https://ok.ru/video?video_ids=1,2", {videos, autoplay: ""}));
            expect(list.videos[0].autoplay).toBe("init");
            expect(list.videos[1].autoplay).toBe("click");
        });

        it("converts data-videos[].startSeconds", () => {
            const videos = JSON.stringify([{startSeconds: "1m"}, {startSeconds: "45"}]);
            const list = parser.parse(link("https://ok.ru/video?video_ids=1,2", {videos}));
            expect(list.videos.map((v) => v.startSeconds)).toEqual([60, 45]);
        });

        it("throws a clear error on an invalid data-videos", () => {
            expect(() => parser.parse(link("https://ok.ru/video?video_ids=1", {videos: "nope"}))).toThrow("Invalid JSON in data-videos");
        });

        it("keeps the index of the list", () => {
            const list = parser.parse(link("https://ok.ru/video?video_ids=1,2,3&index=2"));
            expect(list.index).toBe(2);
        });

        it("warns when the number of labels does not match", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            parser.parse(link("https://ok.ru/video?video_ids=1,2&labels=A,B,C"));
            expect(warn).toHaveBeenCalledOnce();
        });

        it("does not warn when the labels match", () => {
            const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
            parser.parse(link("https://ok.ru/video?video_ids=1,2&labels=A,B"));
            expect(warn).not.toHaveBeenCalled();
        });

        it("uses the 'okru' provider string for the videos of a list", () => {
            const list = parser.parse(link("https://ok.ru/video?video_ids=1"));
            expect(list.videos[0].provider).toBe("okru");
        });

        it("prefixes the key with the provider", () => {
            expect(parser.parse(link("https://ok.ru/video/12345")).key).toBe("okru:12345");
            expect(parser.parse(link("https://ok.ru/video?video_ids=1,2")).key).toBe("okru:list:1,2");
        });
    });
});