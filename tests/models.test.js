import { describe, it, expect, beforeEach } from "vitest";
import { VideoInfo } from "../src/models/VideoInfo.js"; // adapte le chemin si besoin
import { VideoListInfo } from "../src/models/VideoListInfo.js";
import { PlaylistInfo } from "../src/models/PlaylistInfo.js";
import { UrlInfo } from "../src/models/UrlInfo.js";

describe("VideoInfo", () => {
    const baseParams = {
        provider: "youtube",
        target: "player1",
        videoId: "abc123",
        autoplay: true,
        startSeconds: 30,
        title: "Ma vidéo",
        description: "Description test",
        channel: "Ma chaîne",
        channelUrl: "https://youtube.com/channel/xyz",
        thumbnail: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
        duration: 3600,
        showOnInit: true,
        extra: { foo: "bar" },
    };

    it("doit créer une instance avec les valeurs fournies", () => {
        const video = new VideoInfo(baseParams);

        expect(video.provider).toBe("youtube");
        expect(video.target).toBe("player1");
        expect(video.videoId).toBe("abc123");
        expect(video.autoplay).toBe(true);
        expect(video.startSeconds).toBe(30);
        expect(video.title).toBe("Ma vidéo");
        expect(video.description).toBe("Description test");
        expect(video.channel).toBe("Ma chaîne");
        expect(video.channelUrl).toBe("https://youtube.com/channel/xyz");
        expect(video.thumbnail).toBe("https://img.youtube.com/vi/abc123/hqdefault.jpg");
        expect(video.duration).toBe(3600);
        expect(video.showOnInit).toBe(true);
        expect(video.extra).toEqual({ foo: "bar" });
    });

    it("doit générer une clé par défaut à partir du provider et du videoId", () => {
        const video = new VideoInfo(baseParams);
        expect(video.key).toBe("youtube:abc123");
    });

    it("doit utiliser la clé fournie si elle est définie", () => {
        const video = new VideoInfo({ ...baseParams, key: "custom-key" });
        expect(video.key).toBe("custom-key");
    });

    it("doit indiquer que ce n'est pas une playlist", () => {
        const video = new VideoInfo(baseParams);
        expect(video.isPlaylist).toBe(false);
    });

    it("doit lever une erreur si provider est manquant ou vide", () => {
        expect(() => new VideoInfo({ ...baseParams, provider: null })).toThrow();
        expect(() => new VideoInfo({ ...baseParams, provider: "" })).toThrow();
    });

    it("doit lever une erreur si target est manquant ou vide", () => {
        expect(() => new VideoInfo({ ...baseParams, target: null })).toThrow();
        expect(() => new VideoInfo({ ...baseParams, target: "" })).toThrow();
    });

    it("doit lever une erreur si videoId est manquant ou vide", () => {
        expect(() => new VideoInfo({ ...baseParams, videoId: null })).toThrow();
        expect(() => new VideoInfo({ ...baseParams, videoId: "" })).toThrow();
    });

    describe("fillMissing", () => {
        it("doit remplir uniquement les champs vides et retourner true si un changement a eu lieu", () => {
            const video = new VideoInfo({
                ...baseParams,
                title: null,
                description: "",
                channel: undefined,
                channelUrl: null,
                thumbnail: "",
                duration: null,
            });

            const changed = video.fillMissing({
                title: "Nouveau titre",
                description: "Nouvelle description",
                channel: "Nouvelle chaîne",
                channelUrl: "https://new.channel",
                thumbnail: "https://new.thumb.jpg",
                duration: 120,
            });

            expect(changed).toBe(true);
            expect(video.title).toBe("Nouveau titre");
            expect(video.description).toBe("Nouvelle description");
            expect(video.channel).toBe("Nouvelle chaîne");
            expect(video.channelUrl).toBe("https://new.channel");
            expect(video.thumbnail).toBe("https://new.thumb.jpg");
            expect(video.duration).toBe(120);
        });

        it("ne doit pas écraser les valeurs déjà présentes", () => {
            const video = new VideoInfo(baseParams);

            const changed = video.fillMissing({
                title: "Titre différent",
                description: "Description différente",
                channel: "Chaîne différente",
                channelUrl: "https://autre.channel",
                thumbnail: "https://autre.thumb.jpg",
                duration: 999,
            });

            expect(changed).toBe(false);
            expect(video.title).toBe("Ma vidéo");
            expect(video.description).toBe("Description test");
            expect(video.channel).toBe("Ma chaîne");
            expect(video.channelUrl).toBe("https://youtube.com/channel/xyz");
            expect(video.thumbnail).toBe("https://img.youtube.com/vi/abc123/hqdefault.jpg");
            expect(video.duration).toBe(3600);
        });

        it("doit retourner false si aucun champ n'a été modifié", () => {
            const video = new VideoInfo({
                ...baseParams,
                title: null,
                description: null,
            });

            const changed = video.fillMissing({});
            expect(changed).toBe(false);
        });

        it("doit gérer un appel sans argument", () => {
            const video = new VideoInfo(baseParams);
            expect(video.fillMissing()).toBe(false);
        });
    });
});

