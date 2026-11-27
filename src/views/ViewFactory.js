/**
 * ROLE: Info -> view. It picks the provider of the info and asks it for a view (a new iframe),
 * or for a view that adopts an iframe already in the page.
 */
export class ViewFactory {
    #registry;

    constructor(registry) {
        this.#registry = registry;
    }

    create(info) {
        return this.#registry.get(info.provider).createView();
    }

    adopt(iframe, info) {
        return this.#registry.get(info.provider).createView({iframe});
    }
}
