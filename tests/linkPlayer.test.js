// @vitest-environment jsdom
// tests/linkPlayer.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clampWidth,
  resolveScope,
  JsonStore,
  groupBySeason,
  YouTubeProvider,
  DailymotionProvider,
  OkruProvider,
  UnsupportedUrlError,
  ProviderRegistry,
  NavigationJournal,
  NavigationService,
  RegionView,
  LinkPlayer,
  MemoryStore
} from "../src/linkPlayer.js";

/* ───────────────────────── test helpers ───────────────────────── */

const memoryStore = () => {
  const m = new Map();
  return new JsonStore({
    storage: {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => m.set(k, v),
      removeItem: (k) => m.delete(k)
    },
    prefix: "t:"
  });
};

const jsonRes = (data, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => data
});

/** Fake YouTube Data API: playlistItems → ids, videos → one snippet per requested id. */
const ytFetch = ({ ids = ["a", "b"], privateIds = [] } = {}) =>
  vi.fn(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/playlistItems"))
      return jsonRes({
        items: ids.map((videoId) => ({ contentDetails: { videoId } }))
      });
    const wanted = (u.searchParams.get("id") ?? "").split(",");
    return jsonRes({
      items: wanted.map((id) => ({
        id,
        snippet: {
          title: `Title ${id}`,
          channelTitle: "Chan",
          thumbnails: { medium: { url: `https://t/${id}.jpg` } }
        },
        status: {
          privacyStatus: privateIds.includes(id) ? "private" : "public"
        }
      }))
    });
  });

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* ───────────────────────── helpers ───────────────────────── */

describe("clampWidth", () => {
  it("respects the minimum of 140", () => {
    expect(clampWidth(50, 1000)).toBe(140);
    expect(clampWidth(140, 1000)).toBe(140);
  });

  it("caps at 70% of host width", () => {
    expect(clampWidth(900, 1000)).toBe(700);
    expect(clampWidth(500, 1000)).toBe(500);
  });

  it("never goes below 140 even when host is small", () => {
    expect(clampWidth(200, 100)).toBe(140);
  });

  it("rounds the value", () => {
    expect(clampWidth(200.7, 1000)).toBe(201);
  });

  it("accepts an unknown (Infinity) host width", () => {
    expect(clampWidth(300, Infinity)).toBe(300);
  });
});

describe("resolveScope", () => {
  it("returns the element when given an HTMLElement", () => {
    const div = document.createElement("div");
    expect(resolveScope(div)).toBe(div);
  });

  it("queries the document for a selector string", () => {
    const div = document.createElement("div");
    div.id = "scope";
    document.body.append(div);
    expect(resolveScope("#scope")).toBe(div);
  });

  it("falls back to documentElement", () => {
    expect(resolveScope(null)).toBe(document.documentElement);
    expect(resolveScope("#missing")).toBe(document.documentElement);
  });
});

/* ───────────────────────── JsonStore ───────────────────────── */

describe("JsonStore", () => {
  let memory;
  let store;

  beforeEach(() => {
    memory = new Map();
    const fakeStorage = {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => memory.set(k, v),
      removeItem: (k) => memory.delete(k)
    };
    store = new JsonStore({ storage: fakeStorage, prefix: "test:" });
  });

  it("stores and retrieves data", () => {
    store.set("a", { x: 1 });
    expect(store.get("a")).toEqual({ x: 1 });
  });

  it("applies the prefix to the underlying keys", () => {
    store.set("a", 1);
    expect([...memory.keys()]).toEqual(["test:a"]);
  });

  it("returns null for missing keys", () => {
    expect(store.get("missing")).toBeNull();
  });

  it("never expires without a ttl", () => {
    vi.useFakeTimers();
    store.set("keep", "v");
    vi.advanceTimersByTime(365 * 24 * 3600 * 1000);
    expect(store.get("keep")).toBe("v");
  });

  it("expires entries after ttl and removes them", () => {
    vi.useFakeTimers();
    store.set("tmp", "value", 1000);
    expect(store.get("tmp")).toBe("value");
    vi.advanceTimersByTime(1001);
    expect(store.get("tmp")).toBeNull();
    expect(memory.has("test:tmp")).toBe(false);
  });

  it("returns null on corrupted JSON", () => {
    memory.set("test:bad", "{not json");
    expect(store.get("bad")).toBeNull();
  });

  it("remove deletes the key", () => {
    store.set("a", 1);
    store.remove("a");
    expect(store.get("a")).toBeNull();
  });

  it("never throws on broken storage", () => {
    const boom = () => {
      throw new Error("quota");
    };
    const s = new JsonStore({
      storage: { getItem: boom, setItem: boom, removeItem: boom }
    });
    expect(() => s.get("x")).not.toThrow();
    expect(() => s.set("x", 1)).not.toThrow();
    expect(() => s.remove("x")).not.toThrow();
    expect(s.get("x")).toBeNull();
  });
});

/* ───────────────────────── groupBySeason ───────────────────────── */

describe("groupBySeason", () => {
  const titles = (...labels) => labels.map((title) => ({ title }));

  it("returns null when there is nothing useful to group", () => {
    expect(groupBySeason([])).toBeNull();
    expect(groupBySeason(titles("Episode 1", "Episode 2"))).toBeNull();
  });

  it("groups by explicit season markers in titles", () => {
    const groups = groupBySeason(
      titles(
        "S01E01 Pilot",
        "S01E02 Next",
        "Season 2 Episode 1",
        "S2E2",
        "Bonus"
      )
    );
    expect(groups).toEqual([
      { key: 1, label: "Season 1", start: 0, end: 2 },
      { key: 2, label: "Season 2", start: 2, end: 5 }
    ]);
  });

  it("understands the French 'Saison' marker", () => {
    const groups = groupBySeason(titles("Saison 1 - Ep 1", "Saison 2 - Ep 1"));
    expect(groups.map((g) => g.label)).toEqual(["Season 1", "Season 2"]);
  });

  it("puts leading unmarked items in season 1 when the first marker is > 1", () => {
    const groups = groupBySeason(titles("Intro", "S2E1", "S2E2"));
    expect(groups.map((g) => [g.label, g.start, g.end])).toEqual([
      ["Season 1", 0, 1],
      ["Season 2", 1, 3]
    ]);
  });

  it("labels leading unmarked items 'Other' when season 1 comes later", () => {
    const groups = groupBySeason(titles("Intro", "S1E1", "S2E1"));
    expect(groups.map((g) => g.label)).toEqual([
      "Other",
      "Season 1",
      "Season 2"
    ]);
  });

  it("uses provided season counts when available", () => {
    const groups = groupBySeason(titles("a", "b", "c", "d", "e"), [2, 2]);
    expect(groups).toEqual([
      { label: "Season 1", start: 0, end: 2 },
      { label: "Season 2", start: 2, end: 4 },
      { label: "Other", start: 4, end: 5 }
    ]);
  });

  it("clamps counts larger than the item list", () => {
    const groups = groupBySeason(titles("a", "b", "c", "d"), [3, 3]);
    expect(groups).toEqual([
      { label: "Season 1", start: 0, end: 3 },
      { label: "Season 2", start: 3, end: 4 }
    ]);
  });

  it("returns null when counts produce a single group", () => {
    expect(groupBySeason(titles("a", "b"), [2])).toBeNull();
    expect(groupBySeason(titles("a", "b", "c"), [5, 5])).toBeNull();
  });
});

/* ───────────────────────── providers ───────────────────────── */

