/**
 * ROLE (contract): how the views of a region are laid out in the region's element.
 *
 * It only deals with the ROOT of a view (`view.root`: for us, the iframe itself, no wrapper), and only with
 * the nodes it placed: it never empties the host element (the panel, or anything the page put there, stays).
 *
 * SingleActiveAdapter shows one view at a time. A "several views at once" adapter (a list of videos...)
 * would implement the same contract: Region does not assume a single view. It is NOT implemented, only possible.
 */
export class ContentAdapter {
    get element() {
        throw new Error(`${this.constructor.name} must implement element.`);
    }

    get visible() {
        throw new Error(`${this.constructor.name} must implement visible.`);
    }

    attach(element) {
        throw new Error(`${this.constructor.name} must implement attach().`);
    }

    /** The element goes away: what the adapter placed is removed. */
    detach() {
        throw new Error(`${this.constructor.name} must implement detach().`);
    }

    /** Puts the view in the host (replacing the one it shows, at the same place). */
    place(view) {
        throw new Error(`${this.constructor.name} must implement place().`);
    }

    /** The view root is already in the host (adopted iframe): nothing is moved. */
    adopt(view) {
        throw new Error(`${this.constructor.name} must implement adopt().`);
    }

    /** Removes what it placed (an adopted root stays where the page put it). */
    clear() {
        throw new Error(`${this.constructor.name} must implement clear().`);
    }

    setVisible(visible) {
        throw new Error(`${this.constructor.name} must implement setVisible().`);
    }
}
