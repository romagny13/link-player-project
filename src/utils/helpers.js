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
    if (input == null) throw new TypeError("DefBuilder: input is required");
    if (typeof input === "string") return {url: input};
    if (typeof input === "object") return {...input};
    throw new TypeError("DefBuilder: expected url string or object");
}

function createBuilder(type, input, batchList = null) {
    const data = {type, ...normalizeSeed(input)};

    if (!batchList) {
        batchList = [data];
    } else {
        batchList.push(data);
    }

    const set = (k, v) => {
        data[k] = v;
        return api;
    };

    const api = {
        title: (v) => set("title", v),
        description: (v) => set("description", v),
        channel(v, url = null) {
            data.channel = v;
            if (url) {
                data.channelUrl = url;
            }
            return api;
        },
        thumbnail: (v) => set("thumbnail", v),
        duration: (v) => set("duration", v),
        autoplay: (v = AUTOPLAY_MODES.INIT) => set("autoplay", v),
        start: (v) => set("start", v),
        showOnInit: (v = true) => set("showOnInit", v),
        target: (v) => set("target", v),
        key: (v) => set("key", v),
        name: (v) => set("name", v),
        videos(v) {
            data.videos = v;
            return api;
        },
        extra: (v) => set("extra", v),

        video(input) {
            return createBuilder("video", input, batchList);
        },
        videoList(input) {
            return createBuilder("videoList", input, batchList);
        },
        playlist(input) {
            return createBuilder("playlist", input, batchList);
        },

        build() {
            return batchList;
        }
    };

    return api;
}

export const DefBuilder = {
    video: (input) => createBuilder("video", input),
    videoList: (input) => createBuilder("videoList", input),
    playlist: (input) => createBuilder("playlist", input),
};
