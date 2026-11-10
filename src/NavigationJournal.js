/**
 * History of a region: stores navigation STATE ({info, index}), never views.
 * Going back / forward only moves the cursor; it never adds an entry.
 */
export class NavigationJournal {
    #entries = [];
    #cursor = -1;

    get current() {
        return this.#entries[this.#cursor] ?? null;
    }

    get canGoBack() {
        return this.#cursor > 0;
    }

    get canGoForward() {
        return this.#cursor < this.#entries.length - 1;
    }

    get entries() {
        return Object.freeze([...this.#entries]);
    }

    push(entry) {
        this.#entries.length = this.#cursor + 1; // drop the forward history
        this.#entries.push({...entry});
        this.#cursor++;
    }

    /** E.g. the playlist item changed while the entry is the current one. */
    updateCurrent(patch) {
        const current = this.current;
        if (current) Object.assign(current, patch);
    }

    back() {
        return this.canGoBack ? this.#entries[--this.#cursor] : null;
    }

    forward() {
        return this.canGoForward ? this.#entries[++this.#cursor] : null;
    }
}