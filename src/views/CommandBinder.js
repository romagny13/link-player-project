import {claim, release} from "../utils/ownership.js";

/**
 * ROLE: turn a trigger element (a `data-link`) into a command: click -> region.activate(key).
 * It knows nothing about providers or infos: it is given (element, region, key).
 * It remembers the triggers of each region (ActiveLinkBehavior reads them).
 */
export class CommandBinder {
    #bindings = new Map(); // element -> {region, key, off}

    /** @returns {boolean} false when the element is already a command (of this binder or of another owner). */
    bind(element, region, key, {autoplay = false, index, params} = {}) {
        if (!claim(element, this)) return false;
        const onClick = (event) => {
            event.preventDefault();
            region.activate(key, {autoplay, index, params});
        };
        element.addEventListener("click", onClick);
        this.#bindings.set(element, {
            region, key, off: () => {
                element.removeEventListener("click", onClick);
                release(element, this);
            }
        });
        return true;
    }

    /** @returns {Map<string, Set<HTMLElement>>} key -> trigger elements of the region */
    triggers(region) {
        const byKey = new Map();
        for (const [element, binding] of this.#bindings) {
            if (binding.region !== region) continue;
            if (!byKey.has(binding.key)) byKey.set(binding.key, new Set());
            byKey.get(binding.key).add(element);
        }
        return byKey;
    }

    unbind(element) {
        this.#bindings.get(element)?.off();
        this.#bindings.delete(element);
    }

    dispose() {
        for (const element of [...this.#bindings.keys()]) this.unbind(element);
    }
}
