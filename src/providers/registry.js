// providers/registry.js
import { UnsupportedUrlError } from "../util.js";

export class ProviderRegistry {
    constructor(providers = []) {
        this._providers = [...providers];
    }
    register(provider) {
        this._providers.push(provider);
        return this;
    }
    /** By url. @throws UnsupportedUrlError */
    resolve(url) {
        const p = this._providers.find((p) => p.canHandle(url));
        if (!p) throw new UnsupportedUrlError(url);
        return p;
    }
    /** By id ("youtube"...). @throws Error */
    get(id) {
        const p = this._providers.find((p) => p.id === id);
        if (!p) throw new Error(`Unknown provider: "${id}"`);
        return p;
    }
}