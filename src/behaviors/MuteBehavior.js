export class MuteBehavior {
    #applied = new WeakSet();
    #off = null;

    attach(region) {
        this.#off = region.afterNavigate(({info, view, reason}) => {
            if (!view || !info.mute || reason === "detach" || this.#applied.has(view)) return;
            this.#applied.add(view);
            if (!view.canMute) return region.report(new Error(`mute is not supported by '${info.provider}'`), {info});
            view.mute();
        });
    }

    dispose() {
        this.#off?.();
    }
}

