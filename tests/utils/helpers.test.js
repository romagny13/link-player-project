import {afterEach, describe, expect, it, vi} from "vitest";
import {AUTOPLAY_MODES, isTouch, toAutoplayMode, toBoolean, toInt, toNumber, isEmpty} from "../../src/utils/helpers.js";
import {UrlInfo} from "../../src/models/UrlInfo.js";
import {VideoInfo} from "../../src/models/VideoInfo.js";

afterEach(() => vi.unstubAllGlobals());

describe("helpers", () => {
    describe("toInt", () => {
        it.each([
            ["12", 12],
            ["12abc", 12],
            [7, 7],
            ["-3", -3],
        ])("toInt(%j) -> %j", (input, expected) => {
            expect(toInt(input)).toBe(expected);
        });

        it.each([["abc"], [""], [null], [undefined]])("toInt(%j) -> undefined", (input) => {
            expect(toInt(input)).toBeUndefined();
        });
    });

    describe("toNumber", () => {
        it.each([
            ["3.5", 3.5],
            ["0", 0],
            [0, 0],
            [" 42 ", 42],
        ])("toNumber(%j) -> %j", (input, expected) => {
            expect(toNumber(input)).toBe(expected);
        });

        it.each([[undefined], [null], [""], ["   "], ["x"]])("toNumber(%j) -> undefined", (input) => {
            expect(toNumber(input)).toBeUndefined();
        });
    });

    describe("toBoolean", () => {
        it.each([[""], ["true"], ["TRUE"], ["1"], ["yes"], ["anything"]])("toBoolean(%j) -> true", (v) => {
            expect(toBoolean(v)).toBe(true);
        });

        it.each([[undefined], [null], ["false"], ["FALSE"], [" no "], ["0"]])("toBoolean(%j) -> false", (v) => {
            expect(toBoolean(v)).toBe(false);
        });
    });

    describe("isEmpty", () => {
        it("true pour '', null, undefined", () => {
            expect(isEmpty("")).toBe(true);
            expect(isEmpty(null)).toBe(true);
            expect(isEmpty(undefined)).toBe(true);
        });
        it("false pour le reste (y compris 0 et false)", () => {
            expect(isEmpty("a")).toBe(false);
            expect(isEmpty(0)).toBe(false);
            expect(isEmpty(false)).toBe(false);
        });
    });

    describe("toAutoplayMode", () => {
        it("expose des modes figés", () => {
            expect(Object.isFrozen(AUTOPLAY_MODES)).toBe(true);
        });
        it.each([
            [undefined, "none"],
            [null, "none"],
            ["false", "none"],
            ["nimporte", "none"],
            ["", "init"],
            ["true", "init"],
            [" TRUE ", "init"],
            ["click", "click"],
            [" Click ", "click"],
        ])("toAutoplayMode(%j) -> %s", (input, expected) => {
            expect(toAutoplayMode(input)).toBe(expected);
        });
    });

    describe("isTouch", () => {
        it("false si matchMedia n'existe pas", () => {
            vi.stubGlobal("matchMedia", undefined);
            expect(isTouch()).toBe(false);
        });
        it("reflète matchMedia(...).matches", () => {
            const mm = vi.fn(() => ({matches: true}));
            vi.stubGlobal("matchMedia", mm);
            expect(isTouch()).toBe(true);
            expect(mm).toHaveBeenCalledWith("(hover: none) and (pointer: coarse)");

            vi.stubGlobal("matchMedia", () => ({matches: false}));
            expect(isTouch()).toBe(false);
        });
    });
});
