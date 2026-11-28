export class ToggleRenderer {
    /** @param {{ position?: string | object }} options Default position, used when the panel does not give one. */
    constructor({position = "top-right"} = {}) {
        this.defaultPosition = position;
    }

    render({position = this.defaultPosition} = {}) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lp-toggle";
        button.textContent = "☰";
        button.title = "Show playlist";
        button.setAttribute("aria-label", "Show playlist");

        if (typeof position === "string") button.dataset.pos = position;
        else Object.assign(button.style, position);
        return button;
    }
}