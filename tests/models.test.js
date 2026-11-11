import {describe, expect, it} from "vitest";
import {YouTubeThumbnailUrlBuilder} from "../src/providers/youtube/YouTubeThumbnailUrlBuilder.js";
import {InfoParser} from "../src/providers/InfoParser.js";
import {YouTubeInfoParser} from "../src/providers/youtube/YouTubeInfoParser.js";
import {UrlInfo} from "../src/models/UrlInfo.js";
import {VideoInfo} from "../src/models/VideoInfo.js";
import {VideoListInfo} from "../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../src/models/PlaylistInfo.js";

describe("UrlInfo", () => {
    it("expose tous les champs", () => {
        const info = new UrlInfo({
            kind: "videoList",
            videoId: "v",
            videoIds: ["a", "b"],
            playlistId: "p",
            index: 2,
            startSeconds: 10,
            labels: ["x"]
        });
        expect(info.kind).toBe("videoList");
        expect(info.videoId).toBe("v");
        expect(info.videoIds).toEqual(["a", "b"]);
        expect(info.playlistId).toBe("p");
        expect(info.index).toBe(2);
        expect(info.startSeconds).toBe(10);
        expect(info.labels).toEqual(["x"]);
    });
});

describe("VideoInfo", () => {
    const base = {provider: "youtube", target: "player", videoId: "abc"};

    it("expose les valeurs et isPlaylist=false", () => {
        const v = new VideoInfo({
            ...base,
            autoplay: "init",
            startSeconds: 5,
            title: "T",
            channel: "C",
            thumbnail: "th",
            showOnInit: true
        });
        expect(v).toMatchObject({
            provider: "youtube",
            target: "player",
            videoId: "abc",
            autoplay: "init",
            startSeconds: 5,
            title: "T",
            channel: "C",
            thumbnail: "th",
            showOnInit: true,
            isPlaylist: false
        });
    });

    it("génère une clé par défaut provider:videoId", () => {
        expect(new VideoInfo(base).key).toBe("youtube:abc");
    });

    it("utilise la clé fournie", () => {
        expect(new VideoInfo({...base, key: "custom"}).key).toBe("custom");
    });

    it.each(["provider", "target", "videoId"])("lève si %s est vide", (field) => {
        expect(() => new VideoInfo({...base, [field]: ""})).toThrow();
        expect(() => new VideoInfo({...base, [field]: null})).toThrow();
        expect(() => new VideoInfo({...base, [field]: undefined})).toThrow();
    });

    describe("fillMissing", () => {
        it("remplit uniquement les champs vides et retourne true", () => {
            const v = new VideoInfo({...base, title: "", channel: "Existing", thumbnail: undefined});
            const changed = v.fillMissing({title: "New", channel: "Other", thumbnail: "img"});
            expect(changed).toBe(true);
            expect(v.title).toBe("New");
            expect(v.channel).toBe("Existing");
            expect(v.thumbnail).toBe("img");
        });

        it("retourne false si rien ne change", () => {
            const v = new VideoInfo({...base, title: "A", channel: "B", thumbnail: "C"});
            expect(v.fillMissing({title: "X", channel: "Y", thumbnail: "Z"})).toBe(false);
            expect(v.title).toBe("A");
        });

        it("ignore les valeurs vides fournies et accepte l'appel sans argument", () => {
            const v = new VideoInfo({...base, title: ""});
            expect(v.fillMissing({title: ""})).toBe(false);
            expect(v.fillMissing()).toBe(false);
            expect(v.title).toBe("");
        });
    });
});

describe("VideoListInfo", () => {
    it("expose les valeurs, isPlaylist=true et clé par défaut", () => {
        const l = new VideoListInfo("youtube", "player", ["a", "b"], 1, true);
        expect(l.provider).toBe("youtube");
        expect(l.target).toBe("player");
        expect(l.videoIds).toEqual(["a", "b"]);
        expect(l.index).toBe(1);
        expect(l.showOnInit).toBe(true);
        expect(l.isPlaylist).toBe(true);
        expect(l.key).toBe("youtube:list:a,b");
    });

    it("utilise la clé fournie", () => {
        expect(new VideoListInfo("youtube", "t", ["a"], 0, false, "k").key).toBe("k");
    });

    it("copie les ids : muter le tableau d'origine n'a aucun effet", () => {
        const ids = ["a", "b"];
        const l = new VideoListInfo("youtube", "t", ids);
        ids.push("c");
        expect(l.videoIds).toEqual(["a", "b"]);
    });

    it("videoIds et videos sont gelés", () => {
        const l = new VideoListInfo("youtube", "t", ["a"]);
        expect(Object.isFrozen(l.videoIds)).toBe(true);
        expect(Object.isFrozen(l.videos)).toBe(true);
    });

    it("addVideo / setVideos", () => {
        const l = new VideoListInfo("youtube", "t", ["a"]);
        l.addVideo("v1");
        l.addVideo("v2");
        expect(l.videos).toEqual(["v1", "v2"]);
        l.setVideos(["x"]);
        expect(l.videos).toEqual(["x"]);
    });

    it.each(["provider", "target"])("lève si %s est vide", (field) => {
        const args = {provider: "p", target: "t", [field]: ""};
        expect(() => new VideoListInfo(args.provider, args.target, ["a"])).toThrow();
    });
});

describe("PlaylistInfo", () => {
    it("expose les valeurs, isPlaylist=true et clé par défaut", () => {
        const p = new PlaylistInfo("youtube", "player", "PL1", "vid", true);
        expect(p.provider).toBe("youtube");
        expect(p.target).toBe("player");
        expect(p.playlistId).toBe("PL1");
        expect(p.videoId).toBe("vid");
        expect(p.showOnInit).toBe(true);
        expect(p.isPlaylist).toBe(true);
        expect(p.key).toBe("youtube:playlist:PL1");
    });

    it("utilise la clé fournie", () => {
        expect(new PlaylistInfo("y", "t", "PL", null, false, "k").key).toBe("k");
    });

    it("addVideo / setVideos et videos gelé", () => {
        const p = new PlaylistInfo("y", "t", "PL");
        p.addVideo(1);
        expect(p.videos).toEqual([1]);
        expect(Object.isFrozen(p.videos)).toBe(true);
        p.setVideos([2, 3]);
        expect(p.videos).toEqual([2, 3]);
    });

    it.each([
        ["provider", ["", "t", "PL"]],
        ["target", ["p", "", "PL"]],
        ["playlistId", ["p", "t", ""]],
    ])("lève si %s est vide", (_name, args) => {
        expect(() => new PlaylistInfo(...args)).toThrow();
    });
});
