import {describe, expect, it} from "vitest";
import {VideoInfo} from "../src/models/VideoInfo.js";
import {PlaylistInfo} from "../src/models/PlaylistInfo.js";
import {VideoListInfo} from "../src/models/VideoListInfo.js";
import {SrcInfo, UrlInfo} from "../src/models/UrlInfo.js";

// Remarque : ValueChecks.requireNotNullOrEmpty est remplacé ici par une version minimale
// (null / undefined / "" => erreur). Les tests vérifient donc seulement « ça lève une erreur »,
// pas son message.

const base = {provider: "youtube", target: "player", videoId: "3HSKp9pVMKY"};

describe("VideoInfo", () => {
    it("exige providers, target et videoId", () => {
        for (const champ of ["provider", "target", "videoId"]) {
            expect(() => new VideoInfo({...base, [champ]: undefined})).toThrow();
            expect(() => new VideoInfo({...base, [champ]: ""})).toThrow();
        }
    });

    it("expose toutes ses propriétés", () => {
        const info = new VideoInfo({
            ...base,
            autoplay: "init",
            startSeconds: 90,
            title: "Titre",
            description: "Desc",
            channel: "Chaîne",
            channelUrl: "https://c.example",
            thumbnail: "t.jpg",
            duration: 120,
            showOnInit: true,
            extra: "x",
            source: "https://src"
        });
        expect(info).toMatchObject({
            provider: "youtube", target: "player", videoId: "3HSKp9pVMKY", autoplay: "init",
            startSeconds: 90, title: "Titre", description: "Desc", channel: "Chaîne",
            channelUrl: "https://c.example", thumbnail: "t.jpg", duration: 120, showOnInit: true,
            extra: "x", source: "https://src"
        });
    });

    it("n'est pas une playlist", () => {
        expect(new VideoInfo(base).isPlaylist).toBe(false);
    });

    it("clé par défaut = providers:videoId, sinon la clé fournie", () => {
        expect(new VideoInfo(base).key).toBe("youtube:3HSKp9pVMKY");
        expect(new VideoInfo({...base, key: "ma-cle"}).key).toBe("ma-cle");
    });

    describe("fillMissing", () => {
        it("complète les champs vides et retourne true", () => {
            const info = new VideoInfo({...base, title: ""});
            const changed = info.fillMissing({
                title: "T", description: "D", channel: "C", channelUrl: "U", thumbnail: "I", duration: 60
            });
            expect(changed).toBe(true);
            expect(info).toMatchObject({
                title: "T", description: "D", channel: "C", channelUrl: "U", thumbnail: "I", duration: 60
            });
        });

        it("n'écrase jamais une valeur déjà renseignée", () => {
            const info = new VideoInfo({...base, title: "Mon titre", duration: 10});
            const changed = info.fillMissing({title: "Autre", duration: 99});
            expect(changed).toBe(false);
            expect(info.title).toBe("Mon titre");
            expect(info.duration).toBe(10);
        });

        it("ignore les nouvelles valeurs vides et ne signale alors aucun changement", () => {
            const info = new VideoInfo(base);
            expect(info.fillMissing({title: "", description: undefined})).toBe(false);
            expect(info.title).toBeUndefined();
        });

        it("fonctionne sans argument", () => {
            expect(new VideoInfo(base).fillMissing()).toBe(false);
        });

        it("retourne true dès qu'un seul champ change", () => {
            const info = new VideoInfo({...base, title: "déjà là"});
            expect(info.fillMissing({title: "x", channel: "C"})).toBe(true);
            expect(info.title).toBe("déjà là");
            expect(info.channel).toBe("C");
        });
    });
});

describe("PlaylistInfo", () => {
    const creer = (overrides = {}) => new PlaylistInfo({
        provider: "youtube",
        target: "player",
        playlistId: "PL123",
        ...overrides
    });

    it("exige providers, target et playlistId", () => {
        expect(() => new PlaylistInfo({ provider: "", target: "player", playlistId: "PL1" })).toThrow();
        expect(() => new PlaylistInfo({ provider: "youtube", target: undefined, playlistId: "PL1" })).toThrow();
        expect(() => new PlaylistInfo({ provider: "youtube", target: "player", playlistId: "" })).toThrow();
    });

    it("clé par défaut = providers:playlist:id", () => {
        expect(creer().key).toBe("youtube:playlist:PL123");
    });

    it("accepte une clé personnalisée", () => {
        expect(creer({ key: "ma-cle-perso" }).key).toBe("ma-cle-perso");
    });

    it("addVideo ajoute, setVideos remplace par une copie", () => {
        const p = creer();
        p.addVideo({ videoId: "a" });
        p.addVideo({ videoId: "b" });
        expect(p.videos).toHaveLength(2);

        const source = [{ videoId: "x" }];
        p.setVideos(source);
        source.push({ videoId: "y" });
        expect(p.videos).toEqual([{ videoId: "x" }]);
    });

    it("`videos` est une copie figée : la modifier de l'extérieur est impossible", () => {
        const p = creer();
        p.addVideo({ videoId: "a" });
        expect(() => p.videos.push({ videoId: "b" })).toThrow(TypeError);
        expect(p.videos).toHaveLength(1);
    });
});