describe("YouTubeProvider", () => {
  const yt = new YouTubeProvider({
    apiKey: null,
    origin: "https://example.com"
  });

  describe("canHandle", () => {
    it.each([
      // watch / short urls
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", true],
      ["https://youtube.com/watch?v=dQw4w9WgXcQ", true],
      ["https://youtu.be/dQw4w9WgXcQ", true],
      ["https://www.youtube.com/watch_videos?video_ids=aaa,bbb", true],
      // existing embeds
      ["https://www.youtube.com/embed/dQw4w9WgXcQ", true],
      ["https://www.youtube.com/embed/videoseries?list=PLxxx", true],
      ["https://www.youtube.com/embed?playlist=aaa,bbb", true],
      ["https://www.youtube.com/embed", true],
      ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", true],
      // not handled
      ["https://www.youtube.com/watch", false],
      ["https://www.youtube.com/playlist?list=PLxxx", false],
      ["https://www.youtube.com/embedded/abc", false],
      ["https://www.youtube-nocookie.com/watch?v=abc", false],
      ["https://youtu.be/", false],
      ["https://vimeo.com/123", false],
      ["not-a-url", false]
    ])("%s → %s", (url, expected) => {
      expect(yt.canHandle(url)).toBe(expected);
    });
  });

  describe("parse", () => {
    it("parses watch url", () => {
      const p = yt.parse(
        "https://www.youtube.com/watch?v=abc123&list=PLxyz&t=42&index=3"
      );
      expect(p).toMatchObject({
        videoId: "abc123",
        playlistId: "PLxyz",
        startSeconds: 42,
        initialIndex: 2 // 1-based → 0-based
      });
    });

    it("parses youtu.be", () => {
      expect(yt.parse("https://youtu.be/xyz").videoId).toBe("xyz");
    });

    it("parses video_ids list", () => {
      const p = yt.parse(
        "https://www.youtube.com/watch_videos?video_ids=a,b,c"
      );
      expect(p.videoIds).toEqual(["a", "b", "c"]);
    });

    it("parses /embed?playlist=… (no slash, no id)", () => {
      const p = yt.parse(
        "https://www.youtube.com/embed?playlist=at9-Gm1-MWQ,AwaVAlMURak,GgNTzHi4xtQ,Enevxnnn114,i47QRX20un8"
      );
      expect(p.videoId).toBeNull();
      expect(p.playlistId).toBeNull();
      expect(p.videoIds).toEqual([
        "at9-Gm1-MWQ",
        "AwaVAlMURak",
        "GgNTzHi4xtQ",
        "Enevxnnn114",
        "i47QRX20un8"
      ]);
      expect(p.initialIndex).toBeNull();
    });

    it("parses /embed/videoseries?list=… without a videoId", () => {
      const p = yt.parse(
        "https://www.youtube.com/embed/videoseries?list=PLRVWztDBSD_Jh0PwXtJ0wBP0TLtHga1_Y"
      );
      expect(p.videoId).toBeNull();
      expect(p.playlistId).toBe("PLRVWztDBSD_Jh0PwXtJ0wBP0TLtHga1_Y");
      expect(p.videoIds).toBeNull();
    });

    it("parses /embed/ID", () => {
      expect(yt.parse("https://www.youtube.com/embed/abc").videoId).toBe("abc");
    });

    it("parses youtube-nocookie embeds", () => {
      expect(
        yt.parse("https://www.youtube-nocookie.com/embed/abc").videoId
      ).toBe("abc");
    });

    it("prepends the path id to ?playlist= when absent", () => {
      const p = yt.parse("https://www.youtube.com/embed/abc?playlist=b,c");
      expect(p.videoId).toBe("abc");
      expect(p.videoIds).toEqual(["abc", "b", "c"]);
    });

    it("does not duplicate the path id when already in ?playlist=", () => {
      const p = yt.parse("https://www.youtube.com/embed/abc?playlist=abc,b");
      expect(p.videoIds).toEqual(["abc", "b"]);
    });

    it("reads embed index as 0-based (unlike watch urls)", () => {
      const p = yt.parse(
        "https://www.youtube.com/embed/videoseries?list=PLx&index=2"
      );
      expect(p.initialIndex).toBe(2);
    });

    it("reads start= on embeds", () => {
      expect(
        yt.parse("https://www.youtube.com/embed/abc?start=30").startSeconds
      ).toBe(30);
    });

    it("ignores non-numeric t / index", () => {
      const p = yt.parse("https://www.youtube.com/watch?v=a&t=1m30s&index=x");
      expect(p.startSeconds).toBeNull();
      expect(p.initialIndex).toBeNull();
    });
  });

  describe("buildEmbedSrc", () => {
    const base = {
      videoId: null,
      playlistId: null,
      videoIds: null,
      startSeconds: null
    };

    it("builds a single video embed", () => {
      const src = yt.buildEmbedSrc(
        { ...base, videoId: "abc", startSeconds: 10 },
        { autoplay: true }
      );
      expect(src).toContain("https://www.youtube.com/embed/abc?");
      expect(src).toContain("autoplay=1");
      expect(src).toContain("start=10");
      expect(src).toContain("origin=https%3A%2F%2Fexample.com");
    });

    it("always enables the JS API (needed by the panel)", () => {
      const src = yt.buildEmbedSrc({ ...base, videoId: "abc" });
      expect(new URL(src).searchParams.get("enablejsapi")).toBe("1");
      expect(src).not.toContain("autoplay");
    });

    it("omits origin when none is known", () => {
      const noOrigin = new YouTubeProvider({ origin: "" });
      expect(noOrigin.buildEmbedSrc({ ...base, videoId: "abc" })).not.toContain(
        "origin="
      );
    });

    it("builds a playlist embed with index", () => {
      const src = yt.buildEmbedSrc(
        { ...base, playlistId: "PLxyz" },
        { index: 2 }
      );
      expect(src).toContain("/embed/videoseries?");
      expect(src).toContain("list=PLxyz");
      expect(src).toContain("index=2");
    });

    it("uses videoseries for list= without videoId, even without index (never /embed/null)", () => {
      const src = yt.buildEmbedSrc({ ...base, playlistId: "PLxyz" });
      const u = new URL(src);
      expect(u.pathname).toBe("/embed/videoseries");
      expect(u.searchParams.get("list")).toBe("PLxyz");
      expect(u.searchParams.has("index")).toBe(false);
      expect(src).not.toContain("/embed/null");
    });

    it("keeps /embed/ID?list= when a videoId is known and no index is forced", () => {
      const src = yt.buildEmbedSrc({
        ...base,
        videoId: "abc",
        playlistId: "PLxyz"
      });
      expect(src).toContain("/embed/abc?");
      expect(src).toContain("list=PLxyz");
    });

    it("builds a dynamic playlist from videoIds", () => {
      const src = yt.buildEmbedSrc({ ...base, videoIds: ["a", "b"] });
      const u = new URL(src);
      expect(u.pathname).toBe("/embed/videoseries");
      expect(u.searchParams.get("playlist")).toBe("a,b");
      expect(u.searchParams.has("index")).toBe(false);
    });

    it("passes index 0 explicitly (0 is not 'no index')", () => {
      const src = yt.buildEmbedSrc(
        { ...base, videoIds: ["a", "b"] },
        { index: 0 }
      );
      expect(new URL(src).searchParams.get("index")).toBe("0");
    });
  });

  describe("getThumbnail", () => {
    it("uses the video id, then the first dynamic id, otherwise null", async () => {
      expect(await yt.getThumbnail({ videoId: "abc" })).toBe(
        "https://img.youtube.com/vi/abc/hqdefault.jpg"
      );
      expect(
        await yt.getThumbnail({ videoId: null, videoIds: ["x", "y"] })
      ).toBe("https://img.youtube.com/vi/x/hqdefault.jpg");
      expect(
        await yt.getThumbnail({ videoId: null, videoIds: null })
      ).toBeNull();
    });
  });

  describe("getPlaylist", () => {
    beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

    it("returns [] when there is nothing to list", async () => {
      expect(
        await yt.getPlaylist({ playlistId: null, videoIds: null })
      ).toEqual([]);
    });

    it("falls back to generic items for dynamic playlists without api key", async () => {
      const items = await yt.getPlaylist({
        playlistId: null,
        videoIds: ["a", "b"]
      });
      expect(items).toEqual([
        {
          id: "a",
          index: 0,
          title: "Video 1",
          channelTitle: "",
          thumbnailUrl: "https://img.youtube.com/vi/a/mqdefault.jpg"
        },
        {
          id: "b",
          index: 1,
          title: "Video 2",
          channelTitle: "",
          thumbnailUrl: "https://img.youtube.com/vi/b/mqdefault.jpg"
        }
      ]);
    });

    it("returns [] for list= playlists without api key", async () => {
      expect(
        await yt.getPlaylist({ playlistId: "PL1", videoIds: null })
      ).toEqual([]);
    });

    it("loads titles through the Data API and skips private videos", async () => {
      const fetchFn = ytFetch({ ids: ["a", "b", "c"], privateIds: ["b"] });
      const p = new YouTubeProvider({
        apiKey: "K",
        fetchFn,
        store: memoryStore()
      });
      const items = await p.getPlaylist({ playlistId: "PL1", videoIds: null });
      expect(items).toEqual([
        {
          id: "a",
          index: 0,
          title: "Title a",
          channelTitle: "Chan",
          thumbnailUrl: "https://t/a.jpg"
        },
        {
          id: "c",
          index: 1,
          title: "Title c",
          channelTitle: "Chan",
          thumbnailUrl: "https://t/c.jpg"
        }
      ]);
      expect(fetchFn.mock.calls[0][0]).toContain("playlistId=PL1");
      expect(fetchFn.mock.calls[0][0]).toContain("key=K");
    });

    it("follows nextPageToken", async () => {
      const pages = [
        { items: [{ contentDetails: { videoId: "a" } }], nextPageToken: "T2" },
        { items: [{ contentDetails: { videoId: "b" } }] }
      ];
      const base = ytFetch();
      const fetchFn = vi.fn(async (url) =>
        new URL(url).pathname.endsWith("/playlistItems")
          ? jsonRes(pages.shift())
          : base(url)
      );
      const p = new YouTubeProvider({ apiKey: "K", fetchFn });
      const items = await p.getPlaylist({ playlistId: "PL1", videoIds: null });
      expect(items.map((i) => i.id)).toEqual(["a", "b"]);
      expect(fetchFn.mock.calls[1][0]).toContain("pageToken=T2");
    });

    it("caches the result in the store", async () => {
      const fetchFn = ytFetch();
      const p = new YouTubeProvider({
        apiKey: "K",
        fetchFn,
        store: memoryStore()
      });
      const parsed = { playlistId: "PL1", videoIds: null };
      await p.getPlaylist(parsed);
      const calls = fetchFn.mock.calls.length;
      const again = await p.getPlaylist(parsed);
      expect(fetchFn.mock.calls.length).toBe(calls);
      expect(again).toHaveLength(2);
    });

    it("falls back to generic items when the API fails on a dynamic playlist", async () => {
      const fetchFn = vi.fn(async () => jsonRes({}, false, 403));
      const p = new YouTubeProvider({ apiKey: "K", fetchFn });
      const items = await p.getPlaylist({
        playlistId: null,
        videoIds: ["a", "b"]
      });
      expect(items.map((i) => i.title)).toEqual(["Video 1", "Video 2"]);
    });

    it("never rejects", async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error("network");
      });
      const p = new YouTubeProvider({ apiKey: "K", fetchFn });
      await expect(
        p.getPlaylist({ playlistId: "PL1", videoIds: null })
      ).resolves.toEqual([]);
    });
  });

  describe("createController", () => {
    const fakeIframe = () => ({
      contentWindow: { postMessage: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });

    it("playAt posts a playVideoAt command", () => {
      const iframe = fakeIframe();
      const c = yt.createController(iframe, {});
      c.playAt(3);
      const [payload, target] = iframe.contentWindow.postMessage.mock.calls[0];
      expect(JSON.parse(payload)).toEqual({
        event: "command",
        func: "playVideoAt",
        args: [3]
      });
      expect(target).toBe("*");
      c.dispose();
    });

    it("subscribes to player events on iframe load", () => {
      const iframe = fakeIframe();
      const c = yt.createController(iframe, {});
      const onLoad = iframe.addEventListener.mock.calls.find(
        ([n]) => n === "load"
      )[1];
      onLoad();
      expect(
        JSON.parse(iframe.contentWindow.postMessage.mock.calls[0][0])
      ).toEqual({
        event: "listening"
      });
      c.dispose();
    });

    it("dispose removes its listeners", () => {
      const iframe = fakeIframe();
      yt.createController(iframe, {}).dispose();
      expect(iframe.removeEventListener).toHaveBeenCalledWith(
        "load",
        expect.any(Function)
      );
    });
  });
});

