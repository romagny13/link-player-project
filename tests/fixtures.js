import {vi} from "vitest";

export const link = (url, dataset = {}) => ({
    tagName: "A",
    href: url,
    dataset: {target: "#player", ...dataset}
});

export const div = (url, dataset = {}) => ({
    tagName: "DIV",
    dataset: {target: "#player", url, ...dataset}
});

/**
 * A fake player, as the providers' createPlayer() would give: the region / link player only use this surface.
 * `emit()` plays the role of the real player (a bridge event) towards whoever subscribed.
 */
export function makePlayer({kind = "fake", iframe = null} = {}) {
    let listener = null;
    return {
        kind,
        iframe: iframe ?? document.createElement("iframe"),
        subscribe: vi.fn((callback) => {
            listener = callback;
            return vi.fn(() => {
                listener = null;
            });
        }),
        load: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        next: vi.fn(),
        previous: vi.fn(),
        playAt: vi.fn(),
        dispose: vi.fn(),
        emit: (event) => listener?.(event)
    };
}

/** A fake panel renderer (the real one draws DOM, tested elsewhere). */
export function makePanel() {
    return {render: vi.fn(), setCurrent: vi.fn(), clear: vi.fn(), destroy: vi.fn()};
}

/**
 * A fake info with the surface used by Region and LinkPlayer. Like the real models:
 * a list has `videoIds`, a playlist only `videos`, only a single video has `autoplay`.
 */
export function makeInfo(props = {}) {
    return {
        provider: "fake",
        isPlaylist: false,
        videos: [],
        setVideos(videos) {
            this.videos = [...videos];
        },
        ...props
    };
}