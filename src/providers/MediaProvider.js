/**
 * ROLE: describe a provider (youtube, okru...): its id, its hosts, how to read an Info from a link / frame /
 * definition (parser), and how to make a view (a view factory). Nothing else: no DOM, no state.
 * Adding a provider = one descriptor + one MediaView subclass + a parser.
 */
export class MediaProvider {
    id = null;
    hosts = [];

    constructor() {
        if (new.target === MediaProvider) throw new Error("MediaProvider is an abstract class.");
    }

    getInfoFromLink(link) {
        throw new Error(`${this.constructor.name} must implement getInfoFromLink().`);
    }

    getInfoFromFrame(frame) {
        throw new Error(`${this.constructor.name} must implement getInfoFromFrame().`);
    }

    getInfoFromDefinition(definition) {
        throw new Error(`${this.constructor.name} must implement getInfoFromDefinition().`);
    }

    /** @param {{iframe?: HTMLIFrameElement}} [options]  an iframe: the view ADOPTS it instead of creating one. */
    createView({iframe = null} = {}) {
        throw new Error(`${this.constructor.name} must implement createView().`);
    }
}
