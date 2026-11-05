/**
 * History of one region, with a cursor: back / forward like a browser.
 * Entries: { key, url, index, info }. `info` (LinkInfo) is memory only, never saved.
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
    get size() {
        return this.#entries.length;
    }

    push(entry) {
        this.#entries.splice(this.#cursor + 1); // a new navigation drops the "forward" part
        this.#entries.push(entry);
        this.#cursor = this.#entries.length - 1;
    }
    /** Updates the current entry (e.g. the episode changed) without creating history. */
    replaceCurrent(patch) {
        if (!this.current) return this.push(patch);
        this.#entries[this.#cursor] = { ...this.current, ...patch };
    }
    back() {
        return this.canGoBack ? this.#entries[--this.#cursor] : null;
    }
    forward() {
        return this.canGoForward ? this.#entries[++this.#cursor] : null;
    }
    clear() {
        this.#entries = [];
        this.#cursor = -1;
    }
}