describe("DailymotionProvider (player id)", () => {
  const dm = new DailymotionProvider({ playerId: "OPT" });

  it("handles existing geo embeds", () => {
    expect(
      dm.canHandle(
        "https://geo.dailymotion.com/player/x8lr5.html?video=x84sh87"
      )
    ).toBe(true);
    expect(
      dm.canHandle(
        "https://geo.dailymotion.com/player/x8lr5.html?playlist=x5zhzj"
      )
    ).toBe(true);
    expect(dm.canHandle("https://geo.dailymotion.com/player/x8lr5.html")).toBe(
      false
    );
  });

  it("keeps the player id of an existing embed, which wins over the option", () => {
    const p = dm.parse(
      "https://geo.dailymotion.com/player/x8lr5.html?video=x84sh87&playlist=x5zhzj"
    );
    expect(p).toMatchObject({
      type: "video",
      id: "x84sh87",
      playlistId: "x5zhzj",
      playerId: "x8lr5"
    });
    expect(dm.buildEmbedSrc(p)).toBe(
      "https://geo.dailymotion.com/player/x8lr5.html?video=x84sh87&playlist=x5zhzj"
    );
  });

  it("uses the option for classic dailymotion.com links", () => {
    const p = dm.parse("https://www.dailymotion.com/playlist/x9xyz");
    expect(p.playerId).toBeNull();
    expect(dm.buildEmbedSrc(p)).toBe(
      "https://geo.dailymotion.com/player/OPT.html?playlist=x9xyz"
    );
  });
});

