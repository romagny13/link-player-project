export class MemoryStore {
    #m = new Map();
    get(key) {
        const e = this.#m.get(key);
        if (!e) return null;
        if (e.expiresAt && Date.now() > e.expiresAt) {
            this.#m.delete(key);
            return null;
        }
        return e.data ?? null;
    }
    set(key, data, ttlMs) {
        this.#m.set(key, { data, expiresAt: ttlMs ? Date.now() + ttlMs : null });
    }
    remove(key) {
        this.#m.delete(key);
    }
}

/** JSON in a localStorage-like storage. Never throws. ttlMs is optional (no expiry by default). */
export class JsonStore {
    constructor({ storage = globalThis.localStorage, prefix = "lp:" } = {}) {
        this._s = storage;
        this._p = prefix;
    }
    get(key) {
        try {
            const raw = this._s.getItem(this._p + key);
            if (!raw) return null;
            const { data, expiresAt } = JSON.parse(raw);
            if (expiresAt && Date.now() > expiresAt) {
                this._s.removeItem(this._p + key);
                return null;
            }
            return data ?? null;
        } catch {
            return null;
        }
    }
    set(key, data, ttlMs) {
        try {
            this._s.setItem(
                this._p + key,
                JSON.stringify({ data, expiresAt: ttlMs ? Date.now() + ttlMs : null })
            );
        } catch {
            /* private mode or quota: storage is optional */
        }
    }
    remove(key) {
        try {
            this._s.removeItem(this._p + key);
        } catch {
            /* noop */
        }
    }
}

/** localStorage when reachable, memory otherwise (sandboxed iframes throw on access). */
export function defaultStore() {
    try {
        return new JsonStore();
    } catch {
        return new MemoryStore();
    }
}