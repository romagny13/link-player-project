export class FormatBehavior {
    #off = null;
    #el = null;

    attach(region) {
        this.#off = region.afterNavigate(({info, item}) => {
            const el = region.element;
            if (el !== this.#el) {
                this.#el?.removeAttribute("data-lp-format");
                this.#el = el;
            }
            el?.setAttribute("data-lp-format", item?.format ?? info.format ?? FORMATS.LANDSCAPE);
        });
    }

    dispose() {
        this.#off?.();
        this.#el?.removeAttribute("data-lp-format");
        this.#el = null;
    }
}