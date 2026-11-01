// src/linkPlayer.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";
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
} from "../src/linkPlayer.js"; 

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
    div.remove();
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
      removeItem: (k) => memory.delete(k),
    };
    store = new JsonStore({ storage: fakeStorage, prefix: "test:" });
  });

  it("stores and retrieves data", () => {
    store.set("a", { x: 1 });
    expect(store.get("a")).toEqual({ x: 1 });
  });

  it("returns null for missing keys", () => {
    expect(store.get("missing")).toBeNull();
  });

  it("expires entries after ttl", () => {
    vi.useFakeTimers();
    store.set("tmp", "value", 1000);
    expect(store.get("tmp")).toBe("value");
    vi.advanceTimersByTime(1001);
    expect(store.get("tmp")).toBeNull();
    vi.useRealTimers();
  });

  it("remove deletes the key", () => {
    store.set("a", 1);
    store.remove("a");
    expect(store.get("a")).toBeNull();
  });

  it("never throws on broken storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    const s = new JsonStore({ storage: broken });
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
    const items = titles(
      "S01E01 Pilot",
      "S01E02 Next",
      "Season 2 Episode 1",
      "S2E2",
      "Bonus"
    );
    const groups = groupBySeason(items);
    expect(groups).toEqual([
        { key: 1, label: "Season 1", start: 0, end: 2 },
        { key: 2, label: "Season 2", start: 2, end: 5 },
      ]);
  });

  it("uses provided season counts when available", () => {
    const items = titles("a", "b", "c", "d", "e");
    const groups = groupBySeason(items, [2, 2]);
    expect(groups).toEqual([
      { label: "Season 1", start: 0, end: 2 },
      { label: "Season 2", start: 2, end: 4 },
      { label: "Other", start: 4, end: 5 },
    ]);
  });

  it("returns null when counts produce a single group", () => {
    expect(groupBySeason(titles("a", "b"), [2])).toBeNull();
  });
});

/* ───────────────────────── providers ───────────────────────── */

describe("YouTubeProvider", () => {
  const yt = new YouTubeProvider({ apiKey: null, origin: "https://example.com" });

  describe("canHandle", () => {
    it.each([
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", true],
      ["https://youtu.be/dQw4w9WgXcQ", true],
      ["https://www.youtube.com/watch_videos?video_ids=aaa,bbb", true],
      ["https://www.youtube.com/playlist?list=PLxxx", false],
      ["https://vimeo.com/123", false],
      ["not-a-url", false],
    ])("%s → %s", (url, expected) => {
      expect(yt.canHandle(url)).toBe(expected);
    });
  });

  describe("parse", () => {
    it("parses watch url", () => {
      const p = yt.parse("https://www.youtube.com/watch?v=abc123&list=PLxyz&t=42&index=3");
      expect(p).toMatchObject({
        videoId: "abc123",
        playlistId: "PLxyz",
        startSeconds: 42,
        initialIndex: 2, // 1-based → 0-based
      });
    });

    it("parses youtu.be", () => {
      expect(yt.parse("https://youtu.be/xyz").videoId).toBe("xyz");
    });

    it("parses video_ids list", () => {
      const p = yt.parse("https://www.youtube.com/watch_videos?video_ids=a,b,c");
      expect(p.videoIds).toEqual(["a", "b", "c"]);
    });
  });

  describe("buildEmbedSrc", () => {
    it("builds a single video embed", () => {
      const src = yt.buildEmbedSrc(
        { videoId: "abc", playlistId: null, videoIds: null, startSeconds: 10 },
        { autoplay: true }
      );
      expect(src).toContain("https://www.youtube.com/embed/abc?");
      expect(src).toContain("autoplay=1");
      expect(src).toContain("start=10");
      expect(src).toContain("origin=https%3A%2F%2Fexample.com");
    });

    it("builds a playlist embed with index", () => {
      const src = yt.buildEmbedSrc(
        { videoId: null, playlistId: "PLxyz", videoIds: null, startSeconds: null },
        { index: 2 }
      );
      expect(src).toContain("/embed/videoseries?");
      expect(src).toContain("list=PLxyz");
      expect(src).toContain("index=2");
    });
  });
});

