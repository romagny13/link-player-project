import { NavigationJournal } from "./journal.js";
import { AUTOPLAY_MODES } from "./util.js";

export function neighbourEntry(entries, currentKey, delta, wrap = false) {
    const n = entries.length;
    if (!n) return null;
    const at = entries.findIndex((e) => e.key === currentKey);
    if (at === -1) return delta > 0 ? entries[0] : entries[n - 1]; // nothing shown yet
    if (n === 1) return null;
    const i = at + delta;
    if (i >= 0 && i < n) return entries[i];
    return wrap ? entries[(i + n) % n] : null;
}

/** reason: "click" (user or next/previous) | "init" (first display). */
export const wantsAutoplay = (entry, reason) =>
    entry.autoplay === AUTOPLAY_MODES.INIT || (reason === "click" && entry.autoplay === AUTOPLAY_MODES.CLICK);

/** Navigation of one region: entries → iframe → panel, with a journal. Sync methods return a boolean and report errors on the region; navigate* methods are awaitable. */
export class NavigationService {
    #region; #view; #panel;
    #token = 0; // invalidates a navigation superseded by a newer one
    #controller = null; #entry = null; #itemIndex = null;
    #visible = false; #navigated = false;

    constructor({ region, view, journal = new NavigationJournal(), panel = true }) {
        this.#region = region;
        this.#view = view;
        this.#panel = panel;
        this.journal = journal;
    }

    get entry() { return this.#entry; }
    get itemIndex() { return this.#itemIndex; }
    get isOpen() { return this.#visible; }
    get hasNavigated() { return this.#navigated; }

    /* ───── awaitable ───── */

    /** index (0-based) wins over entry.startIndex, which wins over the url's own index. */
    async navigateTo(entry, { autoplay = false, itemIndex = null, push = true } = {}) {
        const token = ++this.#token;
        this.#navigated = true;
        const { provider, parsed } = entry;
        const start = itemIndex ?? entry.startIndex ?? parsed.initialIndex ?? null;
        const itemsPromise = entry.ensureItems(); // started now, awaited once the iframe is shown

        const src = provider.buildSrc(parsed, { autoplay, index: start }); // may throw before the DOM is touched
        this.#controller?.dispose();
        const iframe = this.#view.showEmbed(src, entry.title || provider.label);
        this.#controller = provider.createController(iframe, {
            parsed,
            index: start,
            onItemChange: (i) => this.#setItemIndex(i)
        });
        this.#entry = entry;
        this.#itemIndex = start;
        this.#visible = true;

        const record = { key: entry.key, index: start, entry };
        push ? this.journal.push(record) : this.journal.replaceCurrent(record);
        this.#changed();

        const items = await itemsPromise;
        if (token !== this.#token) return;
        this.#region.emit("items", { entry, items });
        if (!this.#panel || !provider.panel || !entry.panel || items.length < 2) return;
        this.#view.showPanel({ region: this.#region, entry, items, index: this.#itemIndex ?? 0, cfg: provider.panel, onSelect: (i) => this.select(i) });
    }

    /** Url, key or any url of a known video. An unknown url is registered on the fly. */
    async navigateByUrl(url, opts) {
        return this.navigateTo(this.#region.ensureEntry(url), opts);
    }

    async navigateByIndex(index, opts) {
        const entry = this.#region.entries[index];
        if (!entry) throw new RangeError(`No entry at index ${index}`);
        return this.navigateTo(entry, opts);
    }

    /* ───── fire and forget ───── */

    /** Entry | index | key | url. No-op when already displayed. */
    go(target, { reason = "click", autoplay, itemIndex = null, push = true } = {}) {
        let entry;
        try {
            entry = this.#region.resolveTarget(target);
        } catch (error) {
            this.#region.emit("error", { error, entry: null });
            return false;
        }
        if (!entry || (entry === this.#entry && this.#visible && itemIndex == null)) return false;
        this.#fire(this.navigateTo(entry, { autoplay: autoplay ?? wantsAutoplay(entry, reason), itemIndex, push }), entry);
        return true;
    }

    /** Same entry: hide / show again. Otherwise: navigate. */
    toggle(entry, opts = {}) {
        if (entry === this.#entry)
            return this.#visible ? (this.hide(), true) : this.show({ autoplay: opts.autoplay ?? wantsAutoplay(entry, "click") });
        return this.go(entry, opts);
    }

    nextLink({ wrap = false, autoplay } = {}) { return this.#step(1, wrap, autoplay); }
    previousLink({ wrap = false, autoplay } = {}) { return this.#step(-1, wrap, autoplay); }
    #step(delta, wrap, autoplay) {
        const entry = neighbourEntry(this.#region.entries, this.#entry?.key, delta, wrap);
        if (!entry) return false;
        this.#fire(this.navigateTo(entry, { autoplay: autoplay ?? wantsAutoplay(entry, "click") }), entry);
        return true;
    }

    back() { return this.#walk(this.journal.back()); }
    forward() { return this.#walk(this.journal.forward()); }
    #walk(record) {
        if (!record) return false;
        this.#fire(this.navigateTo(record.entry, { itemIndex: record.index, autoplay: true, push: false }), record.entry);
        return true;
    }

    /** The panel picked an item. */
    select(index) {
        if (index === this.#itemIndex) return;
        this.#controller?.playAt(index, { autoplay: true });
        this.#setItemIndex(index);
    }

    /** Hides player and panel, keeps the journal and the current item. */
    hide() {
        this.#token++; // a late playlist must not reopen the panel
        this.#controller?.dispose();
        this.#controller = null;
        this.#visible = false;
        this.#view.clear();
        this.#state();
    }

    show({ autoplay = false } = {}) {
        const record = this.journal.current;
        if (!record) return false;
        this.#fire(this.navigateTo(record.entry, { itemIndex: record.index, autoplay, push: false }), record.entry);
        return true;
    }

    /** Full reset: journal, current entry and saved state. */
    close() {
        this.dispose();
        this.#entry = null;
        this.#itemIndex = null;
        this.journal.clear();
        this.#region.emit("change", { entry: null, itemIndex: null });
        this.#state();
    }

    /** Stops everything silently (no events, saved state untouched). */
    dispose() {
        this.#token++;
        this.#controller?.dispose();
        this.#controller = null;
        this.#visible = false;
        this.#view.clear();
    }

    #fire(promise, entry) {
        promise.catch((error) => this.#region.emit("error", { error, entry }));
    }
    #setItemIndex(i) {
        if (i === this.#itemIndex) return;
        this.#itemIndex = i;
        this.#view.setActive(i);
        this.journal.replaceCurrent({ index: i });
        this.#changed();
    }
    #changed() {
        this.#region.emit("change", { entry: this.#entry, itemIndex: this.#itemIndex });
        this.#state();
    }
    #state() {
        this.#region.emit("state", this.#region.getState());
    }
}