describe("VideoListInfo", () => {
    const creer = (overrides = {}) =>
        new VideoListInfo({
            provider: "youtube",
            target: "player",
            videoIds: ["a", "b", "c"],
            ...overrides,
        });

    it("exige providers et target", () => {
        expect(() => new VideoListInfo({ provider: "", target: "player", videoIds: ["a"] })).toThrow();
        expect(() => new VideoListInfo({ provider: "youtube", target: undefined, videoIds: ["a"] })).toThrow();
    });

    it("lève une erreur quand videoIds n'est pas fourni", () => {
        // Currently throws because of [...videoIds] when videoIds is undefined
        expect(() => new VideoListInfo({ provider: "youtube", target: "player" })).toThrow();
        expect(() => new VideoListInfo({ provider: "youtube", target: "player", videoIds: undefined })).toThrow();
    });

    it("est une playlist, avec les valeurs passées", () => {
        const l = creer({
            videoIds: ["a", "b"],
            index: 1,
            showOnInit: true,
            key: "cle",
            extra: "extra",
            source: "https://src",
        });

        expect(l).toMatchObject({
            isPlaylist: true,
            provider: "youtube",
            target: "player",
            index: 1,
            showOnInit: true,
            key: "cle",
            extra: "extra",
            source: "https://src",
        });
    });

    it("clé par défaut = providers:list:id1,id2,...", () => {
        expect(creer({ videoIds: ["a", "b"] }).key).toBe("youtube:list:a,b");
    });

    it("copie les ids : modifier le tableau d'origine ne change pas la liste", () => {
        const ids = ["a", "b"];
        const l = creer({ videoIds: ids });
        ids.push("c");
        expect(l.videoIds).toEqual(["a", "b"]);
    });

    it("`videoIds` et `videos` sont figés", () => {
        const l = creer();
        expect(Object.isFrozen(l.videoIds)).toBe(true);
        expect(() => l.videoIds.push("z")).toThrow(TypeError);
        expect(() => l.videos.push({})).toThrow(TypeError);
    });

    it("addVideo / setVideos fonctionnent comme pour PlaylistInfo", () => {
        const l = creer();
        l.addVideo({ videoId: "a" });
        expect(l.videos).toHaveLength(1);
        l.setVideos([{ videoId: "b" }, { videoId: "c" }]);
        expect(l.videos.map((v) => v.videoId)).toEqual(["b", "c"]);
    });
});

describe("UrlInfo", () => {
    it("expose les valeurs reçues", () => {
        const info = new UrlInfo({
            kind: "videoList", videoId: "a", videoIds: ["a", "b"], playlistId: "PL1",
            startSeconds: 30, index: 2, labels: ["A", "B"], source: "https://src"
        });
        expect(info).toMatchObject({
            kind: "videoList", videoId: "a", videoIds: ["a", "b"], playlistId: "PL1",
            startSeconds: 30, index: 2, labels: ["A", "B"], source: "https://src"
        });
    });

    it("les champs non fournis valent undefined", () => {
        const info = new UrlInfo({kind: "video"});
        expect(info.videoId).toBeUndefined();
        expect(info.labels).toBeUndefined();
    });
});

describe("SrcInfo", () => {
    it("hérite de UrlInfo et ajoute autoplay et mute", () => {
        const info = new SrcInfo({kind: "video", videoId: "a", source: "s", autoplay: true, mute: false});
        expect(info).toBeInstanceOf(UrlInfo);
        expect(info).toMatchObject({kind: "video", videoId: "a", source: "s", autoplay: true, mute: false});
    });

    it("autoplay et mute valent undefined s'ils ne sont pas fournis", () => {
        const info = new SrcInfo({kind: "video"});
        expect(info.autoplay).toBeUndefined();
        expect(info.mute).toBeUndefined();
    });
});
