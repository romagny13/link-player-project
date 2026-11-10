export class ThumbnailService {
    #pending = new Map();

    /** @param {{ createImage?: () => HTMLImageElement }} options Injectable for tests. */
    constructor({ createImage = () => new Image() } = {}) {
        this.createImage = createImage;
    }

    /** @returns {Promise<string|null>} The url if it loads as an image, null otherwise. Never rejects. */
    resolve(url) {
        if (!url) return Promise.resolve(null);
        if (!this.#pending.has(url)) {
            const p = this.#load(url);
            this.#pending.set(url, p);
            p.then((result) => { if (!result) this.#pending.delete(url); });
        }
        return this.#pending.get(url);
    }

    #load(url) {
        return new Promise((resolve) => {
            const image = this.createImage();
            image.onload = () => resolve(url);
            image.onerror = () => resolve(null);
            image.src = url;
        });
    }
}