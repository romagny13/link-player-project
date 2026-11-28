/** Default Renderer mis à jour avec le nouveau design */
export class TooltipRenderer {
    render() {
        const tip = document.createElement("div");
        tip.className = "lp-tip";

        const loader = document.createElement("div");
        loader.className = "lp-tip-loader";

        const img = document.createElement("img");
        img.alt = "";

        const play = document.createElement("div");
        play.className = "lp-tip-play";

        const span = document.createElement("span");
        span.className = "lp-tip-title";

        tip.append(loader, img, play, span);
        return tip;
    }

    onShow(tip, {title, provider}) {
        const [loader, img] = tip.children;
        tip.dataset.provider = provider.id ?? "";
        tip.dataset.name = provider.name ?? "";
        tip.classList.remove("lp-nothumb");
        tip.lastChild.textContent = title;
        loader.hidden = false;
        img.hidden = true;
        img.removeAttribute("src");
    }

    onLoading(tip) {
        const [loader] = tip.children;
        loader.hidden = false;
    }

    onThumbLoaded(tip, url) {
        const [loader, img] = tip.children;
        loader.hidden = true;
        img.src = url;
        img.hidden = false;
    }

    onFallback(tip) {
        const [loader] = tip.children;
        loader.hidden = true;
        tip.classList.add("lp-nothumb");
    }
}