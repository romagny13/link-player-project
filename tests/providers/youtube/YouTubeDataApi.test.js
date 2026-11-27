import {describe, expect, it, vi} from "vitest";
import {YouTubeApiError, YouTubeDataApi, parseIsoDuration} from "../../../src/providers/youtube/YouTubeDataApi.js";
import {VideoInfo} from "../../../src/models/VideoInfo.js";
import {VideoListInfo} from "../../../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../../../src/models/PlaylistInfo.js";
import {AUTOPLAY_MODES, isEmpty} from "../../../src/utils/helpers.js";

// ───────── outils ─────────

const pick = (obj, ...keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));
const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/** Attend un rejet et renvoie l'erreur (évite les subtilités de toMatchObject sur les Error). */
const rejection = async (promise) => {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("la promesse aurait dû être rejetée");
};

// --- faux fetch ---
const response = (body, status = 200) => ({ok: status < 400, status, json: async () => body});
const failure = (status, reason) => response({error: {errors: [{reason}]}}, status);
const brokenBody = (status) => ({ok: false, status, json: async () => { throw new SyntaxError("pas du JSON"); }});
/** Renvoie les réponses dans l'ordre des appels. */
const sequence = (...responses) => vi.fn(async () => responses.shift());
const makeApi = (fetch, options = {}) => new YouTubeDataApi({apiKey: "CLE", fetch, ...options});
const paramsOf = (fetch, call = 0) => fetch.mock.calls[call][0].searchParams;

// --- jeux de données de l'API ---
const videoItem = (id, over = {}) => ({
    id,
    snippet: {
        title: `Titre ${id}`,
        description: `Desc ${id}`,
        channelTitle: "Ma chaîne",
        channelId: "UC123",
        thumbnails: {default: {url: "d.jpg"}, medium: {url: "m.jpg"}}
    },
    contentDetails: {duration: "PT3M20S"}, // 200 s
    ...over
});

const playlistItem = (id, snippet = {}) => ({
    snippet: {
        title: `Titre ${id}`,
        description: `Desc ${id}`,
        channelTitle: "Propriétaire de la playlist",
        channelId: "UCplaylist",
        videoOwnerChannelTitle: "Auteur de la vidéo",
        videoOwnerChannelId: "UCauteur",
        thumbnails: {medium: {url: `https://t.test/${id}.jpg`}},
        resourceId: {videoId: id},
        ...snippet
    }
});

const range = (n, from = 0) => Array.from({length: n}, (_, i) => `v${from + i}`);
const page = (ids, nextPageToken) => response({items: ids.map((id) => playlistItem(id)), nextPageToken});

// --- modèles ---
const video = (videoId, o = {}) => new VideoInfo({provider: "youtube", target: "player", videoId, ...o});
const makeList = (ids, videos = []) => {
    const list = new VideoListInfo("youtube", "player", ids, 0, false);
    videos.forEach((v) => list.addVideo(v));
    return list;
};
const makePlaylist = (id = "PL1", videos = []) => {
    const playlist = new PlaylistInfo("youtube", "player", id, undefined, false);
    videos.forEach((v) => playlist.addVideo(v));
    return playlist;
};

const FULL = {
    title: "T",
    description: "D",
    channel: "C",
    channelUrl: "https://c.test",
    thumbnail: "https://t.test/i.jpg",
    duration: 90,
    startSeconds: 5
};
const fields = (v) => pick(v, "title", "description", "channel", "channelUrl", "thumbnail", "duration", "startSeconds");

// ═════════════════════════════════════════════
// parseIsoDuration
// ═════════════════════════════════════════════
describe("parseIsoDuration", () => {
    it.each([
        ["PT1H2M3S", 3723],
        ["PT45S", 45],
        ["PT5M", 300],
        ["PT2H", 7200],
        ["P1DT2H", 93600],
        ["PT0S", 0],
        ["P0D", 0] // direct en cours
    ])("convertit %s en %i secondes", (iso, seconds) => {
        expect(parseIsoDuration(iso)).toBe(seconds);
    });

    it.each([[undefined], [null], [""], ["abc"], ["1H"], ["PT1.5S"]])(
        "renvoie null pour la valeur invalide %j",
        (iso) => {
            expect(parseIsoDuration(iso)).toBeNull();
        }
    );
});

