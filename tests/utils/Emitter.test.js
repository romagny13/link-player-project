import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {Emitter} from "../../src/utils/Emitter.js";

describe("Emitter", () => {
    let emitter;

    beforeEach(() => {
        emitter = new Emitter();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("on / off / emit", () => {
        it("appelle les handlers du type", () => {
            const handler = vi.fn();
            emitter.on("play", handler);

            const count = emitter.emit("play", { id: "abc" });

            expect(count).toBe(1);
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith({ type: "play", id: "abc" });
        });

        it("retourne 0 si personne n'écoute", () => {
            expect(emitter.emit("unknown")).toBe(0);
        });

        it("passe type dans l'event même sans data", () => {
            const handler = vi.fn();
            emitter.on("ready", handler);
            emitter.emit("ready");
            expect(handler).toHaveBeenCalledWith({ type: "ready" });
        });

        it("on retourne une fonction qui désabonne", () => {
            const handler = vi.fn();
            const unsub = emitter.on("play", handler);

            unsub();
            emitter.emit("play");

            expect(handler).not.toHaveBeenCalled();
        });

        it("off retire le handler", () => {
            const handler = vi.fn();
            emitter.on("play", handler);
            emitter.off("play", handler);

            emitter.emit("play");
            expect(handler).not.toHaveBeenCalled();
        });

        it("off sur un type inconnu ne plante pas", () => {
            expect(() => emitter.off("nope", () => {})).not.toThrow();
        });

        it("plusieurs handlers sur le même type", () => {
            const a = vi.fn();
            const b = vi.fn();
            emitter.on("play", a);
            emitter.on("play", b);

            expect(emitter.emit("play")).toBe(2);
            expect(a).toHaveBeenCalledTimes(1);
            expect(b).toHaveBeenCalledTimes(1);
        });
    });

    describe("wildcard *", () => {
        it("reçoit tous les events", () => {
            const star = vi.fn();
            emitter.on("*", star);

            emitter.emit("play", { id: 1 });
            emitter.emit("pause");

            expect(star).toHaveBeenCalledTimes(2);
            expect(star).toHaveBeenNthCalledWith(1, { type: "play", id: 1 });
            expect(star).toHaveBeenNthCalledWith(2, { type: "pause" });
        });

        it("est appelé en plus des handlers spécifiques", () => {
            const specific = vi.fn();
            const star = vi.fn();
            emitter.on("play", specific);
            emitter.on("*", star);

            expect(emitter.emit("play")).toBe(2);
            expect(specific).toHaveBeenCalledTimes(1);
            expect(star).toHaveBeenCalledTimes(1);
        });
    });

    describe("isolation des erreurs", () => {
        it("un handler qui throw n'empêche pas les suivants", () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const bad = vi.fn(() => {
                throw new Error("boom");
            });
            const good = vi.fn();

            emitter.on("play", bad);
            emitter.on("play", good);

            const count = emitter.emit("play");

            expect(count).toBe(2);
            expect(bad).toHaveBeenCalled();
            expect(good).toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalled();
            expect(errorSpy.mock.calls[0][0]).toMatch(/handler of "play" failed/);
        });
    });

    describe("clear", () => {
        it("supprime tous les handlers", () => {
            const a = vi.fn();
            const star = vi.fn();
            emitter.on("play", a);
            emitter.on("*", star);

            emitter.clear();
            expect(emitter.emit("play")).toBe(0);
            expect(a).not.toHaveBeenCalled();
            expect(star).not.toHaveBeenCalled();
        });
    });

    describe("comportement pendant emit", () => {
        it("un off pendant emit n'empêche pas l'appel en cours (snapshot)", () => {
            const calls = [];
            const selfRemoving = vi.fn(() => {
                calls.push("self");
                emitter.off("play", selfRemoving);
            });
            const other = vi.fn(() => calls.push("other"));

            emitter.on("play", selfRemoving);
            emitter.on("play", other);

            emitter.emit("play");

            expect(calls).toEqual(["self", "other"]);
            // second emit : selfRemoving déjà retiré
            calls.length = 0;
            emitter.emit("play");
            expect(calls).toEqual(["other"]);
        });
    });
});