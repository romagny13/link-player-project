import { describe, it, expect } from "vitest";
import { VideoInfo } from "../src/models/VideoInfo.js";
import { VideoListInfo } from "../src/models/VideoListInfo.js";
import { PlaylistInfo } from "../src/models/PlaylistInfo.js";
import { UrlInfo, SrcInfo } from "../src/models/UrlInfo.js";

// ───────────────────────── VideoInfo ─────────────────────────
describe("VideoInfo", () => {
    const make = (o = {}) => new VideoInfo({ provider: "youtube", target: "player", videoId: "abc", ...o });

    it("exige provider, target et videoId", () => {
        expect(() => make({ provider: undefined })).toThrow(/provider/);
        expect(() => make({ target: "" })).toThrow(/target/);
        expect(() => make({ videoId: "   " })).toThrow(/videoId/);
        expect(() => make({ videoId: null })).toThrow(/videoId/);
    });

    it("n'est pas une playlist", () => {
        expect(make().isPlaylist).toBe(false);
    });

    it("key par défaut = provider:videoId, key personnalisée prioritaire", () => {
        expect(make().key).toBe("youtube:abc");
        expect(make({ provider: "okru", videoId: "123" }).key).toBe("okru:123");
        expect(make({ key: "maldives" }).key).toBe("maldives");
    });

    it("expose toutes les valeurs données au constructeur", () => {
        const source = { kind: "link" };
        const extra = { a: 1 };
        const v = make({
            autoplay: "click", startSeconds: 90, title: "T", description: "D", channel: "C",
            channelUrl: "https://c", thumbnail: "https://t", duration: 120, showOnInit: true, extra, source
        });
        expect(v).toMatchObject({
            provider: "youtube", target: "player", videoId: "abc", autoplay: "click", startSeconds: 90,
            title: "T", description: "D", channel: "C", channelUrl: "https://c", thumbnail: "https://t",
            duration: 120, showOnInit: true
        });
        expect(v.extra).toBe(extra);
        expect(v.source).toBe(source);
    });

    it("format : landscape par défaut, alias reconnus, valeur inconnue = landscape", () => {
        expect(make().format).toBe("landscape");
        expect(make({ format: "shorts" }).format).toBe("portrait");
        expect(make({ format: "1:1" }).format).toBe("square");
        expect(make({ format: "bogus" }).format).toBe("landscape");
    });

    it("mute : faux par défaut, converti comme un attribut data-*", () => {
        expect(make().mute).toBe(false);
        expect(make({ mute: true }).mute).toBe(true);
        expect(make({ mute: "true" }).mute).toBe(true);
        expect(make({ mute: "" }).mute).toBe(true);
        expect(make({ mute: "false" }).mute).toBe(false);
    });

    describe("fillMissing", () => {
        it("remplit uniquement les champs vides et renvoie true", () => {
            const v = make({ title: "Garde" });
            const changed = v.fillMissing({ title: "Nouveau", description: "D", channel: "C", channelUrl: "u", thumbnail: "t", duration: 60 });
            expect(changed).toBe(true);
            expect(v).toMatchObject({ title: "Garde", description: "D", channel: "C", channelUrl: "u", thumbnail: "t", duration: 60 });
        });

        it("renvoie false quand rien ne change", () => {
            const v = make({ title: "T" });
            expect(v.fillMissing({ title: "Autre" })).toBe(false);
            expect(v.fillMissing({ description: "" })).toBe(false);
            expect(v.fillMissing()).toBe(false);
        });

        it("ne remplit pas deux fois", () => {
            const v = make();
            expect(v.fillMissing({ title: "A" })).toBe(true);
            expect(v.fillMissing({ title: "B" })).toBe(false);
            expect(v.title).toBe("A");
        });

        it("duration 0 est une valeur (pas vide), duration null est vide", () => {
            expect(make({ duration: 0 }).fillMissing({ duration: 50 })).toBe(false);
            const v = make({ duration: null });
            expect(v.fillMissing({ duration: 50 })).toBe(true);
            expect(v.duration).toBe(50);
        });
    });
});

