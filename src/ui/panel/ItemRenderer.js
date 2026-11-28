import {ThumbnailService} from "../ThumbnailService.js";

export function safeHttpUrl(value) {
    try {
        const u = new URL(String(value).trim(), globalThis.location?.href);
        return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch {
        return null;
    }
}

export class ItemRenderer {
    constructor(thumbnails = null) {
        this._thumbnails = thumbnails ?? new ThumbnailService();
    }

    render(item, index, isCurrent = false) {
        const title = item.title || `Video ${index + 1}`;

        const row = document.createElement("div");
        row.className = "lp-item";
        row.dataset.index = String(index);
        row.title = title;
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        if (isCurrent) {
            row.dataset.current = "";
            row.setAttribute("aria-current", "true");
        }

        const text = document.createElement("div");
        text.className = "lp-info";

        const titleEl = document.createElement("div");
        titleEl.className = "lp-title";
        titleEl.textContent = title;
        text.append(titleEl);

        if (item.channel) {
            const href = safeHttpUrl(item.channelUrl);
            const chan = document.createElement(href ? "a" : "div");
            chan.className = "lp-chan";
            chan.textContent = item.channel;
            if (href) {
                chan.href = href;
                chan.target = "_blank";
                chan.rel = "noopener noreferrer";
                chan.addEventListener("click", (e) => e.stopPropagation());
            }
            text.append(chan);
        }

        if (item.thumbnail) {
            const thumb = document.createElement("div");
            thumb.className = "lp-thumb";

            const image = document.createElement("img");
            image.alt = "";
            image.loading = "lazy";
            this._thumbnails.resolve(item.thumbnail).then((url) => {
                if (url) image.src = url;
                else thumb.remove(); // broken or missing: the row falls back to the number
            });

            const tn = document.createElement("span");
            tn.className = "lp-tn";
            tn.textContent = String(index + 1);

            thumb.append(image, tn);
            row.append(thumb, text);
        } else {
            const num = document.createElement("span");
            num.className = "lp-num";
            num.textContent = String(index + 1).padStart(2, "0");

            row.append(num, text);
        }

        return row;
    }
}