describe("OkruProvider", () => {
  const ok = new OkruProvider({
    embedBaseUrl: "https://okru-embed.vercel.app/?id="
  });

  it("opens its panel by default, toggle on the top right", () => {
    expect(ok.panel).toEqual({ toggle: "top-right", open: true });
  });

  it("canHandle ok.ru video urls", () => {
    expect(ok.canHandle("https://ok.ru/video/12345")).toBe(true);
    expect(ok.canHandle("https://www.ok.ru/video/12345")).toBe(true);
    expect(ok.canHandle("https://ok.ru/profile/1")).toBe(false);
  });

  it("parses single video", () => {
    expect(ok.parse("https://ok.ru/video/111")).toMatchObject({
      videoId: "111",
      itemIds: ["111"],
      initialIndex: 0
    });
  });

  it("parses playlist-like video_ids + labels + index", () => {
    const p = ok.parse(
      "https://ok.ru/video/222?video_ids=111,222,333&labels=One,Two%2C%20still%20two,Three&index=1"
    );
    expect(p.itemIds).toEqual(["111", "222", "333"]);
    expect(p.labels).toEqual(["One", "Two, still two", "Three"]);
    expect(p.initialIndex).toBe(1);
  });

  it("starts at the position of the url's video when no index is given", () => {
    const p = ok.parse("https://ok.ru/video/222?video_ids=111,222,333");
    expect(p.initialIndex).toBe(1);
  });

  it("prepends current id when missing from video_ids", () => {
    const p = ok.parse("https://ok.ru/video/999?video_ids=111,222");
    expect(p.itemIds).toEqual(["999", "111", "222"]);
  });

  it("keeps labels aligned with ids when the current id was prepended", () => {
    const p = ok.parse("https://ok.ru/video/999?video_ids=111,222&labels=A,B");
    expect(p.labels).toEqual(["", "A", "B"]);
  });

  it("buildEmbedSrc picks the right id by index", () => {
    const p = { videoId: "111", itemIds: ["111", "222", "333"], labels: [] };
    expect(ok.buildEmbedSrc(p, { index: 1 })).toBe(
      "https://okru-embed.vercel.app/?id=222"
    );
    expect(ok.buildEmbedSrc(p)).toBe("https://okru-embed.vercel.app/?id=111");
    expect(ok.buildEmbedSrc(p, { autoplay: true, index: 0 })).toContain(
      "autoplay=1"
    );
  });

  it("uses ? or & for autoplay depending on the base url", () => {
    const p = { videoId: "1", itemIds: ["1"] };
    expect(new OkruProvider().buildEmbedSrc(p, { autoplay: true })).toBe(
      "https://ok.ru/videoembed/1?autoplay=1"
    );
  });

  it("getPlaylist returns items when there are several ids", async () => {
    const items = await ok.getPlaylist({
      itemIds: ["a", "b"],
      labels: ["Title A", "Title B"]
    });
    expect(items).toEqual([
      {
        id: "a",
        index: 0,
        title: "Title A",
        channelTitle: "",
        thumbnailUrl: ""
      },
      {
        id: "b",
        index: 1,
        title: "Title B",
        channelTitle: "",
        thumbnailUrl: ""
      }
    ]);
  });

  it("getPlaylist uses generic titles without labels, and is empty for a single video", async () => {
    const items = await ok.getPlaylist({ itemIds: ["a", "b"], labels: [] });
    expect(items.map((i) => i.title)).toEqual(["Video 1", "Video 2"]);
    expect(await ok.getPlaylist({ itemIds: ["a"], labels: [] })).toEqual([]);
  });

  it("getThumbnail reads the oEmbed thumbnail, null on any failure", async () => {
    const good = new OkruProvider({
      fetchFn: vi.fn(async () =>
        jsonRes({ thumbnail_url: "https://img/x.jpg" })
      )
    });
    expect(await good.getThumbnail({ videoId: "1" })).toBe("https://img/x.jpg");

    const bad = new OkruProvider({
      fetchFn: vi.fn(async () => jsonRes({}, false, 404))
    });
    expect(await bad.getThumbnail({ videoId: "1" })).toBeNull();

    const throwing = new OkruProvider({
      fetchFn: vi.fn(async () => {
        throw new Error("offline");
      })
    });
    expect(await throwing.getThumbnail({ videoId: "1" })).toBeNull();
  });

  it("controller reloads the iframe to change video (no player api)", () => {
    const parsed = { videoId: "111", itemIds: ["111", "222"], labels: [] };
    const iframe = { src: "" };
    const c = ok.createController(iframe, { parsed });
    c.playAt(1, { autoplay: true });
    expect(iframe.src).toBe("https://okru-embed.vercel.app/?id=222&autoplay=1");
    c.playAt(0, { autoplay: false });
    expect(iframe.src).toBe("https://okru-embed.vercel.app/?id=111");
  });
});

/* ───────────────────────── registry ───────────────────────── */

describe("ProviderRegistry", () => {
  const registry = new ProviderRegistry([
    new YouTubeProvider(),
    new DailymotionProvider(),
    new OkruProvider()
  ]);

  it("resolves the correct provider", () => {
    expect(registry.resolve("https://youtu.be/abc").id).toBe("youtube");
    expect(registry.resolve("https://www.dailymotion.com/video/x1").id).toBe(
      "dailymotion"
    );
    expect(registry.resolve("https://ok.ru/video/1").id).toBe("okru");
  });

  it("resolves existing YouTube embeds", () => {
    expect(
      registry.resolve("https://www.youtube.com/embed?playlist=a,b").id
    ).toBe("youtube");
    expect(
      registry.resolve("https://www.youtube.com/embed/videoseries?list=PL1").id
    ).toBe("youtube");
    expect(
      registry.resolve("https://www.youtube-nocookie.com/embed/abc").id
    ).toBe("youtube");
  });

  it("throws UnsupportedUrlError for unknown urls", () => {
    expect(() => registry.resolve("https://vimeo.com/123")).toThrow(
      UnsupportedUrlError
    );
  });

  it("register() is chainable and the first matching provider wins", () => {
    const first = { id: "first", canHandle: () => true };
    const second = { id: "second", canHandle: () => true };
    const r = new ProviderRegistry().register(first).register(second);
    expect(r.resolve("https://anything")).toBe(first);
  });
});

/* ───────────────────────── NavigationJournal ───────────────────────── */

describe("NavigationJournal", () => {
  let journal;

  beforeEach(() => {
    journal = new NavigationJournal();
  });

  it("starts empty", () => {
    expect(journal.current).toBeNull();
    expect(journal.canGoBack).toBe(false);
    expect(journal.canGoForward).toBe(false);
    expect(journal.size).toBe(0);
  });

  it("push adds entries and moves the cursor", () => {
    journal.push({ url: "a" });
    journal.push({ url: "b" });
    expect(journal.current).toEqual({ url: "b" });
    expect(journal.size).toBe(2);
    expect(journal.canGoBack).toBe(true);
  });

  it("back / forward move the cursor without losing the branch until a new push", () => {
    journal.push({ url: "a" });
    journal.push({ url: "b" });
    journal.push({ url: "c" });

    expect(journal.back()).toEqual({ url: "b" });
    expect(journal.back()).toEqual({ url: "a" });
    expect(journal.canGoBack).toBe(false);
    expect(journal.forward()).toEqual({ url: "b" });

    // new navigation drops the forward stack
    journal.push({ url: "d" });
    expect(journal.current).toEqual({ url: "d" });
    expect(journal.canGoForward).toBe(false);
    expect(journal.size).toBe(3); // a, b, d
  });

  it("back / forward return null at the edges", () => {
    journal.push({ url: "a" });
    expect(journal.back()).toBeNull();
    expect(journal.forward()).toBeNull();
    expect(journal.current).toEqual({ url: "a" });
  });

  it("replaceCurrent patches the current entry", () => {
    journal.push({ url: "a", index: 0 });
    journal.replaceCurrent({ index: 2 });
    expect(journal.current).toEqual({ url: "a", index: 2 });
    expect(journal.size).toBe(1);
  });

  it("replaceCurrent pushes when empty", () => {
    journal.replaceCurrent({ url: "x" });
    expect(journal.current).toEqual({ url: "x" });
  });

  it("clear resets everything", () => {
    journal.push({ url: "a" });
    journal.clear();
    expect(journal.current).toBeNull();
    expect(journal.size).toBe(0);
  });
});

/* ───────────────────────── NavigationService ───────────────────────── */