describe("VideoListInfo", () => {
    const videoIds = ["vid1", "vid2", "vid3"];

    it("doit créer une instance avec les valeurs fournies", () => {
        const list = new VideoListInfo(
            "youtube",
            "player1",
            videoIds,
            1,
            true,
            null,
            { foo: "bar" }
        );

        expect(list.provider).toBe("youtube");
        expect(list.target).toBe("player1");
        expect(list.videoIds).toEqual(["vid1", "vid2", "vid3"]);
        expect(list.index).toBe(1);
        expect(list.showOnInit).toBe(true);
        expect(list.extra).toEqual({ foo: "bar" });
        expect(list.videos).toEqual([]);
    });

    it("doit générer une clé par défaut à partir du provider et des videoIds", () => {
        const list = new VideoListInfo("youtube", "player1", videoIds, 0, false);
        expect(list.key).toBe("youtube:list:vid1,vid2,vid3");
    });

    it("doit utiliser la clé fournie si elle est définie", () => {
        const list = new VideoListInfo(
            "youtube",
            "player1",
            videoIds,
            0,
            false,
            "custom-list-key"
        );
        expect(list.key).toBe("custom-list-key");
    });

    it("doit indiquer que c'est une playlist", () => {
        const list = new VideoListInfo("youtube", "player1", videoIds, 0, false);
        expect(list.isPlaylist).toBe(true);
    });

    it("doit retourner une copie figée (frozen) des videoIds", () => {
        const list = new VideoListInfo("youtube", "player1", videoIds, 0, false);
        const ids = list.videoIds;

        expect(Object.isFrozen(ids)).toBe(true);
        expect(() => ids.push("vid4")).toThrow();
    });

    it("doit lever une erreur si provider est manquant ou vide", () => {
        expect(() => new VideoListInfo(null, "player1", videoIds, 0, false)).toThrow();
        expect(() => new VideoListInfo("", "player1", videoIds, 0, false)).toThrow();
    });

    it("doit lever une erreur si target est manquant ou vide", () => {
        expect(() => new VideoListInfo("youtube", null, videoIds, 0, false)).toThrow();
        expect(() => new VideoListInfo("youtube", "", videoIds, 0, false)).toThrow();
    });

    describe("gestion des vidéos", () => {
        let list;

        beforeEach(() => {
            list = new VideoListInfo("youtube", "player1", videoIds, 0, false);
        });

        it("doit ajouter une vidéo avec addVideo", () => {
            const video = { id: "v1" };
            list.addVideo(video);

            expect(list.videos).toHaveLength(1);
            expect(list.videos[0]).toBe(video);
        });

        it("doit remplacer toutes les vidéos avec setVideos", () => {
            list.addVideo({ id: "old" });
            const newVideos = [{ id: "a" }, { id: "b" }];
            list.setVideos(newVideos);

            expect(list.videos).toEqual(newVideos);
            expect(list.videos).not.toBe(newVideos); // copie
        });

        it("doit retourner une copie figée (frozen) des vidéos", () => {
            list.addVideo({ id: "v1" });
            const videos = list.videos;

            expect(Object.isFrozen(videos)).toBe(true);
            expect(() => videos.push({ id: "v2" })).toThrow();
        });
    });
});

