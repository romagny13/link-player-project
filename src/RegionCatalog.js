/**
 * ROLE: name -> Region, and which element each region lives in.
 *
 * A region exists as soon as somebody talks about it (`get(name)`), with or without its element:
 * "two times" life. What is requested before the element exists is simply the state of the region
 * (its journal); the region shows its CURRENT state when `bind()` gives it the element.
 * So the catalog has no queue of pending operations.
 *
 * bind() is idempotent: binding the same element to the same region again does nothing.
 */
export class RegionCatalog {
    #create;
    #regions = new Map();
    #names = new WeakMap(); // element -> name (one element = one region)

    /** @param {(name: string) => Region} create */
    constructor({create}) {
        this.#create = create;
    }

    get regions() {
        return Object.freeze([...this.#regions.values()]);
    }

    has(name) {
        return this.#regions.has(name);
    }

    get(name) {
        let region = this.#regions.get(name);
        if (!region) {
            region = this.#create(name);
            this.#regions.set(name, region);
        }
        return region;
    }

    nameOf(element) {
        return this.#names.get(element) ?? null;
    }

    /** @returns {Region} */
    bind(name, element) {
        const known = this.#names.get(element);
        if (known && known !== name)
            throw new Error(`Element <${element.localName}${element.id ? `#${element.id}` : ""}> is already the region '${known}', it cannot also be '${name}'`);
        const region = this.get(name);
        if (region.element !== element) {
            this.#names.set(element, name);
            region.attach(element);
        }
        return region;
    }

    /** A region whose element left the page keeps its state, it only loses its view (until a new element is bound). */
    refresh() {
        for (const region of this.#regions.values())
            if (region.element && !region.element.isConnected) {
                this.#names.delete(region.element);
                region.detach();
            }
    }

    dispose() {
        this.#regions.forEach((region) => region.dispose());
        this.#regions.clear();
    }
}