describe("NavigationService", () => {
  const mkItems = (n = 3) =>
    Array.from({ length: n }, (_, i) => ({
      id: `id${i}`,
      index: i,
      title: `T${i}`,
      channelTitle: "",
      thumbnailUrl: ""
    }));
  const linkInfo = (key, extra = {}) => ({
    key,
    url: `https://fake/${key}`,
    link: null,
    startIndex: null,
    seasonCounts: null,
    ...extra
  });

  function setup({
    items = mkItems(),
    panelCfg = { toggle: "top-right", open: true },
    ...opts
  } = {}) {
    const controller = { playAt: vi.fn(), dispose: vi.fn() };
    const provider = {
      id: "fake",
      label: "Fake player",
      panel: panelCfg,
      parse: vi.fn(() => ({ initialIndex: null })),
      buildEmbedSrc: vi.fn(
        (_p, { autoplay, index }) =>
          `https://fake/embed?a=${autoplay ? 1 : 0}&i=${index}`
      ),
      getPlaylist: vi.fn(async () => items),
      createController: vi.fn(() => controller)
    };
    const view = {
      showEmbed: vi.fn(() => ({ tag: "iframe" })),
      showPanel: vi.fn(),
      setActive: vi.fn(),
      clear: vi.fn()
    };
    const onChange = vi.fn();
    const nav = new NavigationService({
      registry: { resolve: () => provider },
      view,
      onChange,
      ...opts
    });
    return { nav, provider, view, controller, onChange, items };
  }

  it("shows the embed, records the entry and notifies", async () => {
    const { nav, view, onChange } = setup();
    const info = linkInfo("a");
    await nav.navigate(info, { autoplay: true });
    expect(view.showEmbed).toHaveBeenCalledWith(
      "https://fake/embed?a=1&i=null",
      "Fake player"
    );
    expect(nav.current).toMatchObject({ key: "a", url: info.url, index: null });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ key: "a" })
    );
  });

  it("start index precedence: option > data-index > url index", async () => {
    const { nav, provider, view } = setup();
    provider.parse.mockReturnValue({ initialIndex: 4 });

    await nav.navigate(linkInfo("a"));
    expect(view.showEmbed.mock.calls.at(-1)[0]).toContain("i=4");

    await nav.navigate(linkInfo("b", { startIndex: 2 }));
    expect(view.showEmbed.mock.calls.at(-1)[0]).toContain("i=2");

    await nav.navigate(linkInfo("c", { startIndex: 2 }), { index: 0 });
    expect(view.showEmbed.mock.calls.at(-1)[0]).toContain("i=0");
  });

  it("disposes the previous controller on a new navigation", async () => {
    const { nav, controller } = setup();
    await nav.navigate(linkInfo("a"));
    await nav.navigate(linkInfo("b"));
    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it("push:false replaces the current entry instead of adding history", async () => {
    const { nav } = setup();
    await nav.navigate(linkInfo("a"));
    await nav.navigate(linkInfo("b"), { push: false });
    expect(nav.journal.size).toBe(1);
    expect(nav.current.key).toBe("b");
  });

  it("rejects with UnsupportedUrlError for unknown urls", async () => {
    const nav = new NavigationService({
      registry: new ProviderRegistry([]),
      view: {
        showEmbed: vi.fn(),
        showPanel: vi.fn(),
        setActive: vi.fn(),
        clear: vi.fn()
      }
    });
    await expect(nav.navigate(linkInfo("a"))).rejects.toBeInstanceOf(
      UnsupportedUrlError
    );
  });

  describe("panel", () => {
    it("is shown with items, active index and provider config", async () => {
      const { nav, view, provider, items } = setup();
      await nav.navigate(linkInfo("a", { seasonCounts: [2, 1] }), { index: 1 });
      expect(view.showPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          items,
          index: 1,
          cfg: provider.panel,
          seasonCounts: [2, 1],
          onSelect: expect.any(Function)
        })
      );
    });

    it("defaults to index 0 when no start index is known", async () => {
      const { nav, view } = setup();
      await nav.navigate(linkInfo("a"));
      expect(view.showPanel.mock.calls[0][0].index).toBe(0);
    });

    it("is skipped when disabled globally", async () => {
      const { nav, view } = setup({ panel: false });
      await nav.navigate(linkInfo("a"));
      expect(view.showPanel).not.toHaveBeenCalled();
    });

    it("is skipped when the provider has none", async () => {
      const { nav, view } = setup({ panelCfg: null });
      await nav.navigate(linkInfo("a"));
      expect(view.showPanel).not.toHaveBeenCalled();
    });

    it('is skipped for data-panel="false"', async () => {
      const { nav, view } = setup();
      await nav.navigate(
        linkInfo("a", { link: { dataset: { panel: "false" } } })
      );
      expect(view.showPanel).not.toHaveBeenCalled();
    });

    it("is skipped when the playlist is empty", async () => {
      const { nav, view } = setup({ items: [] });
      await nav.navigate(linkInfo("a"));
      expect(view.showPanel).not.toHaveBeenCalled();
    });

    it("a slow playlist from a superseded navigation never reaches the view", async () => {
      const { nav, provider, view } = setup();
      const slow = deferred();
      provider.getPlaylist.mockReturnValueOnce(slow.promise);

      const first = nav.navigate(linkInfo("slow"));
      await nav.navigate(linkInfo("fast"));
      expect(view.showPanel).toHaveBeenCalledTimes(1);

      slow.resolve(mkItems(2));
      await first;
      expect(view.showPanel).toHaveBeenCalledTimes(1);
    });

    it("is not shown after close() either", async () => {
      const { nav, provider, view } = setup();
      const slow = deferred();
      provider.getPlaylist.mockReturnValueOnce(slow.promise);
      const pending = nav.navigate(linkInfo("a"));
      nav.close();
      slow.resolve(mkItems());
      await pending;
      expect(view.showPanel).not.toHaveBeenCalled();
    });
  });

  describe("select", () => {
    it("plays the item, updates the view, journal and listeners", async () => {
      const { nav, view, controller, onChange } = setup();
      await nav.navigate(linkInfo("a"), { index: 0 });
      onChange.mockClear();

      nav.select(2);
      expect(controller.playAt).toHaveBeenCalledWith(2, { autoplay: true });
      expect(view.setActive).toHaveBeenCalledWith(2);
      expect(nav.current.index).toBe(2);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ index: 2 })
      );
    });

    it("ignores the already-active item", async () => {
      const { nav, controller } = setup();
      await nav.navigate(linkInfo("a"), { index: 1 });
      nav.select(1);
      expect(controller.playAt).not.toHaveBeenCalled();
    });

    it("follows changes made by the player itself (onItemChange)", async () => {
      const { nav, provider, view } = setup();
      await nav.navigate(linkInfo("a"), { index: 0 });
      provider.createController.mock.calls[0][1].onItemChange(3);
      expect(view.setActive).toHaveBeenCalledWith(3);
      expect(nav.current.index).toBe(3);
    });
  });

  describe("back / forward", () => {
    it("returns to the previous link at the episode where you were", async () => {
      const { nav, view } = setup();
      await nav.navigate(linkInfo("A"), { index: 0 });
      nav.select(2); // A, episode 2
      await nav.navigate(linkInfo("B"), { index: 1 });

      await nav.goBack();
      expect(nav.current.key).toBe("A");
      expect(view.showEmbed.mock.calls.at(-1)[0]).toBe(
        "https://fake/embed?a=1&i=2"
      );

      await nav.goForward();
      expect(nav.current.key).toBe("B");
      expect(view.showEmbed.mock.calls.at(-1)[0]).toBe(
        "https://fake/embed?a=1&i=1"
      );
      expect(nav.journal.size).toBe(2); // moving does not create history
    });

    it("returns null at the edges", async () => {
      const { nav } = setup();
      await nav.navigate(linkInfo("A"));
      expect(nav.goBack()).toBeNull();
      expect(nav.goForward()).toBeNull();
    });
  });

  describe("close", () => {
    it("clears the view and the journal and notifies with null", async () => {
      const { nav, view, controller, onChange } = setup();
      await nav.navigate(linkInfo("a"));
      nav.close();
      expect(controller.dispose).toHaveBeenCalled();
      expect(view.clear).toHaveBeenCalled();
      expect(nav.current).toBeNull();
      expect(nav.journal.size).toBe(0);
      expect(onChange).toHaveBeenLastCalledWith(null);
    });
  });

});

/* ───────────────────────── RegionView (DOM) ───────────────────────── */

