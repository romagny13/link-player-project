import {
  toBool,
  toIntOrNull,
  toIntList,
  toStringOrNull,
  toAutoplayMode,
  AUTOPLAY_MODES
} from "../src/converters.js";

const { NONE, INIT, CLICK } = AUTOPLAY_MODES;

describe("AUTOPLAY_MODES", () => {
  it("exposes the three modes", () => {
    expect(AUTOPLAY_MODES).toEqual({
      NONE: "none",
      CLICK: "click",
      INIT: "init"
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(AUTOPLAY_MODES)).toBe(true);
  });
});

describe("toAutoplayMode", () => {
  it.each([
    // attribute absent
    [undefined, NONE],
    [null, NONE],
    // attribute present without value, or truthy alias
    ["", INIT],
    ["  ", INIT],
    ["true", INIT],
    ["TRUE", INIT],
    [" true ", INIT],
    // click
    ["click", CLICK],
    ["CLICK", CLICK],
    [" click ", CLICK],
    // explicit none, falsy aliases, unknown values
    ["none", NONE],
    ["false", NONE],
    ["0", NONE],
    ["clik", NONE],
    ["nonsense", NONE],
    // legacy value, no longer an alias (see note)
    ["always", NONE],
    ["init", NONE]
  ])("%j -> %j", (input, expected) =>
    expect(toAutoplayMode(input)).toBe(expected)
  );

  it("exposes frozen, stable mode values", () => {
    expect(AUTOPLAY_MODES).toEqual({ NONE: "none", INIT: "init", CLICK: "click" });
    expect(Object.isFrozen(AUTOPLAY_MODES)).toBe(true);
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
