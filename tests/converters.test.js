import {
  toBool,
  toIntOrNull,
  toIntList,
  toStringOrNull,
  toAutoplayMode,
  shouldAutoplay,
  AUTOPLAY_MODES
} from "../src/converters.js";

describe("AUTOPLAY_MODES", () => {
  it("exposes the three modes", () => {
    expect(AUTOPLAY_MODES).toEqual({
      NONE: "none",
      CLICK: "click",
      ALWAYS: "always"
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(AUTOPLAY_MODES)).toBe(true);
  });
});

describe("toAutoplayMode", () => {
  it.each([
    // attribute absent
    [undefined, "none"],
    [null, "none"],
    // attribute present without value, or truthy aliases
    ["", "always"],
    ["true", "always"],
    ["always", "always"],
    [" ALWAYS ", "always"],
    ["TRUE", "always"],
    // click
    ["click", "click"],
    ["CLICK", "click"],
    [" click ", "click"],
    // explicit none, falsy aliases, unknown values
    ["none", "none"],
    ["false", "none"],
    ["0", "none"],
    ["clik", "none"],
    ["nonsense", "none"]
  ])("%j -> %j", (input, expected) =>
    expect(toAutoplayMode(input)).toBe(expected)
  );
});

describe("shouldAutoplay", () => {
  it.each([
    ["none", "init", false],
    ["none", "click", false],
    ["click", "init", false],
    ["click", "click", true],
    ["always", "init", true],
    ["always", "click", true]
  ])("mode %s on %s -> %s", (mode, trigger, expected) => {
    expect(shouldAutoplay(mode, trigger)).toBe(expected);
  });

  it("does not autoplay for an unknown mode", () => {
    expect(shouldAutoplay("nonsense", "click")).toBe(false);
  });

  it("does not autoplay for an unknown trigger in click mode", () => {
    expect(shouldAutoplay("click", "restore")).toBe(false);
  });
});

describe("toBool", () => {
  it.each([
    [undefined, false],
    [null, false],
    ["", true],
    ["true", true],
    ["false", false],
    ["FALSE", false],
    ["0", false],
    ["1", true]
  ])("%j -> %j", (input, expected) => expect(toBool(input)).toBe(expected));
});

describe("toIntOrNull", () => {
  it.each([
    ["4", 4],
    ["0", 0],
    [" 7 ", 7],
    ["abc", null],
    ["", null],
    ["-1", null],
    ["1.5", null],
    [undefined, null]
  ])("%j -> %j", (input, expected) =>
    expect(toIntOrNull(input)).toBe(expected)
  );
});

describe("toIntList", () => {
  it("splits and converts", () =>
    expect(toIntList("12, 26,26")).toEqual([12, 26, 26]));
  it("ignores invalid or zero values", () =>
    expect(toIntList("12,x,0,5")).toEqual([12, 5]));
  it("returns null when nothing usable", () => {
    expect(toIntList("x,y")).toBeNull();
    expect(toIntList("")).toBeNull();
    expect(toIntList(undefined)).toBeNull();
  });
});

describe("toStringOrNull", () => {
  it("trims the value", () => expect(toStringOrNull("  a ")).toBe("a"));
  it("returns null if empty or missing", () => {
    expect(toStringOrNull("   ")).toBeNull();
    expect(toStringOrNull(undefined)).toBeNull();
  });
});
