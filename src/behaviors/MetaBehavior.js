/**
 * ROLE: the first time an info is shown, ask the MetaService to complete it; when it changed something,
 * tell the region (reason "meta") so the other hooks (panel, tooltip...) draw again.
 */
export class MetaBehavior {
    #meta;
    #off = null;

    /** @param {MetaService} meta */
    constructor({meta}) {
        this.#meta = meta;
    }

    attach(region) {
        this.#off = region.afterNavigate(({info, reason}) => {
            if (reason === "meta" || reason === "detach") return;
            this.#meta.ensure(info).then(
                (changed) => changed && region.isCurrent(info.key) && region.notify("meta"),
                (error) => region.report(error, {info})
            );
        });
    }

    dispose() {
        this.#off?.();
    }
}