describe("RegionView", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });

  const items = (n = 3, extra = {}) =>
    Array.from({ length: n }, (_, i) => ({
      id: `id${i}`,
      index: i,
      title: `Title ${i + 1}`,
      channelTitle: "",
      thumbnailUrl: "",
      ...extra
    }));
  const show = (view, o = {}) =>
    view.showPanel({
      items: items(),
      index: 0,
      cfg: { toggle: "bottom-left", open: false },
      seasonCounts: null,
      onSelect: vi.fn(),
      ...o
    });

  it("marks the container as host", () => {
    new RegionView({ container });
    expect(container.classList.contains("lp-host")).toBe(true);
  });

  describe("showEmbed", () => {
    it("creates a full-size iframe and replaces previous content", () => {
      container.innerHTML = "<p>old</p>";
      const view = new RegionView({ container });
      const f = view.showEmbed("https://x/embed", "My player");
      expect(container.children).toHaveLength(1);
      expect(container.firstElementChild).toBe(f);
      expect(f.classList.contains("lp-frame")).toBe(true);
      expect(f.getAttribute("src")).toBe("https://x/embed");
      expect(f.title).toBe("My player");
      expect(f.allowFullscreen).toBe(true);
    });

    it("removes the previous panel", () => {
      const view = new RegionView({ container });
      view.showEmbed("https://x/1", "p");
      show(view);
      view.showEmbed("https://x/2", "p");
      expect(container.querySelector(".lp-panel")).toBeNull();
      expect(container.querySelector(".lp-toggle")).toBeNull();
    });
  });

  describe("adoptIframe", () => {
    it("reuses the existing iframe (same node, new src, title kept)", () => {
      container.innerHTML =
        '<iframe src="https://www.youtube.com/embed/abc" title="Mine"></iframe>';
      const existing = container.querySelector("iframe");
      const view = new RegionView({ container });
      view.adoptIframe(existing);

      const f = view.showEmbed(
        "https://www.youtube.com/embed/abc?enablejsapi=1",
        "YouTube player"
      );
      expect(f).toBe(existing);
      expect(f.getAttribute("src")).toBe(
        "https://www.youtube.com/embed/abc?enablejsapi=1"
      );
      expect(f.title).toBe("Mine");
      expect(container.querySelectorAll("iframe")).toHaveLength(1);
    });

    it("fills a missing title", () => {
      container.innerHTML = '<iframe src="https://x/e"></iframe>';
      const existing = container.querySelector("iframe");
      const view = new RegionView({ container });
      view.adoptIframe(existing);
      expect(view.showEmbed("https://x/e?a=1", "YouTube player").title).toBe(
        "YouTube player"
      );
    });

    it("is consumed once: the next showEmbed builds a fresh iframe", () => {
      container.innerHTML = '<iframe src="https://x/e"></iframe>';
      const existing = container.querySelector("iframe");
      const view = new RegionView({ container });
      view.adoptIframe(existing);
      view.showEmbed("https://x/e", "p");
      const next = view.showEmbed("https://x/other", "p");
      expect(next).not.toBe(existing);
      expect(container.querySelectorAll("iframe")).toHaveLength(1);
    });
  });

  describe("showPanel", () => {
    describe("scrolling", () => {
      const fakeLayout = () => {
        const off = (prop, fn) =>
          vi.spyOn(HTMLElement.prototype, prop, "get").mockImplementation(fn);
        off("offsetTop", function () {
          return this.classList.contains("lp-item") ? +this.dataset.i * 50 : 0;
        });
        off("offsetHeight", function () {
          return this.classList.contains("lp-item")
            ? 50
            : this.classList.contains("lp-head")
            ? 30
            : 0;
        });
        off("clientHeight", function () {
          return this.classList.contains("lp-panel") ? 300 : 0;
        });
      };
      const open = { toggle: "top-right", open: true };

      it("centers the active item on first display", () => {
        fakeLayout();
        const view = new RegionView({ container });
        show(view, { items: items(30), index: 10, cfg: open });
        // top 500 - head 30 - (300 - 30 - 50) / 2 = 360
        expect(container.querySelector(".lp-panel").scrollTop).toBe(360);
      });

      it("does not move the panel when the user clicks an item", () => {
        fakeLayout();
        const view = new RegionView({ container });
        show(view, {
          items: items(30),
          index: 0,
          cfg: open,
          onSelect: (i) => view.setActive(i) // what NavigationService.select does
        });
        const panel = container.querySelector(".lp-panel");
        panel.scrollTop = 100;
        container.querySelectorAll(".lp-item")[5].click();
        expect(panel.scrollTop).toBe(100);
        expect(container.querySelector(".lp-active").dataset.i).toBe("5");
      });

      it("does not scroll when a player-driven change stays visible", () => {
        fakeLayout();
        const view = new RegionView({ container });
        show(view, { items: items(30), index: 0, cfg: open });
        const panel = container.querySelector(".lp-panel");
        view.setActive(3); // top 150, bottom 200: inside 30..300
        expect(panel.scrollTop).toBe(0);
      });

      it("scrolls the minimum when a player-driven change is hidden", () => {
        fakeLayout();
        const view = new RegionView({ container });
        show(view, { items: items(30), index: 0, cfg: open });
        const panel = container.querySelector(".lp-panel");
        view.setActive(8); // bottom 450 > 300 → scrollTop = 450 - 300
        expect(panel.scrollTop).toBe(150);
      });
    });

    it("renders one entry per item with the count in the header", () => {
      const view = new RegionView({ container });
      show(view);
      expect(container.querySelectorAll(".lp-item")).toHaveLength(3);
      expect(container.querySelector(".lp-head").textContent).toContain(
        "Playlist · 3"
      );
    });

    it("replaces a previous panel instead of stacking", () => {
      const view = new RegionView({ container });
      show(view);
      show(view);
      expect(container.querySelectorAll(".lp-panel")).toHaveLength(1);
      expect(container.querySelectorAll(".lp-toggle")).toHaveLength(1);
      expect(container.querySelectorAll(".lp-resize")).toHaveLength(1);
    });

    it("starts closed with a visible toggle when cfg.open is false", () => {
      const view = new RegionView({ container });
      show(view, { cfg: { toggle: "bottom-left", open: false } });
      expect(
        container.querySelector(".lp-panel").classList.contains("lp-closed")
      ).toBe(true);
      const toggle = container.querySelector(".lp-toggle");
      expect(toggle.hidden).toBe(false);
      expect(toggle.dataset.pos).toBe("bottom-left");
      expect(container.querySelector(".lp-resize").hidden).toBe(true);
    });

    it("starts open with the toggle hidden when cfg.open is true", () => {
      const view = new RegionView({ container });
      show(view, { cfg: { toggle: "top-right", open: true } });
      expect(
        container.querySelector(".lp-panel").classList.contains("lp-closed")
      ).toBe(false);
      expect(container.querySelector(".lp-toggle").hidden).toBe(true);
      expect(container.querySelector(".lp-resize").hidden).toBe(false);
    });

    it("never shows the resize handle when resizable is false", () => {
      const view = new RegionView({ container, resizable: false });
      show(view, { cfg: { toggle: "top-right", open: true } });
      expect(container.querySelector(".lp-resize").hidden).toBe(true);
    });

    it("toggle opens and close button closes", () => {
      const view = new RegionView({ container });
      show(view);
      const panel = container.querySelector(".lp-panel");
      container.querySelector(".lp-toggle").click();
      expect(panel.classList.contains("lp-closed")).toBe(false);
      container.querySelector(".lp-close").click();
      expect(panel.classList.contains("lp-closed")).toBe(true);
    });

    it("numbers items without thumbnails, shows thumbs when available", () => {
      const view = new RegionView({ container });
      show(view);
      expect(container.querySelector(".lp-num").textContent).toBe("01");
      expect(container.querySelector(".lp-thumb")).toBeNull();

      show(view, { items: items(2, { thumbnailUrl: "https://t/x.jpg" }) });
      expect(container.querySelectorAll(".lp-thumb img")).toHaveLength(2);
      expect(container.querySelector(".lp-tn").textContent).toBe("1");
    });

    it("selects on click, Enter and Space", () => {
      const onSelect = vi.fn();
      const view = new RegionView({ container });
      show(view, { onSelect });
      const nodes = container.querySelectorAll(".lp-item");
      nodes[1].click();
      nodes[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      nodes[0].dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
      nodes[0].dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      expect(onSelect.mock.calls.map((c) => c[0])).toEqual([1, 2, 0]);
    });

    it("renders titles as text, never as HTML", () => {
      const view = new RegionView({ container });
      show(view, {
        items: [{ ...items(1)[0], title: '<img src=x onerror="alert(1)">' }]
      });
      const title = container.querySelector(".lp-title");
      expect(title.querySelector("img")).toBeNull();
      expect(title.textContent).toBe('<img src=x onerror="alert(1)">');
    });

    it("marks the active item and follows setActive", () => {
      const view = new RegionView({ container });
      show(view, { index: 1 });
      const active = () =>
        [...container.querySelectorAll(".lp-item.lp-active")].map(
          (n) => n.dataset.i
        );
      expect(active()).toEqual(["1"]);
      view.setActive(2);
      expect(active()).toEqual(["2"]);
    });

    it("setActive before any panel is a no-op", () => {
      expect(() => new RegionView({ container }).setActive(1)).not.toThrow();
    });

    describe("seasons", () => {
      const seasonItems = ["S1E1", "S1E2", "S2E1", "S2E2"].map(
        (title, index) => ({
          id: `i${index}`,
          index,
          title,
          channelTitle: "",
          thumbnailUrl: ""
        })
      );

      it("groups items and collapses the sections that are not active", () => {
        const view = new RegionView({ container });
        show(view, { items: seasonItems, index: 0 });
        const sections = container.querySelectorAll(".lp-season");
        expect(sections).toHaveLength(2);
        expect(sections[0].classList.contains("lp-collapsed")).toBe(false);
        expect(sections[1].classList.contains("lp-collapsed")).toBe(true);
        expect(sections[0].querySelector(".lp-sh").textContent).toBe(
          "Season 1 (2)"
        );
      });

      it("clicking a header toggles the section", () => {
        const view = new RegionView({ container });
        show(view, { items: seasonItems, index: 0 });
        const section = container.querySelectorAll(".lp-season")[1];
        section.querySelector(".lp-sh").click();
        expect(section.classList.contains("lp-collapsed")).toBe(false);
      });

      it("setActive expands the section of the new item", () => {
        const view = new RegionView({ container });
        show(view, { items: seasonItems, index: 0 });
        view.setActive(3);
        expect(
          container
            .querySelectorAll(".lp-season")[1]
            .classList.contains("lp-collapsed")
        ).toBe(false);
      });
    });

    it("uses the saved width for the panel", () => {
      const widths = { get: vi.fn(() => 300), set: vi.fn(), clear: vi.fn() };
      const view = new RegionView({ container, widths });
      show(view);
      expect(widths.get).toHaveBeenCalled();
    });
  });

  it("clear empties the container", () => {
    const view = new RegionView({ container });
    view.showEmbed("https://x/e", "p");
    view.clear();
    expect(container.children).toHaveLength(0);
  });
});

