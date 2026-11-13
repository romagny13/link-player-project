import { afterEach, describe, expect, it, vi } from "vitest";
import {
    AUTOPLAY_MODES,
    describe as describeElement,
    isEmpty,
    isTouch,
    timeToSeconds,
    toAutoplayMode,
    toBoolean,
    toBool01,
    toInt,
    toNumber,
} from "../../src/utils/helpers.js";

// Note: the `describe` import from helpers is renamed to `describeElement`
// to avoid colliding with vitest's `describe`.

describe("toInt", () => {
    it("converts an integer string", () => {
        expect(toInt("42")).toBe(42);
        expect(toInt("-7")).toBe(-7);
    });

    it("truncates decimals", () => {
        expect(toInt("3.9")).toBe(3);
        expect(toInt(3.9)).toBe(3);
    });

    it("returns null when not a number", () => {
        expect(toInt("abc")).toBeNull();
        expect(toInt("")).toBeNull();
        expect(toInt(null)).toBeNull();
        expect(toInt(undefined)).toBeNull();
    });

    it("is tolerant: reads the beginning of the string (parseInt)", () => {
        expect(toInt("12px")).toBe(12);
    });
});

describe("toNumber", () => {
    it("converts integers and decimals", () => {
        expect(toNumber("3.5")).toBe(3.5);
        expect(toNumber("0")).toBe(0);
        expect(toNumber(12)).toBe(12);
    });

    it("returns undefined for missing, empty or whitespace", () => {
        expect(toNumber(undefined)).toBeUndefined();
        expect(toNumber(null)).toBeUndefined();
        expect(toNumber("")).toBeUndefined();
        expect(toNumber("   ")).toBeUndefined();
    });

    it("is strict: rejects a number followed by text (unlike toInt)", () => {
        expect(toNumber("12px")).toBeUndefined();
        expect(toNumber("abc")).toBeUndefined();
    });
});

describe("toBool01", () => {
    it("returns true for 1 / '1' / true", () => {
        expect(toBool01(1)).toBe(true);
        expect(toBool01("1")).toBe(true);
        expect(toBool01(true)).toBe(true);
    });

    it("returns false for 0 / '0' / false", () => {
        expect(toBool01(0)).toBe(false);
        expect(toBool01("0")).toBe(false);
        expect(toBool01(false)).toBe(false);
    });

    it("returns null for anything else", () => {
        for (const v of [undefined, null, "", "true", "false", "yes", "no", 2, "abc"]) {
            expect(toBool01(v)).toBeNull();
        }
    });
});

describe("toBoolean (data-* attribute)", () => {
    it("absent => false", () => {
        expect(toBoolean(undefined)).toBe(false);
        expect(toBoolean(null)).toBe(false);
    });

    it("present without value or \"true\" => true", () => {
        expect(toBoolean("")).toBe(true);
        expect(toBoolean("true")).toBe(true);
    });

    it("\"false\", \"0\" and \"no\" => false, case and whitespace insensitive", () => {
        for (const v of ["false", "0", "no", " FALSE ", "No"]) {
            expect(toBoolean(v)).toBe(false);
        }
    });

    it("any other value => true", () => {
        for (const v of ["yes", "1", "oui", "whatever"]) {
            expect(toBoolean(v)).toBe(true);
        }
    });
});

describe("timeToSeconds", () => {
    it("returns null for null, undefined or empty string", () => {
        expect(timeToSeconds(null)).toBeNull();
        expect(timeToSeconds(undefined)).toBeNull();
        expect(timeToSeconds("")).toBeNull();
    });

    it("accepts a plain number of seconds (string or number)", () => {
        expect(timeToSeconds("90")).toBe(90);
        expect(timeToSeconds(90)).toBe(90);
    });

    it("parses h/m/s format", () => {
        expect(timeToSeconds("1h")).toBe(3600);
        expect(timeToSeconds("2m")).toBe(120);
        expect(timeToSeconds("30s")).toBe(30);
        expect(timeToSeconds("1h30m")).toBe(5400);
        expect(timeToSeconds("1h30m15s")).toBe(5415);
        expect(timeToSeconds("45m10s")).toBe(2710);
        expect(timeToSeconds("2h5s")).toBe(7205);
    });

    it("is case-insensitive", () => {
        expect(timeToSeconds("1H30M")).toBe(5400);
        expect(timeToSeconds("45S")).toBe(45);
    });

    it("returns null for invalid formats", () => {
        expect(timeToSeconds("abc")).toBeNull();
        expect(timeToSeconds("1hour")).toBeNull();
        expect(timeToSeconds("1h 30m")).toBeNull(); // spaces not allowed
        expect(timeToSeconds("h")).toBeNull();
        expect(timeToSeconds("m")).toBeNull();
        expect(timeToSeconds("s")).toBeNull();
    });
});

