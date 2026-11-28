// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";

import {SingleActiveAdapter} from "../src/views/adapters/SingleActiveAdapter.js";

afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("SingleActiveAdapter", () => {
    const makeView = (owned = true) => ({root: document.createElement("iframe"), owned});

    describe("element and visibility", () => {
        it("has no element and is not visible at first", () => {
            const adapter = new SingleActiveAdapter();

            expect(adapter.element).toBeNull();
            expect(adapter.visible).toBe(false);
        });

        it("is visible once attached, and follows setVisible()", () => {
            const adapter = new SingleActiveAdapter();
            const host = document.createElement("div");

            adapter.attach(host);
            expect(adapter.element).toBe(host);
            expect(adapter.visible).toBe(true);

            adapter.setVisible(false);
            expect(host.hidden).toBe(true);
            expect(adapter.visible).toBe(false);

            adapter.setVisible(true);
            expect(host.hidden).toBe(false);
            expect(adapter.visible).toBe(true);
        });

        it("setVisible() does nothing without an element", () => {
            expect(() => new SingleActiveAdapter().setVisible(true)).not.toThrow();
        });
    });

    describe("place()", () => {
        it("throws without an element", () => {
            expect(() => new SingleActiveAdapter().place(makeView())).toThrow(/no element/);
        });

        it("puts the root at the start of the host and never empties it", () => {
            const adapter = new SingleActiveAdapter();
            const host = document.createElement("div");
            const panel = document.createElement("aside");
            host.append(panel);
            adapter.attach(host);
            const view = makeView();

            adapter.place(view);

            expect([...host.children]).toEqual([view.root, panel]);
        });

        it("replaces the previous view at the same position", () => {
            const adapter = new SingleActiveAdapter();
            const host = document.createElement("div");
            const panel = document.createElement("aside");
            host.append(panel);
            adapter.attach(host);
            const first = makeView();
            const second = makeView();

            adapter.place(first);
            adapter.place(second);

            expect([...host.children]).toEqual([second.root, panel]);
            expect(first.root.isConnected).toBe(false);
        });

        it("placing the same view again does not move or duplicate it", () => {
            const adapter = new SingleActiveAdapter();
            const host = document.createElement("div");
            document.body.append(host);
            adapter.attach(host);
            const view = makeView();

            adapter.place(view);
            adapter.place(view);

            expect(host.children).toHaveLength(1);
            expect(host.firstElementChild).toBe(view.root);
        });
    });

    describe("adopt()", () => {
        it("takes a root that already is a child of the element, without moving it", () => {
            const adapter = new SingleActiveAdapter();
            const host = document.createElement("div");
            const view = makeView(false);
            host.append(view.root);
            adapter.attach(host);

            adapter.adopt(view);

            expect(view.root.parentElement).toBe(host);
        });

        it("throws when the root is not a child of the element", () => {
            const adapter = new SingleActiveAdapter();
            adapter.attach(document.createElement("div"));

            expect(() => adapter.adopt(makeView(false))).toThrow(/already be a child/);
        });
    });

    describe("clear()", () => {
        it("removes the root of an owned view, and only that", () => {
            const adapter = new SingleActiveAdapter();
            const host = document.createElement("div");
            const panel = document.createElement("aside");
            host.append(panel);
            adapter.attach(host);
            const view = makeView(true);
            adapter.place(view);

            adapter.clear();

            expect([...host.children]).toEqual([panel]);
        });

        it("leaves an adopted root where the page put it", () => {
            const adapter = new SingleActiveAdapter();
            const host = document.createElement("div");
            const view = makeView(false);
            host.append(view.root);
            adapter.attach(host);
            adapter.adopt(view);

            adapter.clear();

            expect(view.root.parentElement).toBe(host);
        });

        it("can be called with nothing placed", () => {
            expect(() => new SingleActiveAdapter().clear()).not.toThrow();
        });
    });

    describe("attach() / detach()", () => {
        it("attaching the same element again does nothing (the view stays)", () => {
            const adapter = new SingleActiveAdapter();
            const host = document.createElement("div");
            adapter.attach(host);
            const view = makeView();
            adapter.place(view);

            adapter.attach(host);

            expect(view.root.parentElement).toBe(host);
        });

        it("attaching another element removes what was placed in the previous one", () => {
            const adapter = new SingleActiveAdapter();
            const first = document.createElement("div");
            const second = document.createElement("div");
            adapter.attach(first);
            const view = makeView();
            adapter.place(view);

            adapter.attach(second);

            expect(first.children).toHaveLength(0);
            expect(adapter.element).toBe(second);
        });

        it("detach() removes what was placed and forgets the element", () => {
            const adapter = new SingleActiveAdapter();
            const host = document.createElement("div");
            adapter.attach(host);
            adapter.place(makeView());

            adapter.detach();

            expect(host.children).toHaveLength(0);
            expect(adapter.element).toBeNull();
            expect(adapter.visible).toBe(false);
        });
    });
});