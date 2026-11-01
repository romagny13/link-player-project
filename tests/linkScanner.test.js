import { AUTOPLAY_MODES } from "../src/converters.js";
import {
  DATA_ATTRIBUTES,
  LINK_SELECTOR,
  InvalidUrlError,
  assertValidUrl,
  keyFromUrl,
  readRawLink,
  parseLink,
  LinkScanner
} from "../src/linkScanner.js";

const { NONE, INIT, CLICK } = AUTOPLAY_MODES;

// Minimal valid raw source, overridden per test
const raw = (overrides = {}) => ({
  href: "https://ok.ru/video/1",
  ...overrides
});

// Fake element: only dataset + getAttribute are needed
const fakeEl = ({ href = "https://ok.ru/video/1", ...data } = {}) => ({
  dataset: data,
  getAttribute: (name) => (name === "href" ? href : null)
});

const fakeRoot = (...els) => ({ querySelectorAll: () => els });

describe("constants", () => {
  it("exposes the selector", () => {
    expect(LINK_SELECTOR).toBe("[data-link]");
  });

  it("freezes DATA_ATTRIBUTES", () => {
    expect(Object.isFrozen(DATA_ATTRIBUTES)).toBe(true);
  });

  it("lists every supported attribute", () => {
    expect(Object.keys(DATA_ATTRIBUTES).sort()).toEqual([
      "autoplay",
      "index",
      "key",
      "seasons",
      "showOnInit",
      "target",
      "thumbnail",
      "url"
    ]);
  });
});

describe("InvalidUrlError", () => {
  it("is an Error with the right name and message", () => {
    const e = new InvalidUrlError("x");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("InvalidUrlError");
    expect(e.message).toBe("x");
  });
});

describe("assertValidUrl", () => {
  it.each([[undefined], [null], [""], ["   "]])(
    "throws on empty value %j",
    (v) => {
      expect(() => assertValidUrl(v)).toThrow(InvalidUrlError);
    }
  );

  it.each([["not a url"], ["/video/1"], ["ok.ru/video/1"]])(
    "throws on malformed url %j",
    (v) => {
      expect(() => assertValidUrl(v)).toThrow(InvalidUrlError);
    }
  );

  it("returns the trimmed url when valid", () => {
    expect(assertValidUrl("  https://ok.ru/video/1 ")).toBe(
      "https://ok.ru/video/1"
    );
  });
});

