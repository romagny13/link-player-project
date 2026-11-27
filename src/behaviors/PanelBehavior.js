/**
 * ROLE: draw the playlist panel next to the active view, and keep it on the playing item.
 * Reads the region only through afterNavigate; clicking a row asks the region for that item.
 * One PanelRenderer per region (it is anchored to one host element).
 */
export class PanelBehavior {
    #panel;
    #off = null;
    #drawn = null; // { info, root }

    /** @param {PanelRenderer} panel */
    constructor({panel}) {
        this.#panel = panel;
    }

    attach(region) {
        this.#off = region.afterNavigate((ctx) => this.#sync(ctx));
    }

    dispose() {
        this.#off?.();
        this.#panel.destroy();
        this.#drawn = null;
    }

    #sync({region, info, index, view, reason}) {
        if (!view?.root || !info.isPlaylist) return this.#clear();

        const root = view.root;
        const same = this.#drawn?.info === info && this.#drawn.root === root;
        if (same && reason !== "meta") return this.#panel.setCurrent(index);

        // the panel is anchored to an iframe: another info / iframe, or new titles, draw it again
        this.#panel.clear();
        this.#drawn = {info, root};
        this.#panel.render({
            host: region.element,
            iframe: root,
            info,
            current: index,
            togglePosition: view.togglePosition ?? undefined,
            onSelectItem: (i) => region.selectItem(i)
        });
    }

    #clear() {
        if (!this.#drawn) return;
        this.#panel.clear();
        this.#drawn = null;
    }
}
