export class ProviderRegistry {
    #providers = new Map();

    constructor(providers = []) {
        for (const p of providers) this.register(p);
    }

    get providers() {
        return Object.freeze([...this.#providers.values()]);
    }

    register(provider) {
        if (!provider?.id || !Array.isArray(provider.hosts))
            throw new TypeError(
                "register(): a provider needs an id and a hosts array"
            );
        this.#providers.set(provider.id.toLowerCase(), provider);
        return this;
    }

    get(id) {
        const provider = this.#providers.get(id.toLowerCase());
        if (!provider) throw new Error(`Unknown provider: "${id}"`);
        return provider;
    }

    has(id) {
        return this.#providers.has(id.toLowerCase());
    }

    resolve(urlString) {
        let hostname;
        try {
            hostname = new URL(urlString).hostname;
        } catch {
            throw new Error(`Invalid URL: '${urlString}'`);
        }

        for (const provider of this.#providers.values()) {
            const handles = provider.hosts.some(
                (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
            );
            if (handles) return provider;
        }
        throw new Error(`No provider handles '${hostname}'`);
    }
}