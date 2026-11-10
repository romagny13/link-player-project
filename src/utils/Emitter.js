/**
 * Minimal event emitter. Handlers receive `{type, ...data}`.
 * "*" receives every event. A failing handler does not break the others.
 */
export class Emitter {
    #handlers = new Map();

    /** @returns {() => void} Function that removes the handler. */
    on(type, handler) {
        if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
        this.#handlers.get(type).add(handler);
        return () => this.off(type, handler);
    }

    off(type, handler) {
        this.#handlers.get(type)?.delete(handler);
    }

    /** @returns {number} How many handlers were called (0: nobody listens). */
    emit(type, data = {}) {
        const event = {...data, type};
        const handlers = [...(this.#handlers.get(type) ?? []), ...(this.#handlers.get("*") ?? [])];
        for (const handler of handlers) {
            try {
                handler(event);
            } catch (error) {
                console.error(`[Emitter] handler of "${type}" failed`, error);
            }
        }
        return handlers.length;
    }

    clear() {
        this.#handlers.clear();
    }
}