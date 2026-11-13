export class MediaProvider {
    id = null;
    hosts = [];

    constructor() {
        if (new.target === MediaProvider) {
            throw new Error("MediaProvider is an abstract class.");
        }
    }

    getInfoFromLink(link) {
        throw new Error(`${this.constructor.name} must implement getInfoFromElement().`);
    }

    getInfoFromFrame(frame) {
        throw new Error(`${this.constructor.name} must implement getInfoFromFrame().`);
    }

    getInfoFromDefinition(definition) {
        throw new Error(`${this.constructor.name} must implement getInfoFromDefinition().`);
    }

    createPlayer(options = {}) {
        throw new Error(`${this.constructor.name} must implement createPlayer().`);
    }
}