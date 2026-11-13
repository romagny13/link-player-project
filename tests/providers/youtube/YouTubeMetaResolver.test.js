// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";
import {YouTubeMetaResolver} from "../../../src/providers/youtube/YouTubeMetaResolver.js";
import {VideoInfo} from "../../../src/models/VideoInfo.js";
import {PlaylistInfo} from "../../../src/models/PlaylistInfo.js";
import {MemoryStore} from "../../../src/storage.js";

const apiMeta = {
    title: "Vrai titre",
    description: "Une description",
    channel: "Ma chaîne",
    channelUrl: "https://www.youtube.com/channel/UC1",
    thumbnail: "https://img.test/1.jpg",
    duration: 120
};

const fakeApi = (entries = [["vid1", apiMeta]]) => {
    const map = new Map(entries);
    return {
        available: true,
        videos: vi.fn(async (ids) => new Map(ids.filter((id) => map.has(id)).map((id) => [id, map.get(id)]))),
        playlistItems: vi.fn(async () => [])
    };
};

const video = (extra = {}) => new VideoInfo({provider: "youtube", target: "zone", videoId: "vid1", ...extra});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("YouTubeMetaResolver : vidéo seule", () => {
    it("ignore un autre provider", async () => {
        const api = fakeApi();
        const resolver = new YouTubeMetaResolver({api});
        const info = new VideoInfo({provider: "okru", target: "zone", videoId: "123"});

        expect(await resolver.resolve(info, {force: true})).toBeNull();
        expect(api.videos).not.toHaveBeenCalled();
    });

    it("ne fait rien quand le titre (requis par défaut) est déjà déclaré", async () => {
        const api = fakeApi();
        const resolver = new YouTubeMetaResolver({api});

        expect(await resolver.resolve(video({title: "Mon titre"}))).toBeNull();
        expect(api.videos).not.toHaveBeenCalled();
    });

    it("complète une vidéo sans titre avec toutes les métadonnées de l'API", async () => {
        const api = fakeApi();
        const resolver = new YouTubeMetaResolver({api});

        const items = await resolver.resolve(video());

        expect(api.videos).toHaveBeenCalledWith(["vid1"]);
        expect(items).toHaveLength(1);
        expect(items[0]).toEqual(expect.objectContaining({id: "vid1", ...apiMeta}));
    });

    it("force : interroge l'API même si le titre est déclaré, sans jamais l'écraser", async () => {
        const api = fakeApi();
        const resolver = new YouTubeMetaResolver({api});

        const items = await resolver.resolve(video({title: "Mon titre"}), {force: true});

        expect(api.videos).toHaveBeenCalledTimes(1);
        expect(items[0].title).toBe("Mon titre");
        expect(items[0].channel).toBe("Ma chaîne");
        expect(items[0].description).toBe("Une description");
    });

    it("required étendu : une vidéo avec titre mais sans description déclenche l'appel", async () => {
        const api = fakeApi();
        const resolver = new YouTubeMetaResolver({api, required: ["title", "description"]});

        const items = await resolver.resolve(video({title: "Mon titre"}));

        expect(api.videos).toHaveBeenCalledTimes(1);
        expect(items[0].description).toBe("Une description");
    });

    it("required étendu : rien à faire quand tout est déjà déclaré", async () => {
        const api = fakeApi();
        const resolver = new YouTubeMetaResolver({api, required: ["title", "description"]});

        expect(await resolver.resolve(video({title: "T", description: "D"}))).toBeNull();
        expect(api.videos).not.toHaveBeenCalled();
    });

    it("sans API : renvoie null, sans titre de repli", async () => {
        const resolver = new YouTubeMetaResolver({api: null});
        expect(await resolver.resolve(video(), {force: true})).toBeNull();
    });

    it("API indisponible (clé refusée) : renvoie null", async () => {
        const api = {...fakeApi(), available: false};
        const resolver = new YouTubeMetaResolver({api});
        expect(await resolver.resolve(video())).toBeNull();
        expect(api.videos).not.toHaveBeenCalled();
    });

    it("l'API échoue : renvoie null avec un avertissement, sans rejeter", async () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const api = {available: true, videos: vi.fn().mockRejectedValue(new Error("quota")), playlistItems: vi.fn()};
        const resolver = new YouTubeMetaResolver({api});

        await expect(resolver.resolve(video())).resolves.toBeNull();
        expect(spy).toHaveBeenCalled();
    });

    it("vidéo absente de l'API (privée ou supprimée) : renvoie null", async () => {
        const resolver = new YouTubeMetaResolver({api: fakeApi([])});
        expect(await resolver.resolve(video())).toBeNull();
    });

    it("le cache évite un second appel pour la même vidéo", async () => {
        const api = fakeApi();
        const resolver = new YouTubeMetaResolver({api, cache: new MemoryStore()});

        await resolver.resolve(video());
        const items = await resolver.resolve(video());

        expect(api.videos).toHaveBeenCalledTimes(1);
        expect(items[0].title).toBe("Vrai titre");
    });
});

describe("YouTubeMetaResolver : playlist", () => {
    const playlistWithTitles = () => {
        const playlist = new PlaylistInfo({provider: "youtube", target: "zone", playlistId: "PL1"});
        playlist.addVideo(video({title: "A"}));
        return playlist;
    };

    it("ne fait rien quand tous les titres sont déclarés", async () => {
        const api = fakeApi();
        const resolver = new YouTubeMetaResolver({api});

        expect(await resolver.resolve(playlistWithTitles())).toBeNull();
        expect(api.playlistItems).not.toHaveBeenCalled();
    });

    it("force : interroge l'API même quand tous les titres sont déclarés", async () => {
        const api = fakeApi();
        const resolver = new YouTubeMetaResolver({api});

        const items = await resolver.resolve(playlistWithTitles(), {force: true});

        expect(api.playlistItems).toHaveBeenCalledWith("PL1");
        expect(items[0].title).toBe("A");
    });
});