describe("PlaylistInfo", () => {
    it("doit créer une instance avec les valeurs fournies", () => {
        const playlist = new PlaylistInfo(
            "youtube",
            "player1",
            "PL123",
            "vidStart",
            true,
            null,
            { foo: "bar" }
        );

        expect(playlist.provider).toBe("youtube");
        expect(playlist.target).toBe("player1");
        expect(playlist.playlistId).toBe("PL123");
        expect(playlist.videoId).toBe("vidStart");
        expect(playlist.showOnInit).toBe(true);
        expect(playlist.extra).toEqual({ foo: "bar" });
        expect(playlist.videos).toEqual([]);
    });

    it("doit générer une clé par défaut à partir du provider et du playlistId", () => {
        const playlist = new PlaylistInfo("youtube", "player1", "PL123", null, false);
        expect(playlist.key).toBe("youtube:playlist:PL123");
    });

    it("doit utiliser la clé fournie si elle est définie", () => {
        const playlist = new PlaylistInfo(
            "youtube",
            "player1",
            "PL123",
            null,
            false,
            "custom-playlist-key"
        );
        expect(playlist.key).toBe("custom-playlist-key");
    });

    it("doit indiquer que c'est une playlist", () => {
        const playlist = new PlaylistInfo("youtube", "player1", "PL123", null, false);
        expect(playlist.isPlaylist).toBe(true);
    });

    it("doit lever une erreur si provider est manquant ou vide", () => {
        expect(() => new PlaylistInfo(null, "player1", "PL123", null, false)).toThrow();
        expect(() => new PlaylistInfo("", "player1", "PL123", null, false)).toThrow();
    });

    it("doit lever une erreur si target est manquant ou vide", () => {
        expect(() => new PlaylistInfo("youtube", null, "PL123", null, false)).toThrow();
        expect(() => new PlaylistInfo("youtube", "", "PL123", null, false)).toThrow();
    });

    it("doit lever une erreur si playlistId est manquant ou vide", () => {
        expect(() => new PlaylistInfo("youtube", "player1", null, null, false)).toThrow();
        expect(() => new PlaylistInfo("youtube", "player1", "", null, false)).toThrow();
    });

    describe("gestion des vidéos", () => {
        let playlist;

        beforeEach(() => {
            playlist = new PlaylistInfo("youtube", "player1", "PL123", null, false);
        });

        it("doit ajouter une vidéo avec addVideo", () => {
            const video = { id: "v1" };
            playlist.addVideo(video);

            expect(playlist.videos).toHaveLength(1);
            expect(playlist.videos[0]).toBe(video);
        });

        it("doit remplacer toutes les vidéos avec setVideos", () => {
            playlist.addVideo({ id: "old" });
            const newVideos = [{ id: "a" }, { id: "b" }];
            playlist.setVideos(newVideos);

            expect(playlist.videos).toEqual(newVideos);
            expect(playlist.videos).not.toBe(newVideos); // copie
        });

        it("doit retourner une copie figée (frozen) des vidéos", () => {
            playlist.addVideo({ id: "v1" });
            const videos = playlist.videos;

            expect(Object.isFrozen(videos)).toBe(true);
            expect(() => videos.push({ id: "v2" })).toThrow();
        });
    });
});

describe("UrlInfo", () => {
    it("doit créer une instance avec toutes les propriétés", () => {
        const info = new UrlInfo({
            kind: "video",
            videoId: "abc123",
            videoIds: ["a", "b"],
            playlistId: "PL123",
            index: 2,
            startSeconds: 45,
            labels: { fr: "Titre FR", en: "Title EN" },
        });

        expect(info.kind).toBe("video");
        expect(info.videoId).toBe("abc123");
        expect(info.videoIds).toEqual(["a", "b"]);
        expect(info.playlistId).toBe("PL123");
        expect(info.index).toBe(2);
        expect(info.startSeconds).toBe(45);
        expect(info.labels).toEqual({ fr: "Titre FR", en: "Title EN" });
    });

    it("doit accepter des valeurs undefined / null", () => {
        const info = new UrlInfo({
            kind: "playlist",
            videoId: null,
            videoIds: undefined,
            playlistId: "PL999",
            index: undefined,
            startSeconds: null,
            labels: null,
        });

        expect(info.kind).toBe("playlist");
        expect(info.videoId).toBeNull();
        expect(info.videoIds).toBeUndefined();
        expect(info.playlistId).toBe("PL999");
        expect(info.index).toBeUndefined();
        expect(info.startSeconds).toBeNull();
        expect(info.labels).toBeNull();
    });

    it("doit pouvoir être créé avec un objet minimal", () => {
        const info = new UrlInfo({ kind: "list" });

        expect(info.kind).toBe("list");
        expect(info.videoId).toBeUndefined();
        expect(info.videoIds).toBeUndefined();
        expect(info.playlistId).toBeUndefined();
        expect(info.index).toBeUndefined();
        expect(info.startSeconds).toBeUndefined();
        expect(info.labels).toBeUndefined();
    });
});