describe("isEmpty", () => {
    it("true for \"\", null and undefined", () => {
        expect(isEmpty("")).toBe(true);
        expect(isEmpty(null)).toBe(true);
        expect(isEmpty(undefined)).toBe(true);
    });

    it("false for other falsy values that are not empty", () => {
        expect(isEmpty(0)).toBe(false);
        expect(isEmpty(false)).toBe(false);
        expect(isEmpty("a")).toBe(false);
        expect(isEmpty([])).toBe(false);
    });
});

describe("isTouch", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("true when matchMedia reports a touch pointer without hover", () => {
        const matchMedia = vi.fn(() => ({ matches: true }));
        vi.stubGlobal("matchMedia", matchMedia);
        expect(isTouch()).toBe(true);
        expect(matchMedia).toHaveBeenCalledWith("(hover: none) and (pointer: coarse)");
    });

    it("false when matchMedia does not match", () => {
        vi.stubGlobal("matchMedia", () => ({ matches: false }));
        expect(isTouch()).toBe(false);
    });

    it("false when matchMedia does not exist (non-browser environment)", () => {
        vi.stubGlobal("matchMedia", undefined);
        expect(isTouch()).toBe(false);
    });
});

describe("AUTOPLAY_MODES", () => {
    it("exposes the three modes", () => {
        expect(AUTOPLAY_MODES).toEqual({ NONE: "none", INIT: "init", CLICK: "click" });
    });

    it("is frozen", () => {
        expect(Object.isFrozen(AUTOPLAY_MODES)).toBe(true);
    });
});

describe("toAutoplayMode", () => {
    it("absent => NONE", () => {
        expect(toAutoplayMode(undefined)).toBe(AUTOPLAY_MODES.NONE);
        expect(toAutoplayMode(null)).toBe(AUTOPLAY_MODES.NONE);
    });

    it("attribute present without value, \"true\" or true => INIT", () => {
        expect(toAutoplayMode("")).toBe(AUTOPLAY_MODES.INIT);
        expect(toAutoplayMode("true")).toBe(AUTOPLAY_MODES.INIT);
        expect(toAutoplayMode(" TRUE ")).toBe(AUTOPLAY_MODES.INIT);
        expect(toAutoplayMode(true)).toBe(AUTOPLAY_MODES.INIT);
    });

    it("\"click\" => CLICK, case insensitive", () => {
        expect(toAutoplayMode("click")).toBe(AUTOPLAY_MODES.CLICK);
        expect(toAutoplayMode("CLICK")).toBe(AUTOPLAY_MODES.CLICK);
    });

    it("\"false\", false and unknown values => NONE", () => {
        for (const v of ["false", false, "0", "maybe"]) {
            expect(toAutoplayMode(v)).toBe(AUTOPLAY_MODES.NONE);
        }
    });

    it("keeps \"none\" => NONE", () => {
        expect(toAutoplayMode(AUTOPLAY_MODES.NONE)).toBe(AUTOPLAY_MODES.NONE);
    });
});

describe("describe (element description for error messages)", () => {
    it("null and undefined are displayed as-is", () => {
        expect(describeElement(null)).toBe("null");
        expect(describeElement(undefined)).toBe("undefined");
    });

    it("tag only, or tag with id", () => {
        expect(describeElement({ localName: "iframe" })).toBe("<iframe>");
        expect(describeElement({ localName: "iframe", id: "main" })).toBe("<iframe#main>");
    });

    it("without localName, falls back to the JavaScript type", () => {
        expect(describeElement({})).toBe("<object>");
    });
});