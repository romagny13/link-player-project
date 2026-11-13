/**
 * Discovers links, target containers and frames in a root and reports the NEW ones.
 * No observer: discovery happens when discoverAll() is called (LinkPlayer.scan()), and what is
 * not found yet (a container created later...) is looked up again on the next call.
 */
export class DefaultRegionHost {
    #id;
    #registeredLinks = new Map();   // element -> url
    #registeredTargets = new Map(); // target id -> container
    #registeredFrames = new Set();
    #defaultTarget = null;
    #root = null;
    #onLinkDiscovered = null;
    #onFrameDiscovered = null;
    #onTargetDiscovered = null

    init({id, root, onLinkDiscovered = null, onFrameDiscovered = null, onTargetDiscovered = null}) {
        this.#id = id;
        this.#root = root ?? document;
        this.#onLinkDiscovered = onLinkDiscovered;
        this.#onFrameDiscovered = onFrameDiscovered;
        this.#onTargetDiscovered = onTargetDiscovered;
    }

    get links() {
        return Object.freeze([...this.#registeredLinks.keys()]);
    }

    get targets() {
        return Object.freeze([...this.#registeredTargets]);
    }

    get frames() {
        return Object.freeze([...this.#registeredFrames]);
    }

    get defaultTarget() {
        return this.#defaultTarget;
    }

    setDefaultTarget(target) {
        this.#defaultTarget = target;
    }

    discoverAll() {
        this.discoverLinks();
        this.discoverTargets();
        this.discoverFrames();
    }

    discoverLinks() {
        this.#forget(this.#registeredLinks.keys(), (el) => this.#registeredLinks.delete(el));

        const linkElements = this.#root.querySelectorAll("[data-link]");
        const newLinks = [];

        for (const element of linkElements) {
            const href = element.tagName === "A" ? element.href : element.dataset.url;

            // keyed by element: two links to the same url are two links
            if (href && !this.#registeredLinks.has(element)) {
                this.#registeredLinks.set(element, href);
                newLinks.push(element);
            }
        }

        if (newLinks.length > 0) this.#onLinkDiscovered?.(newLinks);
    }

    discoverTargets() {
        this.#forget(
            this.#registeredTargets.values(),
            (el) => {
                for (const [id, container] of this.#registeredTargets) {
                    if (container === el) {
                        this.#registeredTargets.delete(id);
                        break;
                    }
                }
            }
        );

        const wanted = new Set();
        if (this.#defaultTarget) wanted.add(this.#defaultTarget);
        for (const link of this.#registeredLinks.keys()) {
            const target = link.dataset.target || this.#defaultTarget; // the element is not modified
            if (target) wanted.add(target);
        }

        const newTargets = new Map();
        for (const target of wanted) {
            const known = this.#registeredTargets.get(target);
            if (known?.isConnected) continue;

            const container = this.#findById(target);
            if (container && container !== known) {
                this.#registeredTargets.set(target, container);
                newTargets.set(target, container);
            }
        }
        if (newTargets.size > 0) this.#onTargetDiscovered?.(newTargets);
    }

    discoverFrames() {
        this.#forget(this.#registeredFrames, (el) => this.#registeredFrames.delete(el));

        const frameElements = this.#root.querySelectorAll("iframe");
        const newFrames = [];

        for (const element of frameElements) {
            if (!this.#registeredFrames.has(element)) {
                this.#registeredFrames.add(element);
                newFrames.push(element);
            }
        }

        if (newFrames.length > 0) this.#onFrameDiscovered?.(newFrames);
    }

    clear() {
        this.#registeredLinks.clear();
        this.#registeredTargets.clear();
        this.#registeredFrames.clear();
        this.#defaultTarget = null;
    }

    // ───────── internals ─────────

    /** Elements removed from the page are forgotten, so they are discovered again if they come back. */
    #forget(elements, remove) {
        for (const el of [...elements]) if (!el.isConnected) remove(el);
    }

    /** `getElementById` only exists on a document / shadow root; a scope is an element. */
    // #findById(id) {
    //     return typeof this.#root.getElementById === "function"
    //         ? this.#root.getElementById(id)
    //         : this.#root.querySelector(`#${CSS.escape(id)}`);
    // }
    #findById(id) {
        const escaped = (typeof CSS !== "undefined" && CSS.escape)
            ? CSS.escape(id)
            : id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");

        return this.#root.querySelector(`#${escaped}`);
    }
}