describe("keyFromUrl", () => {
  const OK_ID = "6806953659125";
  const IDS = [OK_ID, "6806954052341", "6812121631477", "6812122483445"].join(",");
  const longOk = (labels = "Episode%2054,Episode%2055,Episode%2056,Episode%2057") =>
    `https://ok.ru/video/${OK_ID}?video_ids=${IDS}&labels=${labels}`;

  describe("path and normalization", () => {
    it("is host + pathname when there is no query", () => {
      expect(keyFromUrl("https://ok.ru/video/1")).toBe("ok.ru/video/1");
    });

    it("strips the www prefix", () => {
      expect(keyFromUrl("https://www.ok.ru/video/1")).toBe("ok.ru/video/1");
    });

    it("ignores the hash, with or without a query", () => {
      expect(keyFromUrl("https://ok.ru/video/1#t=5")).toBe("ok.ru/video/1");
      expect(keyFromUrl("https://ok.ru/video/1?x=1#t=5")).toBe("ok.ru/video/1?x=1");
    });

    it("trims the url", () => {
      expect(keyFromUrl("  https://ok.ru/video/1 ")).toBe("ok.ru/video/1");
    });

    it.each([[""], [null], ["not a url"]])(
      "throws InvalidUrlError on %j",
      (v) => {
        expect(() => keyFromUrl(v)).toThrow(InvalidUrlError);
      }
    );
  });

  describe("short queries", () => {
    it("are kept, readable and decoded", () => {
      expect(keyFromUrl("https://ok.ru/video/1?video_ids=1,2")).toBe(
        "ok.ru/video/1?video_ids=1,2"
      );
      expect(keyFromUrl("https://ok.ru/video/1?labels=Episode%2054")).toBe(
        "ok.ru/video/1?labels=Episode 54"
      );
    });

    it("tell YouTube videos apart", () => {
      const a = keyFromUrl("https://www.youtube.com/watch?v=YCfcg9gzCYc");
      const b = keyFromUrl("https://www.youtube.com/watch?v=69iUWLA0oVc");
      expect(a).toBe("youtube.com/watch?v=YCfcg9gzCYc");
      expect(a).not.toBe(b);
    });

    it("ignore parameter order", () => {
      expect(keyFromUrl("https://www.youtube.com/watch?v=A&list=L")).toBe(
        keyFromUrl("https://youtube.com/watch?list=L&v=A")
      );
    });

    it("keep repeated parameters in their original order", () => {
      expect(keyFromUrl("https://x.io/p?t=2&t=1")).toBe("x.io/p?t=2&t=1");
    });
  });

  describe("long queries", () => {
    const HASHED = /^ok\.ru\/video\/\d+\?#[0-9a-z]+$/;

    it("are condensed into a short hash", () => {
      const key = keyFromUrl(longOk());
      expect(key).toMatch(HASHED);
      expect(key.startsWith(`ok.ru/video/${OK_ID}?#`)).toBe(true);
      expect(key.length).toBeLessThan(40);
      expect(key).not.toContain("labels");
    });

    it("are stable: the same url always gives the same key", () => {
      expect(keyFromUrl(longOk())).toBe(keyFromUrl(longOk()));
    });

    it("differ when only the labels differ", () => {
      expect(keyFromUrl(longOk("Episode%2054,B,C,D"))).not.toBe(
        keyFromUrl(longOk("Episode%2099,B,C,D"))
      );
    });

    it("differ when only the id list differs", () => {
      const other = `https://ok.ru/video/${OK_ID}?video_ids=${IDS},999&labels=Episode%2054,Episode%2055,Episode%2056,Episode%2057`;
      expect(keyFromUrl(other)).not.toBe(keyFromUrl(longOk()));
    });

    it("ignore parameter order", () => {
      const swapped = `https://ok.ru/video/${OK_ID}?labels=Episode%2054,Episode%2055,Episode%2056,Episode%2057&video_ids=${IDS}`;
      expect(keyFromUrl(swapped)).toBe(keyFromUrl(longOk()));
    });

    it("ignore www, hash and surrounding spaces", () => {
      const variant = ` ${longOk().replace("https://ok.ru", "https://www.ok.ru")}#t=5 `;
      expect(keyFromUrl(variant)).toBe(keyFromUrl(longOk()));
    });

    it("hash the decoded query, so encoding variants match", () => {
      const encoded = `https://ok.ru/video/${OK_ID}?video_ids=${IDS.replaceAll(",", "%2C")}&labels=Episode%2054%2CEpisode%2055%2CEpisode%2056%2CEpisode%2057`;
      expect(keyFromUrl(encoded)).toBe(keyFromUrl(longOk()));
    });

    it("keeps the path, so different videos never collide", () => {
      const a = keyFromUrl(longOk());
      const b = keyFromUrl(longOk().replace(`/video/${OK_ID}`, "/video/111"));
      expect(a).not.toBe(b);
    });
  });

  describe("threshold", () => {
    const withQuery = (n) => `https://x.io/p?a=${"x".repeat(n - 2)}`; // query is exactly n chars

    it("keeps a query of 48 characters as is", () => {
      expect(keyFromUrl(withQuery(48))).toBe(`x.io/p?a=${"x".repeat(46)}`);
    });

    it("hashes a query of 49 characters", () => {
      expect(keyFromUrl(withQuery(49))).toMatch(/^x\.io\/p\?#[0-9a-z]+$/);
    });
  });
});

describe("readRawLink", () => {
  it("copies every data attribute without interpreting it", () => {
    const el = fakeEl({
      key: " k ",
      url: "https://data",
      target: "player",
      autoplay: "",
      showOnInit: "false",
      index: "abc",
      seasons: "12,x",
      thumbnail: "t.jpg",
      href: "https://href"
    });
    expect(readRawLink(el)).toEqual({
      key: " k ",
      dataUrl: "https://data",
      href: "https://href",
      target: "player",
      autoplay: "",
      showOnInit: "false",
      index: "abc",
      seasons: "12,x",
      thumbnail: "t.jpg"
    });
  });

  it("keeps data-url and href separate", () => {
    const r = readRawLink(
      fakeEl({ url: "https://data", href: "https://href" })
    );
    expect(r.dataUrl).toBe("https://data");
    expect(r.href).toBe("https://href");
  });

  it("leaves absent attributes undefined", () => {
    const r = readRawLink(fakeEl({ href: null }));
    expect(r.key).toBeUndefined();
    expect(r.dataUrl).toBeUndefined();
    expect(r.href).toBeUndefined();
    expect(r.autoplay).toBeUndefined();
  });

  it("does not crash on an element without dataset", () => {
    expect(() =>
      readRawLink({ getAttribute: () => "https://x" })
    ).not.toThrow();
  });

  it("does not crash on an element without getAttribute", () => {
    expect(readRawLink({ dataset: { url: "https://x" } }).href).toBeUndefined();
  });
});

describe("parseLink", () => {
  describe("url", () => {
    it("uses href when there is no data-url", () => {
      expect(parseLink(raw()).url).toBe("https://ok.ru/video/1");
    });

    it("prefers data-url over href", () => {
      expect(parseLink(raw({ dataUrl: "https://ok.ru/video/5" })).url).toBe(
        "https://ok.ru/video/5"
      );
    });

    it("falls back to href when data-url is blank", () => {
      expect(parseLink(raw({ dataUrl: "  " })).url).toBe(
        "https://ok.ru/video/1"
      );
    });

    it("works with data-url only (button)", () => {
      expect(parseLink({ dataUrl: "https://ok.ru/video/7" }).url).toBe(
        "https://ok.ru/video/7"
      );
    });

    it("trims the url", () => {
      expect(parseLink(raw({ href: " https://ok.ru/video/1 " })).url).toBe(
        "https://ok.ru/video/1"
      );
    });

    it("throws when there is no url at all", () => {
      expect(() => parseLink({})).toThrow(InvalidUrlError);
    });

    it("throws when href and data-url are blank", () => {
      expect(() => parseLink({ dataUrl: " ", href: "" })).toThrow(
        InvalidUrlError
      );
    });

    it("throws when the url is malformed", () => {
      expect(() => parseLink({ href: "/video/1" })).toThrow(InvalidUrlError);
    });
  });

  describe("key", () => {
    it("generates the key from the url by default", () => {
      const info = parseLink(
        raw({ href: "https://www.ok.ru/video/9?video_ids=9,10" })
      );
      expect(info.key).toBe("ok.ru/video/9?video_ids=9,10");
    });

    it("prefers the explicit key", () => {
      expect(parseLink(raw({ key: "hartley" })).key).toBe("hartley");
    });

    it("trims the explicit key", () => {
      expect(parseLink(raw({ key: "  hartley " })).key).toBe("hartley");
    });

    it("generates the key when the explicit key is blank", () => {
      expect(parseLink(raw({ key: "   " })).key).toBe("ok.ru/video/1");
    });
    it("changes when playlist episodes are added (the url is the identity)", () => {
      const a = parseLink(raw({ href: "https://ok.ru/video/1?video_ids=1,2" }));
      const b = parseLink(raw({ href: "https://ok.ru/video/1?video_ids=1,2,3" }));
      expect(a.key).not.toBe(b.key);
    });
    
    it("keeps an explicit data-key stable when the playlist changes", () => {
      const a = parseLink(
        raw({ href: "https://ok.ru/video/1?video_ids=1,2", key: "ep-list" })
      );
      const b = parseLink(
        raw({ href: "https://ok.ru/video/1?video_ids=1,2,3", key: "ep-list" })
      );
      expect(a.key).toBe("ep-list");
      expect(b.key).toBe(a.key);
    });
  });

  describe("target", () => {
    it("keeps the id", () =>
      expect(parseLink(raw({ target: "player" })).target).toBe("player"));
    it("trims", () =>
      expect(parseLink(raw({ target: " player " })).target).toBe("player"));
    it("is null when blank", () =>
      expect(parseLink(raw({ target: " " })).target).toBeNull());
    it("is null when absent", () => expect(parseLink(raw()).target).toBeNull());
  });

  describe("showOnInit (boolean)", () => {
    it("is false when absent", () =>
      expect(parseLink(raw()).showOnInit).toBe(false));
    it("is true when the attribute is present (empty string)", () =>
      expect(parseLink(raw({ showOnInit: "" })).showOnInit).toBe(true));
    it('is true for "true"', () =>
      expect(parseLink(raw({ showOnInit: "true" })).showOnInit).toBe(true));
    it('is false for "false"', () =>
      expect(parseLink(raw({ showOnInit: "false" })).showOnInit).toBe(false));
    it('is false for "0"', () =>
      expect(parseLink(raw({ showOnInit: "0" })).showOnInit).toBe(false));
  });

  describe("autoplay (mode)", () => {
    it('is "none" when absent', () =>
      expect(parseLink(raw()).autoplay).toBe(NONE));

    it('is "init" when the attribute is present (empty string)', () =>
      expect(parseLink(raw({ autoplay: "" })).autoplay).toBe(INIT));

    it('is "init" for "true"', () =>
      expect(parseLink(raw({ autoplay: "true" })).autoplay).toBe(INIT));

    it('is "click" for "click"', () =>
      expect(parseLink(raw({ autoplay: "click" })).autoplay).toBe(CLICK));

    it('is "none" for "none", "false" and "0"', () => {
      expect(parseLink(raw({ autoplay: "none" })).autoplay).toBe(NONE);
      expect(parseLink(raw({ autoplay: "false" })).autoplay).toBe(NONE);
      expect(parseLink(raw({ autoplay: "0" })).autoplay).toBe(NONE);
    });

    it('falls back to "none" for an unknown value', () => {
      expect(parseLink(raw({ autoplay: "clik" })).autoplay).toBe(NONE);
      expect(parseLink(raw({ autoplay: "always" })).autoplay).toBe(NONE); // legacy value
    });

    it("is case and space insensitive", () => {
      expect(parseLink(raw({ autoplay: " CLICK " })).autoplay).toBe(CLICK);
      expect(parseLink(raw({ autoplay: " TRUE " })).autoplay).toBe(INIT);
    });
  });

  describe("startIndex (data-index)", () => {
    it("is null when absent", () =>
      expect(parseLink(raw()).startIndex).toBeNull());
    it("converts to a number", () =>
      expect(parseLink(raw({ index: "4" })).startIndex).toBe(4));
    it("accepts zero", () =>
      expect(parseLink(raw({ index: "0" })).startIndex).toBe(0));
    it("is null when not numeric", () =>
      expect(parseLink(raw({ index: "abc" })).startIndex).toBeNull());
    it("is null when negative", () =>
      expect(parseLink(raw({ index: "-1" })).startIndex).toBeNull());
    it("is null when decimal", () =>
      expect(parseLink(raw({ index: "1.5" })).startIndex).toBeNull());
  });

  describe("seasonCounts (data-seasons)", () => {
    it("is null when absent", () =>
      expect(parseLink(raw()).seasonCounts).toBeNull());
    it("splits into numbers", () => {
      expect(parseLink(raw({ seasons: "12, 26,26" })).seasonCounts).toEqual([
        12, 26, 26
      ]);
    });
    it("ignores invalid and zero entries", () => {
      expect(parseLink(raw({ seasons: "12,x,0,5" })).seasonCounts).toEqual([
        12, 5
      ]);
    });
    it("is null when nothing is usable", () => {
      expect(parseLink(raw({ seasons: "x,y" })).seasonCounts).toBeNull();
    });
  });

  describe("thumbnail", () => {
    it("keeps the value", () =>
      expect(parseLink(raw({ thumbnail: "t.jpg" })).thumbnail).toBe("t.jpg"));
    it("is null when blank", () =>
      expect(parseLink(raw({ thumbnail: " " })).thumbnail).toBeNull());
    it("is null when absent", () =>
      expect(parseLink(raw()).thumbnail).toBeNull());
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(parseLink(raw()))).toBe(true);
  });

  it("applies every default for a minimal source", () => {
    expect(parseLink(raw())).toEqual({
      url: "https://ok.ru/video/1",
      key: "ok.ru/video/1",
      target: null,
      autoplay: "none",
      showOnInit: false,
      startIndex: null,
      seasonCounts: null,
      thumbnail: null
    });
  });
});

