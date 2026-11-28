/**
 * The panel reacts to `data-lp-action` on any element of its content, so a custom renderer only has to set it:
 *   "close"         hides the panel
 *   "toggle-group"  folds / unfolds the season the element belongs to
 * and to `data-index` on an item (selects it).
 */
export class HeaderRenderer {
    render({count, canClose}) {
        const head = document.createElement("div");
        head.className = "lp-head";

        const title = document.createElement("span");
        title.className = "lp-head-title";
        title.textContent = `Playlist · ${count}`;
        head.append(title);

        if (canClose) {
            const close = document.createElement("button");
            close.type = "button";
            close.className = "lp-close";
            close.textContent = "»";
            close.title = "Hide playlist";
            close.setAttribute("aria-label", "Hide playlist");
            close.dataset.lpAction = "close";
            head.append(close);
        }
        return head;
    }
}