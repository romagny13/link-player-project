export const toInt = (value) => {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? undefined : n;
};

export const toNumber = (value) => {
    if (value === undefined || value === null || String(value).trim() === "") return undefined;
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
};

/** data-x (present, "", "true") -> true; absent, "false", "0", "no" -> false. */
export function toBoolean(value) {
    if (value === undefined || value === null) return false;
    return !["false", "0", "no"].includes(String(value).trim().toLowerCase());
}

export const isEmpty = (v) => v === "" || v == null;

export const isTouch = () =>
    !!globalThis.matchMedia?.("(hover: none) and (pointer: coarse)").matches;

export const AUTOPLAY_MODES = Object.freeze({
    NONE: "none", // false
    INIT: "init", // true
    CLICK: "click" // click
});

export function toAutoplayMode(value) {
    if (value === undefined || value === null) return AUTOPLAY_MODES.NONE;
    const v = String(value).trim().toLowerCase();
    if (v === "" || v === "true") return AUTOPLAY_MODES.INIT;
    if (v === "click") return AUTOPLAY_MODES.CLICK;
    return AUTOPLAY_MODES.NONE;
}

function normalizeSeed(input) {
    if (input == null) throw new TypeError("Media: input is required");
    if (typeof input === "string") return {url: input};
    if (typeof input === "object") return {...input};
    throw new TypeError("Media: expected url string or object");
}

function createBuilder(type, input, batchList = null) {
    const def = {type, ...normalizeSeed(input)};

    if (!batchList) {
        batchList = [def];
    } else {
        batchList.push(def);
    }

    const set = (k, v) => {
        def[k] = v;
        return api;
    };

    const api = {
        title: (v) => set("title", v),
        channel(v) {
            def.channel = v;
            return api;
        },
        thumbnail: (v) => set("thumbnail", v),
        autoplay: (v = AUTOPLAY_MODES.INIT) => set("autoplay", v),
        start: (v) => set("start", v),
        showOnInit: (v = true) => set("showOnInit", v),
        target: (v) => set("target", v),
        key: (v) => set("key", v),
        name: (v) => set("name", v),
        videos(v) {
            def.videos = v;
            return api;
        },

        // --- Permet d'enchaîner les types en conservant la même liste ---
        video(input) {
            return createBuilder("video", input, batchList);
        },
        videoList(input) {
            return createBuilder("videoList", input, batchList);
        },
        playlist(input) {
            return createBuilder("playlist", input, batchList);
        },

        // --- Retourne toujours un tableau ---
        build() {
            return batchList;
        }
    };

    return api;
}

export const Media = {
    video: (input) => createBuilder("video", input),
    videoList: (input) => createBuilder("videoList", input),
    playlist: (input) => createBuilder("playlist", input),
};