/* ───────────────────────── LinkPlayer (integration) ───────────────────────── */

describe("LinkPlayer", () => {
  const stubScanner = (infos = []) => ({ scan: vi.fn(() => infos) });
  const mount = (html) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.append(root);
    return root;
  };
  const newPlayer = (root, opts = {}) =>
    new LinkPlayer({
      scope: root,
      scanner: stubScanner(),
      store: memoryStore(),
      useStorage: false,
      tooltip: false,
      ...opts
    });

  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  /* ───── existing embeds ───── */
  describe("existing YouTube embeds", () => {
    const IDS = "at9-Gm1-MWQ,AwaVAlMURak,GgNTzHi4xtQ,Enevxnnn114,i47QRX20un8";

    it("adopts an iframe alone in .video-container (/embed?playlist=…) without wrapping it", async () => {
      const root = mount(`
        <div class="video-container"><iframe width="560" height="315"
          src="https://www.youtube.com/embed?playlist=${IDS}"
          title="YouTube video player" frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe></div>`);
      const iframe = root.querySelector("iframe");
      const host = root.querySelector(".video-container");
      const player = newPlayer(root);

      // the host IS the existing container: its CSS keeps applying
      expect(iframe.parentElement).toBe(host);
      expect(host.classList.contains("lp-host")).toBe(true);
      expect(root.querySelector("iframe")).toBe(iframe);

      const src = new URL(iframe.getAttribute("src"));
      expect(src.pathname).toBe("/embed/videoseries");
      expect(src.searchParams.get("enablejsapi")).toBe("1");
      expect(src.searchParams.get("playlist")).toBe(IDS);

      await vi.waitFor(() =>
        expect(host.querySelector(".lp-panel")).not.toBeNull()
      );
      expect(host.querySelectorAll(".lp-item")).toHaveLength(5);
      expect(host.querySelector(".lp-toggle")).not.toBeNull();
      expect([...player._regions.keys()]).toContain("embed-1");
    });

    it("does not add inline styles to an existing container", () => {
      const root = mount(
        `<div class="video-container"><iframe src="https://www.youtube.com/embed?playlist=a,b"></iframe></div>`
      );
      newPlayer(root);
      expect(
        root.querySelector(".video-container").getAttribute("style")
      ).toBeNull();
    });

    it("wraps an iframe that has siblings, and keeps the siblings in place", async () => {
      const root = mount(`
        <section>
          <h3>A — playlist list=</h3>
          <iframe src="https://www.youtube.com/embed/videoseries?list=PLRVWztDBSD_Jh0PwXtJ0wBP0TLtHga1_Y"
                  title="YouTube playlist" allowfullscreen></iframe>
        </section>`);
      const iframe = root.querySelector("iframe");
      const fetchFn = ytFetch({ ids: ["a", "b"] });
      newPlayer(root, {
        registry: new ProviderRegistry([
          new YouTubeProvider({ apiKey: "K", fetchFn, store: memoryStore() })
        ])
      });

      const wrapper = iframe.parentElement;
      expect(wrapper.tagName).toBe("DIV");
      expect(wrapper.parentElement.tagName).toBe("SECTION");
      expect(wrapper.classList.contains("lp-host")).toBe(true);
      expect(iframe.classList.contains("lp-frame")).toBe(true);
      expect(root.querySelector("h3")).not.toBeNull();

      const src = new URL(iframe.getAttribute("src"));
      expect(src.pathname).toBe("/embed/videoseries");
      expect(src.searchParams.get("list")).toBe(
        "PLRVWztDBSD_Jh0PwXtJ0wBP0TLtHga1_Y"
      );
      expect(src.searchParams.get("enablejsapi")).toBe("1");

      await vi.waitFor(() =>
        expect(wrapper.querySelectorAll(".lp-item")).toHaveLength(2)
      );
      expect(wrapper.querySelector(".lp-title").textContent).toBe("Title a");
      expect(fetchFn.mock.calls[0][0]).toContain(
        "playlistId=PLRVWztDBSD_Jh0PwXtJ0wBP0TLtHga1_Y"
      );
      expect(wrapper.querySelector(".lp-item.lp-active").dataset.i).toBe("0");
    });

    it("wraps an iframe placed directly in the scope", () => {
      const root = mount(
        `<iframe src="https://www.youtube.com/embed?playlist=a,b"></iframe>`
      );
      const iframe = root.querySelector("iframe");
      newPlayer(root);
      expect(iframe.parentElement).not.toBe(root);
      expect(iframe.parentElement.classList.contains("lp-host")).toBe(true);
    });

    it("list= without api key: adopted but no panel, no error", async () => {
      const root = mount(`
        <p>x</p>
        <iframe src="https://www.youtube.com/embed/videoseries?list=PL1"></iframe>`);
      const onError = vi.fn();
      newPlayer(root, { onError });
      await new Promise((r) => setTimeout(r, 0));
      expect(root.querySelector(".lp-panel")).toBeNull();
      expect(onError).not.toHaveBeenCalled();
    });

    it("single video embed: no panel", async () => {
      const root = mount(
        `<div class="vc"><iframe src="https://www.youtube.com/embed/FVhqw12-BVo"></iframe></div>`
      );
      newPlayer(root);
      await new Promise((r) => setTimeout(r, 0));
      expect(root.querySelector(".lp-panel")).toBeNull();
    });

    it("ignores iframes it does not know", () => {
      const root = mount(
        `<div><iframe src="https://player.vimeo.com/video/76979871"></iframe></div>`
      );
      const before = root.innerHTML;
      const player = newPlayer(root);
      expect(root.innerHTML).toBe(before);
      expect([...player._regions.keys()]).toEqual([]);
    });

    it('ignores iframes with data-panel="false"', () => {
      const root = mount(
        `<div><iframe data-panel="false" src="https://www.youtube.com/embed?playlist=a,b"></iframe></div>`
      );
      const before = root.innerHTML;
      newPlayer(root);
      expect(root.innerHTML).toBe(before);
    });

    it("does not re-adopt on a second scan", async () => {
      const root = mount(
        `<div class="vc"><iframe src="https://www.youtube.com/embed?playlist=a,b,c"></iframe></div>`
      );
      const player = newPlayer(root);
      await vi.waitFor(() =>
        expect(root.querySelector(".lp-panel")).not.toBeNull()
      );
      player.scan();
      expect([...player._regions.keys()]).toEqual(["embed-1"]);
      expect(root.querySelectorAll(".lp-panel")).toHaveLength(1);
    });

    it("picks up iframes injected later on rescan", async () => {
      const root = mount(
        `<div class="vc"><iframe src="https://www.youtube.com/embed?playlist=a,b"></iframe></div>`
      );
      const player = newPlayer(root);
      root.insertAdjacentHTML(
        "beforeend",
        `<div class="vc2"><iframe src="https://www.youtube.com/embed?playlist=c,d"></iframe></div>`
      );
      player.scan();
      expect([...player._regions.keys()]).toEqual(["embed-1", "embed-2"]);
      await vi.waitFor(() =>
        expect(root.querySelector(".vc2 .lp-panel")).not.toBeNull()
      );
    });
  });

  /* ───── links ───── */
  describe("links", () => {
    const setup = (opts = {}) => {
      const root = mount(`
        <a id="l1" data-key="a" href="https://www.youtube.com/watch?v=abc">A</a>
        <a id="l2" data-key="b" href="https://www.youtube.com/watch?v=abc">B (same url)</a>
        <div id="t-click"></div>`);
      const mk = (id, key, o = {}) => {
        const link = root.querySelector(id);
        return {
          key,
          url: link.href,
          target: "t-click",
          link,
          autoplay: "none",
          showOnInit: false,
          startIndex: null,
          seasonCounts: null,
          ...o
        };
      };
      const infos = [mk("#l1", "a", opts.a), mk("#l2", "b", opts.b)];
      const onChange = vi.fn();
      const onError = vi.fn();
      const player = newPlayer(root, {
        scanner: stubScanner(infos),
        onChange,
        onError,
        ...opts.player
      });
      return {
        root,
        infos,
        player,
        onChange,
        onError,
        target: root.querySelector("#t-click")
      };
    };

    it("click shows the player and marks the link active", () => {
      const { root, target } = setup();
      root.querySelector("#l1").click();
      expect(target.querySelector("iframe").getAttribute("src")).toContain(
        "/embed/abc"
      );
      expect(root.querySelector("#l1").classList.contains("is-active")).toBe(
        true
      );
      expect(root.querySelector("#l2").classList.contains("is-active")).toBe(
        false
      );
    });

    it("a second click on the same link hides the player but keeps the state (autoplay none)", () => {
      const { root, target, onChange } = setup();
      root.querySelector("#l1").click();
      root.querySelector("#l1").click();
      expect(target.querySelector("iframe")).toBeNull();
      expect(root.querySelector("#l1").classList.contains("is-active")).toBe(
        false
      );
      // hidden, not closed: listeners are not told the zone was reset
      expect(onChange).not.toHaveBeenCalledWith("t-click", null);
    });

    it('a second click also hides the video with data-autoplay="click"', () => {
      const { root, target } = setup({ a: { autoplay: "click" } });
      root.querySelector("#l1").click();
      expect(target.querySelector("iframe")).not.toBeNull();
      root.querySelector("#l1").click();
      expect(target.querySelector("iframe")).toBeNull();
    });

    it("autoplay=click adds autoplay=1 to the embed", () => {
      const { root, target } = setup({ a: { autoplay: "click" } });
      root.querySelector("#l1").click();
      expect(target.querySelector("iframe").getAttribute("src")).toContain(
        "autoplay=1"
      );
    });

    it("another link with the same url but a different key navigates instead of closing", () => {
      const { root, target } = setup();
      root.querySelector("#l1").click();
      root.querySelector("#l2").click();
      expect(target.querySelector("iframe")).not.toBeNull();
      expect(root.querySelector("#l1").classList.contains("is-active")).toBe(
        false
      );
      expect(root.querySelector("#l2").classList.contains("is-active")).toBe(
        true
      );
    });

    it("reports a link without data-target and keeps going", () => {
      const root = mount(
        `<a id="x" href="https://www.youtube.com/watch?v=abc">x</a>`
      );
      const onError = vi.fn();
      newPlayer(root, {
        scanner: stubScanner([
          {
            key: "x",
            url: "https://www.youtube.com/watch?v=abc",
            target: "",
            link: root.querySelector("#x")
          }
        ]),
        onError
      });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("data-target")
        }),
        expect.objectContaining({ key: "x" })
      );
    });

    it("reports an unsupported url on click", async () => {
      const root = mount(
        `<a id="v" href="https://vimeo.com/76979871">v</a><div id="t-click"></div>`
      );
      const onError = vi.fn();
      newPlayer(root, {
        scanner: stubScanner([
          {
            key: "v",
            url: "https://vimeo.com/76979871",
            target: "t-click",
            link: root.querySelector("#v"),
            autoplay: "none",
            startIndex: null,
            seasonCounts: null
          }
        ]),
        onError
      });
      root.querySelector("#v").click();
      await vi.waitFor(() => expect(onError).toHaveBeenCalled());
      expect(onError.mock.calls[0][0]).toBeInstanceOf(UnsupportedUrlError);
    });

    it("data-show-on-init displays the link at load", () => {
      const { target } = setup({ a: { showOnInit: true } });
      expect(target.querySelector("iframe")).not.toBeNull();
    });

    it("does not bind the same link twice on rescan", () => {
      const { root, player, target } = setup();
      player.scan();
      root.querySelector("#l1").click(); // would open then close if bound twice
      expect(target.querySelector("iframe")).not.toBeNull();
    });
  });

  /* ───── storage ───── */
  describe("storage", () => {
    const url = "https://www.youtube.com/watch?v=abc&list=PLx";
    const build = (store, extra = {}) => {
      const root = mount(
        `<a id="l" href="${url}">l</a><div id="t-click"></div>`
      );
      const info = {
        key: "a",
        url,
        target: "t-click",
        link: root.querySelector("#l"),
        autoplay: "always",
        showOnInit: false,
        startIndex: null,
        seasonCounts: null,
        ...extra
      };
      const player = newPlayer(root, {
        scanner: stubScanner([info]),
        store,
        useStorage: true
      });
      return { root, player, target: root.querySelector("#t-click") };
    };

    it("restores the saved link and episode, paused", () => {
      const store = memoryStore();
      store.set("state:t-click", { key: "a", url, index: 3 });
      const { target } = build(store);
      const src = target.querySelector("iframe").getAttribute("src");
      expect(src).toContain("index=3");
      expect(src).not.toContain("autoplay=1");
    });

    it("saves on navigation, keeps the save when hidden, clears it on close", () => {
      const store = memoryStore();
      const { root, player } = build(store);
      root.querySelector("#l").click();
      expect(store.get("state:t-click")).toMatchObject({ key: "a", url });

      root.querySelector("#l").click(); // hide
      expect(store.get("state:t-click")).toMatchObject({ key: "a", url });

      player.getRegion("t-click").navigationService.close();
      expect(store.get("state:t-click")).toBeNull();
    });

    it("useStorage:false never touches localStorage", () => {
      const spy = vi.spyOn(Storage.prototype, "setItem");
      const root = mount(`<div id="t"></div>`);
      new LinkPlayer({
        scope: root,
        scanner: stubScanner(),
        useStorage: false,
        tooltip: false
      });
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe("MemoryStore", () => {
  it("stores, expires and removes like JsonStore", () => {
    vi.useFakeTimers();
    const s = new MemoryStore();
    s.set("a", { x: 1 });
    s.set("tmp", "v", 1000);
    expect(s.get("a")).toEqual({ x: 1 });
    vi.advanceTimersByTime(1001);
    expect(s.get("tmp")).toBeNull();
    s.remove("a");
    expect(s.get("a")).toBeNull();
  });
});
