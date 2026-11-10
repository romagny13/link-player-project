export class ValueChecks {
    static requireNotNull(value, name = 'value') {
        if (value === null || value === undefined) {
            throw new Error(`${name} must not be null or undefined`);
        }
    }

    static requireNotNullOrEmpty(value, name = 'value') {
        this.requireNotNull(value, name);

        // String
        if (typeof value === 'string' && value.trim().length === 0) {
            throw new Error(`${name} must not be empty`);
        }

        // Array
        if (Array.isArray(value) && value.length === 0) {
            throw new Error(`${name} must not be empty`);
        }

        // Map / Set
        if ((value instanceof Map || value instanceof Set) && value.size === 0) {
            throw new Error(`${name} must not be empty`);
        }

        // Object
        if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
            throw new Error(`${name} must not be empty`);
        }

    }
}