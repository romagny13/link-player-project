const NOT_SAVED = new Set(["meta", "immediate", "detach"]);

/** ROLE: remember where each region was (info key + item) and restore it. */
export class PersistenceBehavior {
    #store;
    #enabled;
    #offs = new Map(); // region -> unsubscribe (one instance serves every region)

    constructor({store, enabled = true}) {
        this.#store = store;
        this.#enabled = enabled;
    }

    attach(region) {
        if (!this.#enabled) return;
        this.#offs.set(region, region.afterNavigate(({info, index, reason}) => {
            if (NOT_SAVED.has(reason) || !info) return;
            this.#store.set(this.#key(region), {key: info.key, index});
        }));
    }

    dispose(region) {
        this.#offs.get(region)?.();
        this.#offs.delete(region);
    }

    /** @returns {{key: string, index: number}|null} the saved index is sanitized (a bad one is the first item). */
    read(region) {
        if (!this.#enabled) return null;
        const saved = this.#store.get(this.#key(region));
        if (!saved?.key) return null;
        return {key: saved.key, index: Number.isInteger(saved.index) && saved.index >= 0 ? saved.index : 0};
    }

    /** @returns {boolean} true when the saved state was restored. */
    restore(region) {
        const saved = this.read(region);
        return saved ? region.restore(saved.key, {index: saved.index}) : false;
    }

    #key(region) {
        return `state:${region.name}`;
    }
}