// ═════════════════════════════════════════════
// YouTubeApiError
// ═════════════════════════════════════════════
describe("YouTubeApiError", () => {
    it("décrit le statut et la raison", () => {
        const error = new YouTubeApiError(403, "quotaExceeded");
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe("YouTubeApiError");
        expect(error.status).toBe(403);
        expect(error.message).toBe("YouTube API 403 (quotaExceeded)");
    });

    it("omet les parenthèses sans raison", () => {
        expect(new YouTubeApiError(500).message).toBe("YouTube API 500");
    });
});

// ═════════════════════════════════════════════
// YouTubeDataApi
// ═════════════════════════════════════════════
describe("YouTubeDataApi", () => {
    describe("disponibilité", () => {
        it("n'est pas disponible sans clé", () => {
            expect(new YouTubeDataApi().available).toBe(false);
            expect(new YouTubeDataApi({apiKey: ""}).available).toBe(false);
        });

        it("est disponible avec une clé", () => {
            expect(makeApi(sequence()).available).toBe(true);
        });

        it("refuse d'appeler le réseau sans clé", async () => {
            const fetch = sequence();
            const api = new YouTubeDataApi({fetch});
            const error = await rejection(api.videos(["a"]));

            expect(error).toBeInstanceOf(YouTubeApiError);
            expect(error.status).toBe(0);
            expect(error.message).toContain("ApiDisabled");
            expect(fetch).not.toHaveBeenCalled();
        });
    });

    describe("videos", () => {
        it.each([[undefined], [null], [[]]])("renvoie une Map vide sans appel pour %j", async (ids) => {
            const fetch = sequence();
            const result = await makeApi(fetch).videos(ids);
            expect(result).toEqual(new Map());
            expect(fetch).not.toHaveBeenCalled();
        });

        it("appelle l'endpoint videos avec les bons paramètres", async () => {
            const fetch = sequence(response({items: []}));
            await makeApi(fetch).videos(["a", "b"]);

            const url = fetch.mock.calls[0][0];
            expect(url.pathname).toBe("/youtube/v3/videos");
            expect(url.searchParams.get("part")).toBe("snippet,contentDetails");
            expect(url.searchParams.get("id")).toBe("a,b");
            expect(url.searchParams.get("key")).toBe("CLE");
        });

        it("transmet un signal d'annulation à fetch", async () => {
            const fetch = sequence(response({items: []}));
            await makeApi(fetch).videos(["a"]);
            expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
        });

        it("renvoie tous les champs utiles pour chaque vidéo", async () => {
            const result = await makeApi(sequence(response({items: [videoItem("a")]}))).videos(["a"]);

            expect(result.get("a")).toEqual({
                title: "Titre a",
                description: "Desc a",
                channel: "Ma chaîne",
                channelId: "UC123",
                channelUrl: "https://www.youtube.com/channel/UC123",
                thumbnail: "m.jpg",
                duration: 200
            });
        });

        it("replie sur la miniature par défaut, puis sur une chaîne vide", async () => {
            const items = [
                videoItem("a", {snippet: {thumbnails: {default: {url: "d.jpg"}}}}),
                videoItem("b", {snippet: {}})
            ];
            const result = await makeApi(sequence(response({items}))).videos(["a", "b"]);
            expect(result.get("a").thumbnail).toBe("d.jpg");
            expect(result.get("b").thumbnail).toBe("");
        });

        it("donne des valeurs vides (durée null) quand le snippet est absent", async () => {
            const result = await makeApi(sequence(response({items: [{id: "a"}]}))).videos(["a"]);

            expect(result.get("a")).toEqual({
                title: "",
                description: "",
                channel: "",
                channelId: "",
                channelUrl: "",
                thumbnail: "",
                duration: null
            });
        });

        it("n'inclut pas les vidéos privées ou supprimées", async () => {
            const items = [videoItem("a"), videoItem("c")];
            const result = await makeApi(sequence(response({items}))).videos(["a", "b", "c"]);
            expect([...result.keys()]).toEqual(["a", "c"]);
        });

        it("découpe les identifiants par paquets de 50", async () => {
            const fetch = vi.fn(async (url) =>
                response({items: url.searchParams.get("id").split(",").map((id) => videoItem(id))})
            );
            const result = await makeApi(fetch).videos(range(120));

            expect(fetch).toHaveBeenCalledTimes(3);
            expect([0, 1, 2].map((i) => paramsOf(fetch, i).get("id").split(",").length)).toEqual([50, 50, 20]);
            expect(result.size).toBe(120);
        });

        it("n'utilise qu'un appel pour exactement 50 identifiants", async () => {
            const fetch = vi.fn(async () => response({items: []}));
            await makeApi(fetch).videos(range(50));
            expect(fetch).toHaveBeenCalledTimes(1);
        });
    });

    describe("playlistItems", () => {
        it.each([[undefined], [null], [""]])("renvoie [] sans appel pour l'identifiant %j", async (id) => {
            const fetch = sequence();
            expect(await makeApi(fetch).playlistItems(id)).toEqual([]);
            expect(fetch).not.toHaveBeenCalled();
        });

        it("appelle l'endpoint playlistItems avec les bons paramètres", async () => {
            const fetch = sequence(page([]));
            await makeApi(fetch).playlistItems("PL1");

            const url = fetch.mock.calls[0][0];
            expect(url.pathname).toBe("/youtube/v3/playlistItems");
            expect(url.searchParams.get("part")).toBe("snippet");
            expect(url.searchParams.get("playlistId")).toBe("PL1");
            expect(url.searchParams.get("maxResults")).toBe("50");
            expect(url.searchParams.has("pageToken")).toBe(false);
        });

        it("renvoie les entrées dans l'ordre, avec les métadonnées du snippet", async () => {
            const entries = await makeApi(sequence(page(["v1", "v2"]))).playlistItems("PL1");

            expect(entries.map((e) => e.id)).toEqual(["v1", "v2"]);
            expect(pick(entries[0].meta, "title", "description", "thumbnail"))
                .toEqual({title: "Titre v1", description: "Desc v1", thumbnail: "https://t.test/v1.jpg"});
        });

        it("préfère le titre de la chaîne de l'auteur à celui du propriétaire de la playlist", async () => {
            const [entry] = await makeApi(sequence(page(["v1"]))).playlistItems("PL1");
            expect(entry.meta.channel).toBe("Auteur de la vidéo");
        });

        it("replie sur channelTitle quand l'auteur est inconnu", async () => {
            const item = playlistItem("v1", {videoOwnerChannelTitle: undefined});
            const [entry] = await makeApi(sequence(response({items: [item]}))).playlistItems("PL1");
            expect(entry.meta.channel).toBe("Propriétaire de la playlist");
        });

        // ⚠ Échoue tant que snippetMeta utilise channelId (propriétaire de la PLAYLIST)
        // et non videoOwnerChannelId (auteur de la VIDÉO) : le nom et le lien ne désignent pas la même chaîne.
        it("construit channelUrl à partir de la chaîne de l'auteur, comme le nom de la chaîne", async () => {
            const [entry] = await makeApi(sequence(page(["v1"]))).playlistItems("PL1");
            expect(entry.meta.channelUrl).toBe("https://www.youtube.com/channel/UCauteur");
        });

        // Documente un manque : playlistItems ne renvoie pas la durée, il faut un appel videos() en plus.
        it("ne fournit pas la durée (à compléter avec videos())", async () => {
            const [entry] = await makeApi(sequence(page(["v1"]))).playlistItems("PL1");
            expect(entry.meta).not.toHaveProperty("duration");
        });

        it("suit la pagination avec nextPageToken", async () => {
            const fetch = sequence(page(range(50), "T2"), page(range(2, 50)));
            const entries = await makeApi(fetch).playlistItems("PL1");

            expect(fetch).toHaveBeenCalledTimes(2);
            expect(paramsOf(fetch, 1).get("pageToken")).toBe("T2");
            expect(entries).toHaveLength(52);
        });

        it("s'arrête dès que maxItems est atteint, même s'il reste des pages", async () => {
            const fetch = sequence(page(range(50), "T2"), page(range(50, 50), "T3"));
            const entries = await makeApi(fetch).playlistItems("PL1", 50);

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(entries).toHaveLength(50);
        });

        it("coupe le résultat à maxItems", async () => {
            const fetch = sequence(page(range(50), "T2"), page(range(50, 50), "T3"));
            const entries = await makeApi(fetch).playlistItems("PL1", 60);

            expect(fetch).toHaveBeenCalledTimes(2);
            expect(entries).toHaveLength(60);
            expect(entries.at(-1).id).toBe("v59");
        });

        it("renvoie [] pour une playlist vide", async () => {
            expect(await makeApi(sequence(response({}))).playlistItems("PL1")).toEqual([]);
        });
    });

    describe("erreurs et désactivation", () => {
        it.each([
            ["keyInvalid"],
            ["quotaExceeded"],
            ["dailyLimitExceeded"],
            ["rateLimitExceeded"],
            ["accessNotConfigured"],
            ["ipRefererBlocked"]
        ])("désactive l'API après une erreur 403 « %s »", async (reason) => {
            const api = makeApi(sequence(failure(403, reason)));
            const error = await rejection(api.videos(["a"]));

            expect(error).toBeInstanceOf(YouTubeApiError);
            expect(error.message).toBe(`YouTube API 403 (${reason})`);
            expect(api.available).toBe(false);
        });

        it.each([[401], [429]])("désactive l'API après une erreur %i", async (status) => {
            const api = makeApi(sequence(failure(status, undefined)));
            await rejection(api.videos(["a"]));
            expect(api.available).toBe(false);
        });

        it.each([
            [404, "notFound"],
            [403, "playlistItemsNotAccessible"], // playlist privée
            [403, "forbidden"],
            [500, undefined]
        ])("garde l'API active après une erreur %i (%s)", async (status, reason) => {
            const api = makeApi(sequence(failure(status, reason)));
            const error = await rejection(api.playlistItems("PL1"));

            expect(error.status).toBe(status);
            expect(api.available).toBe(true);
        });

        it("garde le statut quand le corps de l'erreur n'est pas du JSON", async () => {
            const api = makeApi(sequence(brokenBody(502)));
            const error = await rejection(api.videos(["a"]));

            expect(error.status).toBe(502);
            expect(error.message).toBe("YouTube API 502");
            expect(api.available).toBe(true);
        });

        it("ne fait plus aucun appel une fois désactivée", async () => {
            const fetch = sequence(failure(403, "quotaExceeded"));
            const api = makeApi(fetch);
            await rejection(api.videos(["a"]));

            const error = await rejection(api.playlistItems("PL1"));
            expect(error.status).toBe(0);
            expect(error.message).toContain("ApiDisabled");
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it("abandonne après le délai sans désactiver l'API", async () => {
            const hang = vi.fn((url, {signal}) =>
                new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)))
            );
            const api = makeApi(hang, {timeoutMs: 5});
            const error = await rejection(api.videos(["a"]));

            expect(error.name).toBe("TimeoutError");
            expect(api.available).toBe(true);
        });

        it("propage une erreur réseau sans désactiver l'API", async () => {
            const api = makeApi(vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
            const error = await rejection(api.videos(["a"]));

            expect(error).toBeInstanceOf(TypeError);
            expect(api.available).toBe(true);
        });
    });
});
