// @vitest-environment jsdom
import { AUTOPLAY_MODES } from "../src/converters.js";
import {
  LinkScanner,
  readRawLink,
  DATA_ATTRIBUTES
} from "../src/linkScanner.js";

const html = (s) => {
  document.body.innerHTML = s;
  return document.body;
};

describe("LinkScanner on real HTML", () => {
  it("maps every kebab-case data attribute to its dataset key", () => {
    const root = html(`
            <a data-link href="https://ok.ru/video/1"
               data-key="k" data-url="https://ok.ru/video/2" data-target="player"
               data-autoplay data-show-on-init data-index="3"
               data-seasons="12,26" data-thumbnail="t.jpg">Ep</a>`);

    const raw = readRawLink(root.querySelector("[data-link]"));

    expect(raw).toEqual({
      key: "k",
      dataUrl: "https://ok.ru/video/2",
      href: "https://ok.ru/video/1",
      target: "player",
      autoplay: "",
      showOnInit: "",
      index: "3",
      seasons: "12,26",
      thumbnail: "t.jpg"
    });
  });

  it("parses every attribute end to end", () => {
    const root = html(`
            <a data-link data-key="k" data-target="player" data-autoplay="click" data-show-on-init
               data-index="3" data-seasons="12,26" data-thumbnail="t.jpg"
               href="https://ok.ru/video/1">Ep</a>`);

    const [info] = new LinkScanner().scan(root);

    expect(info).toMatchObject({
      key: "k",
      url: "https://ok.ru/video/1",
      target: "player",
      autoplay: "click",
      showOnInit: true,
      startIndex: 3,
      seasonCounts: [12, 26],
      thumbnail: "t.jpg"
    });
  });

  it.each([
    ["", AUTOPLAY_MODES.INIT],
    ['="true"', AUTOPLAY_MODES.INIT],
    ['="TRUE"', AUTOPLAY_MODES.INIT],
    ['="click"', AUTOPLAY_MODES.CLICK],
    ['=" Click "', AUTOPLAY_MODES.CLICK],
    ['="none"', AUTOPLAY_MODES.NONE],
    ['="false"', AUTOPLAY_MODES.NONE],
    ['="nimportequoi"', AUTOPLAY_MODES.NONE]
  ])("reads data-autoplay%s as %s from real HTML", (suffix, expected) => {
    const root = html(
      `<a data-link data-autoplay${suffix} href="https://ok.ru/video/1">Ep</a>`
    );
    expect(new LinkScanner().scan(root)[0].autoplay).toBe(expected);
  });
  
  it("defaults to none when data-autoplay is absent", () => {
    const root = html(`<a data-link href="https://ok.ru/video/1">Ep</a>`);
    expect(new LinkScanner().scan(root)[0].autoplay).toBe(AUTOPLAY_MODES.NONE);
  });

  it('defaults to "none" when data-autoplay is absent', () => {
    const root = html(`<a data-link href="https://ok.ru/video/1">Ep</a>`);
    expect(new LinkScanner().scan(root)[0].autoplay).toBe("none");
  });

  it("exposes the real DOM element", () => {
    const root = html(
      `<a data-link id="x" href="https://ok.ru/video/1">Ep</a>`
    );
    expect(new LinkScanner().scan(root)[0].link).toBe(root.querySelector("#x"));
  });

  it("supports non-anchor elements with data-url", () => {
    const root = html(
      `<button data-link data-url="https://ok.ru/video/2">Go</button>`
    );
    expect(new LinkScanner().scan(root)[0].key).toBe("ok.ru/video/2");
  });

  it("ignores elements without data-link", () => {
    const root = html(`<a href="https://ok.ru/video/1">No</a>`);
    expect(new LinkScanner().scan(root)).toEqual([]);
  });

  it("respects the scope", () => {
    html(`
            <div id="zone"><a data-link href="https://ok.ru/video/1">In</a></div>
            <a data-link href="https://ok.ru/video/2">Out</a>`);
    const zone = document.querySelector("#zone");
    expect(new LinkScanner().scan(zone)).toHaveLength(1);
    expect(new LinkScanner().scan(document)).toHaveLength(2);
  });

  it("throws on a source without any url", () => {
    const root = html(`<button data-link>No url</button>`);
    expect(() => new LinkScanner().scan(root)).toThrow();
  });

  it("has a dataset key for each declared attribute", () => {
    // Guards against a typo in DATA_ATTRIBUTES (e.g. "showoninit")
    const el = document.createElement("div");
    el.setAttribute("data-show-on-init", "");
    expect(el.dataset[DATA_ATTRIBUTES.showOnInit]).toBe("");
  });
});
