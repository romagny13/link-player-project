

/**
 * ROLE: mark the trigger(s) of the current info with a CSS class.
 * `whenPlaying`: the class is only there while the view plays (a "now playing" look instead of "selected").
 */
export class ActiveLinkBehavior {
    #binder;
    #classes;
    #whenPlaying;
    #offs = [];
    #marked = new Set();

    /** @param {CommandBinder} binder */
    constructor({binder, activeClass = "active", whenPlaying = false}) {
        this.#binder = binder;
        // "a b" or ["a", "b"]; empty / null: no class at all
        this.#classes = String(Array.isArray(activeClass) ? activeClass.join(" ") : activeClass ?? "").split(/\s+/).filter(Boolean);
        this.#whenPlaying = whenPlaying;
    }

    attach(region) {
        if (!this.#classes.length) return;
        this.#offs.push(
            region.afterNavigate((ctx) => this.#apply(region, ctx)),
            region.on("state", () => this.#apply(region, region.context("state")))
        );
    }

    dispose() {
        this.#offs.forEach((off) => off());
        this.#offs.length = 0;
        this.#marked.forEach((el) => el.classList.remove(...this.#classes));
        this.#marked.clear();
    }

    #apply(region, ctx) {
        const active = ctx && (!this.#whenPlaying || region.playerState === "playing") ? ctx.info.key : null;
        for (const [key, elements] of this.#binder.triggers(region))
            for (const el of elements) {
                const on = key === active;
                for (const c of this.#classes) el.classList.toggle(c, on);
                this.#marked[on ? "add" : "delete"](el);
            }
    }
}
