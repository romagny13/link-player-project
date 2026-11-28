import {ContentAdapter} from "./ContentAdapter.js";

/** One view at a time. A new view takes the place of the previous one (same position in the host). */
export class SingleActiveAdapter extends ContentAdapter {
    #element = null;
    #view = null;

    get element() {
        return this.#element;
    }

    get visible() {
        return this.#element !== null && !this.#element.hidden;
    }

    attach(element) {
        if (this.#element === element) return;
        this.clear();
        this.#element = element;
    }

    detach() {
        this.clear();
        this.#element = null;
    }

    place(view) {
        if (!this.#element) throw new Error("SingleActiveAdapter: no element to place the view in");
        const root = view.root;
        const previous = this.#view?.root;
        if (previous && previous !== root && previous.parentNode === this.#element) previous.replaceWith(root);
        else if (root.parentNode !== this.#element) this.#element.prepend(root); // before the panel (CSS anchoring)
        this.#view = view;
    }

    adopt(view) {
        if (view.root.parentElement !== this.#element)
            throw new Error("SingleActiveAdapter: an adopted view must already be a child of the element");
        this.#view = view;
    }

    clear() {
        const view = this.#view;
        this.#view = null;
        if (view?.owned) view.root?.remove();
    }

    setVisible(visible) {
        if (this.#element) this.#element.hidden = !visible;
    }
}