describe("LinkScanner", () => {
  const scanner = new LinkScanner();

  describe("findLinks", () => {
    it("queries with the selector", () => {
      const querySelectorAll = vi.fn(() => []);
      scanner.findLinks({ querySelectorAll });
      expect(querySelectorAll).toHaveBeenCalledWith(LINK_SELECTOR);
    });
  });

  describe("scan", () => {
    it("returns one SourceInfo per element, in document order", () => {
      const root = fakeRoot(
        fakeEl({ href: "https://ok.ru/video/2" }),
        fakeEl({ href: "https://ok.ru/video/1" })
      );
      expect(scanner.scan(root).map((i) => i.key)).toEqual([
        "ok.ru/video/2",
        "ok.ru/video/1"
      ]);
    });

    it("keeps a reference to each source element", () => {
      const a = fakeEl();
      expect(scanner.scan(fakeRoot(a))[0].link).toBe(a);
    });

    it("returns parsed values, not raw ones", () => {
      const [info] = scanner.scan(
        fakeRoot(fakeEl({ autoplay: "click", index: "3" }))
      );
      expect(info).toMatchObject({ autoplay: "click", startIndex: 3 });
    });

    it("returns frozen objects", () => {
      expect(Object.isFrozen(scanner.scan(fakeRoot(fakeEl()))[0])).toBe(true);
    });

    it("returns an empty array when there is no element", () => {
      expect(scanner.scan(fakeRoot())).toEqual([]);
    });

    it("lets the exception of an invalid element bubble up", () => {
      expect(() =>
        scanner.scan(fakeRoot(fakeEl(), fakeEl({ href: null })))
      ).toThrow(InvalidUrlError);
    });

    it("does not deduplicate keys (current behavior)", () => {
      expect(
        scanner.scan(fakeRoot(fakeEl(), fakeEl())).map((i) => i.key)
      ).toEqual(["ok.ru/video/1", "ok.ru/video/1"]);
    });
  });
});
