/**
 * ROLE: one media iframe (`root`) and what can be done with it. This is what "player" was.
 *
 * The root IS the iframe (no wrapper). `owned` tells who created it: a view that created its iframe
 * is removed with it, an adopted iframe stays where the page put it.
 *
 * Subclasses (one per provider) implement load() and the commands they support; the others are no-ops.
 * Events given to subscribers (same shape for every provider):
 *   { type: "itemChange", index }   the playing item of a list / playlist changed
 *   { type: "state", state, index? } "playing" | "paused" | "ended"
 *   { type: "error", error }
 */
export class MediaView {
    kind = "media";
    /** Where the panel toggle sits (a presentation hint of the provider's embed). */
    togglePosition = null;

    #root = null;
    #owned = false;
    #listeners = new Set();

    get root() {
        return this.#root;
    }

    get owned() {
        return this.#owned;
    }

    get canMute() { return false; }

    /** @protected */
    setRoot(iframe, owned) {
        this.#root = iframe;
        this.#owned = owned;
    }

    /** @protected */
    emit(event) {
        for (const listener of [...this.#listeners]) listener(event);
    }

    subscribe(onEvent) {
        this.#listeners.add(onEvent);
        return () => this.#listeners.delete(onEvent);
    }

    /** Shows `info`: creates the iframe the first time, drives it afterwards. */
    load(info, {autoplay = false, index = 0} = {}) {
        throw new Error(`${this.constructor.name} must implement load().`);
    }

    play() {
    }

    pause() {
    }

    mute() {}
    unmute() {}
    /** @param {number} volume 0..1 */
    setVolume(volume) {}

    next() {
    }

    previous() {
    }

    playAt(index) {
    }

    seekTo(seconds, {play = true} = {}) {
    }

    /** Another item of the list that is already loaded. */
    selectItem(info, index, {autoplay = true} = {}) {
        if (autoplay) this.playAt(index);
    }

    dispose() {
        this.#listeners.clear();
        this.#root = null;
    }
}
