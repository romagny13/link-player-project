import {afterEach, describe, expect, it, vi} from "vitest";
import {AUTOPLAY_MODES, isTouch, toAutoplayMode, toBoolean, toInt, toNumber} from "../../src/utils/helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("toInt", () => {
    it.each([
        ["3", 3],
        [" 4 ", 4],
        ["-2", -2],
        ["1.9", 1],
        [7, 7]
    ])("converts %j to %i", (input, expected) => {
        expect(toInt(input)).toBe(expected);
    });

    it.each([[""], ["x"], [undefined], [null]])("returns undefined for %j", (input) => {
        expect(toInt(input)).toBeUndefined();
    });
});

describe("toNumber", () => {
    it.each([
        ["30", 30],
        ["0", 0],
        ["1.5", 1.5],
        ["-3", -3],
        [12, 12]
    ])("converts %j to %d", (input, expected) => {
        expect(toNumber(input)).toBe(expected);
    });

    it.each([[undefined], [null], [""], ["  "], ["abc"], ["1m30s"]])(
        "returns undefined (never NaN) for %j",
        (input) => {
            expect(toNumber(input)).toBeUndefined();
        }
    );
});

describe("toBoolean", () => {
    it.each([[""], ["true"], ["TRUE"], [" true "], ["1"], ["yes"], [true]])("%j -> true", (v) => {
        expect(toBoolean(v)).toBe(true);
    });

    it.each([[undefined], [null], ["false"], ["FALSE"], ["0"], ["no"], [false]])("%j -> false", (v) => {
        expect(toBoolean(v)).toBe(false);
    });
});

describe("toAutoplayMode", () => {
    it("exposes frozen modes", () => {
        expect(Object.isFrozen(AUTOPLAY_MODES)).toBe(true);
        expect(AUTOPLAY_MODES).toEqual({NONE: "none", INIT: "init", CLICK: "click"});
    });

    it.each([
        [undefined, "none"],
        [null, "none"],
        ["", "init"],
        ["true", "init"],
        [" TRUE ", "init"],
        ["click", "click"],
        ["Click", "click"],
        [" click ", "click"],
        ["false", "none"],
        ["0", "none"],
        ["invalid", "none"]
    ])("%j -> %s", (input, expected) => {
        expect(toAutoplayMode(input)).toBe(expected);
    });
});

describe("isTouch", () => {
    it("true when the media matches a touch screen", () => {
        const matchMedia = vi.fn(() => ({matches: true}));
        vi.stubGlobal("matchMedia", matchMedia);
        expect(isTouch()).toBe(true);
        expect(matchMedia).toHaveBeenCalledWith("(hover: none) and (pointer: coarse)");
    });

    it("false when it does not match", () => {
        vi.stubGlobal("matchMedia", () => ({matches: false}));
        expect(isTouch()).toBe(false);
    });

    it("false without matchMedia (SSR, tests)", () => {
        vi.stubGlobal("matchMedia", undefined);
        expect(isTouch()).toBe(false);
    });
});