describe("DailymotionProvider", () => {
  const dm = new DailymotionProvider({ playerId: "PLAYER123" });

  it("canHandle video and playlist urls", () => {
    expect(dm.canHandle("https://www.dailymotion.com/video/x8abc")).toBe(true);
    expect(dm.canHandle("https://www.dailymotion.com/playlist/x9xyz")).toBe(true);
    expect(dm.canHandle("https://youtube.com/watch?v=1")).toBe(false);
  });

  it("parses video and playlist", () => {
    expect(dm.parse("https://www.dailymotion.com/video/x8abc")).toMatchObject({
      type: "video",
      id: "x8abc",
    });
    expect(dm.parse("https://www.dailymotion.com/playlist/x9xyz")).toMatchObject({
      type: "playlist",
      id: "x9xyz",
      playlistId: "x9xyz",
    });
  });

  it("buildEmbedSrc uses player id when present", () => {
    const src = dm.buildEmbedSrc(
      { type: "video", id: "x8abc", playlistId: null },
      { autoplay: true }
    );
    expect(src).toBe(
      "https://geo.dailymotion.com/player/PLAYER123.html?video=x8abc&autoplay=true"
    );
  });
});

describe("OkruProvider", () => {
  const ok = new OkruProvider({
    embedBaseUrl: "https://okru-embed.vercel.app/?id=",
  });

  it("canHandle ok.ru video urls", () => {
    expect(ok.canHandle("https://ok.ru/video/12345")).toBe(true);
    expect(ok.canHandle("https://www.ok.ru/video/12345")).toBe(true);
    expect(ok.canHandle("https://ok.ru/profile/1")).toBe(false);
  });

  it("parses single video", () => {
    const p = ok.parse("https://ok.ru/video/111");
    expect(p).toMatchObject({
      videoId: "111",
      itemIds: ["111"],
      initialIndex: 0,
    });
  });

  it("parses playlist-like video_ids + labels + index", () => {
    const url =
      "https://ok.ru/video/222?video_ids=111,222,333&labels=One,Two%2C%20still%20two,Three&index=1";
    const p = ok.parse(url);
    expect(p.itemIds).toEqual(["111", "222", "333"]);
    expect(p.labels).toEqual(["One", "Two, still two", "Three"]);
    expect(p.initialIndex).toBe(1);
  });

  it("prepends current id when missing from video_ids", () => {
    const p = ok.parse("https://ok.ru/video/999?video_ids=111,222");
    expect(p.itemIds).toEqual(["999", "111", "222"]);
  });

  it("buildEmbedSrc picks the right id by index", () => {
    const p = {
      videoId: "111",
      itemIds: ["111", "222", "333"],
      labels: [],
    };
    expect(ok.buildEmbedSrc(p, { index: 1 })).toBe(
      "https://okru-embed.vercel.app/?id=222"
    );
    expect(ok.buildEmbedSrc(p, { autoplay: true, index: 0 })).toContain(
      "autoplay=1"
    );
  });

  it("getPlaylist returns items when there are several ids", async () => {
    const p = {
      itemIds: ["a", "b"],
      labels: ["Title A", "Title B"],
    };
    const items = await ok.getPlaylist(p);
    expect(items).toEqual([
      { id: "a", index: 0, title: "Title A", channelTitle: "", thumbnailUrl: "" },
      { id: "b", index: 1, title: "Title B", channelTitle: "", thumbnailUrl: "" },
    ]);
  });
});

/* ───────────────────────── registry ───────────────────────── */

describe("ProviderRegistry", () => {
  const registry = new ProviderRegistry([
    new YouTubeProvider(),
    new DailymotionProvider(),
    new OkruProvider(),
  ]);

  it("resolves the correct provider", () => {
    expect(registry.resolve("https://youtu.be/abc").id).toBe("youtube");
    expect(registry.resolve("https://www.dailymotion.com/video/x1").id).toBe(
      "dailymotion"
    );
    expect(registry.resolve("https://ok.ru/video/1").id).toBe("okru");
  });

  it("throws UnsupportedUrlError for unknown urls", () => {
    expect(() => registry.resolve("https://vimeo.com/123")).toThrow(
      UnsupportedUrlError
    );
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

  it("replaceCurrent patches the current entry", () => {
    journal.push({ url: "a", index: 0 });
    journal.replaceCurrent({ index: 2 });
    expect(journal.current).toEqual({ url: "a", index: 2 });
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