// ───────────────────── VideoListInfo / PlaylistInfo ─────────────────────
describe.each([
    ["VideoListInfo", VideoListInfo, { videoIds: ["a", "b"] }, "youtube:list:a,b"],
    ["PlaylistInfo", PlaylistInfo, { playlistId: "PL1" }, "youtube:playlist:PL1"]
])("%s (comportement commun)", (_name, Model, specific, defaultKey) => {
    const make = (o = {}) => new Model({ provider: "youtube", target: "player", ...specific, ...o });
    const video = (id) => new VideoInfo({ provider: "youtube", target: "player", videoId: id });

    it("est une playlist", () => expect(make().isPlaylist).toBe(true));
    it("exige provider et target", () => {
        expect(() => make({ provider: "" })).toThrow(/provider/);
        expect(() => make({ target: null })).toThrow(/target/);
    });
    it("key par défaut / personnalisée", () => {
        expect(make().key).toBe(defaultKey);
        expect(make({ key: "ma-cle" }).key).toBe("ma-cle");
    });
    it("commence sans vidéos", () => expect(make().videos).toEqual([]));

    it("addVideo ajoute dans l'ordre", () => {
        const info = make();
        info.addVideo(video("x"));
        info.addVideo(video("y"));
        expect(info.videos.map((v) => v.videoId)).toEqual(["x", "y"]);
    });

    it("setVideos remplace tout (et copie le tableau reçu)", () => {
        const info = make();
        info.addVideo(video("old"));
        const arr = [video("n1"), video("n2")];
        info.setVideos(arr);
        arr.push(video("n3"));
        expect(info.videos.map((v) => v.videoId)).toEqual(["n1", "n2"]);
    });

    it("videos est gelé : on ne le modifie pas de l'extérieur", () => {
        const info = make();
        expect(Object.isFrozen(info.videos)).toBe(true);
        expect(() => info.videos.push(video("z"))).toThrow(TypeError);
    });

    it("format et mute comme VideoInfo", () => {
        expect(make().format).toBe("landscape");
        expect(make({ format: "vertical" }).format).toBe("portrait");
        expect(make().mute).toBe(false);
        expect(make({ mute: true }).mute).toBe(true);
    });

    it("expose showOnInit, autoplay, extra, source", () => {
        const extra = { x: 1 };
        const source = { kind: "link" };
        const info = make({ showOnInit: true, autoplay: "init", extra, source });
        expect(info.showOnInit).toBe(true);
        expect(info.autoplay).toBe("init");
        expect(info.extra).toBe(extra);
        expect(info.source).toBe(source);
    });
});

describe("VideoListInfo (spécifique)", () => {
    const make = (o = {}) => new VideoListInfo({ provider: "youtube", target: "p", videoIds: ["a", "b"], ...o });

    it("exige des videoIds non vides", () => {
        expect(() => make({ videoIds: [] })).toThrow(/videoIds/);
        expect(() => make({ videoIds: undefined })).toThrow(/videoIds/);
    });
    it("copie et gèle videoIds", () => {
        const ids = ["a", "b"];
        const info = make({ videoIds: ids });
        ids.push("c");
        expect(info.videoIds).toEqual(["a", "b"]);
        expect(Object.isFrozen(info.videoIds)).toBe(true);
    });
    it("expose index", () => expect(make({ index: 1 }).index).toBe(1));
});

describe("PlaylistInfo (spécifique)", () => {
    const make = (o = {}) => new PlaylistInfo({ provider: "youtube", target: "p", playlistId: "PL1", ...o });

    it("exige un playlistId", () => {
        expect(() => make({ playlistId: "" })).toThrow(/playlistId/);
        expect(() => make({ playlistId: undefined })).toThrow(/playlistId/);
    });
    it("videoId de départ optionnel", () => {
        expect(make().videoId).toBeUndefined();
        expect(make({ videoId: "start" }).videoId).toBe("start");
        expect(make().playlistId).toBe("PL1");
    });
});

// ───────────────────────── UrlInfo / SrcInfo ─────────────────────────
describe("UrlInfo", () => {
    it("expose ce qui a été analysé", () => {
        const u = new UrlInfo({
            kind: "videoList", videoId: "a", videoIds: ["a", "b"], playlistId: "PL", startSeconds: 10,
            index: 1, labels: ["A", "B"], format: "portrait", source: "https://x"
        });
        expect(u).toMatchObject({
            kind: "videoList", videoId: "a", videoIds: ["a", "b"], playlistId: "PL", startSeconds: 10,
            index: 1, labels: ["A", "B"], format: "portrait", source: "https://x"
        });
    });
    it("les champs absents sont undefined", () => {
        const u = new UrlInfo({ kind: "video" });
        expect(u.videoId).toBeUndefined();
        expect(u.labels).toBeUndefined();
    });
});

describe("SrcInfo", () => {
    it("étend UrlInfo avec autoplay et mute", () => {
        const s = new SrcInfo({ kind: "video", videoId: "a", autoplay: true, mute: false });
        expect(s).toBeInstanceOf(UrlInfo);
        expect(s.kind).toBe("video");
        expect(s.autoplay).toBe(true);
        expect(s.mute).toBe(false);
    });
});
