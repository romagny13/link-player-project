/** The head of a season: the button that folds / unfolds it. */
export class GroupRenderer {
    render({label, count, collapsed}) {
        const head = document.createElement("button");
        head.type = "button";
        head.className = "lp-group-head";
        head.textContent = `${label} · ${count}`;
        head.dataset.lpAction = "toggle-group";
        head.setAttribute("aria-expanded", String(!collapsed));
        return head;
    }
}