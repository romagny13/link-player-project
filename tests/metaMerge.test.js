import {describe, expect, it, vi} from "vitest";
import {VideoListInfo} from "../src/models/VideoListInfo.js";
import {PlaylistInfo} from "../src/models/PlaylistInfo.js";
import {VideoInfo} from "../src/models/VideoInfo.js";
import {applyDefinition, applyItems, resolveDefinition} from "../src/metaMerge.js";
import {YouTubeInfoParser} from "../src/providers/youtube/YouTubeInfoParser.js";
import {AUTOPLAY_MODES, isEmpty} from "../src/utils/helpers.js";

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
// applyItems (fusion)
// ═════════════════════════════════════════════
describe("applyItems", () => {
    describe("remplissage des champs", () => {
        it("remplit tous les champs depuis les items", () => {
            const list = makeList(["a", "b"]);
            applyItems(list, [{id: "a", ...FULL}, {id: "b"}]);

            expect(fields(list.videos[0])).toEqual(FULL);
        });

        it("met des chaînes vides pour les champs que personne ne connaît", () => {
            const list = makeList(["a"]);
            applyItems(list, [{id: "a"}]);
            const v = list.videos[0];

            expect(pick(v, "title", "description", "channel", "channelUrl", "thumbnail"))
                .toEqual({title: "", description: "", channel: "", channelUrl: "", thumbnail: ""});
            expect(isEmpty(v.duration)).toBe(true);
            expect(v.startSeconds).toBeUndefined();
        });

        it("garde une durée de 0 s (direct)", () => {
            const list = makeList(["a"]);
            applyItems(list, [{id: "a", duration: 0}]);
            expect(list.videos[0].duration).toBe(0);
        });

        it("copie le provider et la cible de l'info", () => {
            const list = makeList(["a"]);
            applyItems(list, [{id: "a"}]);
            expect(pick(list.videos[0], "provider", "target")).toEqual({provider: "youtube", target: "player"});
        });

        it("modifie l'info sur place sans rien renvoyer", () => {
            const list = makeList(["a", "b"]);
            expect(applyItems(list, [{id: "a"}, {id: "b"}])).toBeUndefined();
            expect(list.videos).toHaveLength(2);
        });
    });

    describe("priorité aux valeurs déclarées", () => {
        const declared = {
            title: "Déclaré",
            description: "Déclarée",
            channel: "Chaîne déclarée",
            channelUrl: "https://declared.test",
            thumbnail: "https://declared.test/i.jpg",
            duration: 30,
            startSeconds: 10
        };

        it("ne remplace aucun champ déjà déclaré", () => {
            const list = makeList(["a"], [video("a", declared)]);
            applyItems(list, [{id: "a", ...FULL, startSeconds: 99}]);
            expect(fields(list.videos[0])).toEqual(declared);
        });

        it("ne comble que les champs vides", () => {
            const list = makeList(["a"], [video("a", {title: "Déclaré"})]);
            applyItems(list, [{id: "a", ...FULL}]);

            expect(fields(list.videos[0])).toEqual({...FULL, title: "Déclaré"});
        });

        it("conserve l'autoplay déclaré, sinon aucun", () => {
            const list = makeList(["a", "b"], [video("a", {autoplay: AUTOPLAY_MODES.CLICK})]);
            applyItems(list, [{id: "a"}, {id: "b"}]);

            expect(list.videos[0].autoplay).toBe(AUTOPLAY_MODES.CLICK);
            expect(list.videos[1].autoplay).toBe(AUTOPLAY_MODES.NONE);
        });

        // ⚠ Échoue : applyItems reconstruit chaque VideoInfo sans recopier `key`.
        it("conserve la clé personnalisée d'une vidéo déclarée", () => {
            const list = makeList(["a"], [video("a", {key: "ma-cle"})]);
            applyItems(list, [{id: "a"}]);
            expect(list.videos[0].key).toBe("ma-cle");
        });

        // ⚠ Échoue : même cause, `extra` n'est pas recopié.
        it("conserve le champ extra d'une vidéo déclarée", () => {
            const list = makeList(["a"], [video("a", {extra: "plus"})]);
            applyItems(list, [{id: "a"}]);
            expect(list.videos[0].extra).toBe("plus");
        });
    });

    describe("identifiants", () => {
        it("prend les identifiants de la liste quand les items n'en ont pas", () => {
            const list = makeList(["a", "b"]);
            applyItems(list, [{title: "1"}, {title: "2"}]);
            expect(list.videos.map((v) => v.videoId)).toEqual(["a", "b"]);
        });

        it("donne la priorité à l'identifiant de l'item", () => {
            const list = makeList(["a"]);
            applyItems(list, [{id: "z"}]);
            expect(list.videos[0].videoId).toBe("z");
        });

        it("reprend les identifiants des vidéos de repli d'une playlist", () => {
            const playlist = makePlaylist("PL1", [video("x"), video("y")]);
            applyItems(playlist, [{}, {}]);
            expect(playlist.videos.map((v) => v.videoId)).toEqual(["x", "y"]);
        });

        it("crée des identifiants provisoires pour une playlist sans identifiants", () => {
            const playlist = makePlaylist("PL1");
            applyItems(playlist, [{title: "1"}, {title: "2"}]);
            expect(playlist.videos.map((v) => v.videoId)).toEqual(["PL1#0", "PL1#1"]);
        });

        it("ignore les items dont l'identifiant est introuvable", () => {
            const list = makeList(["a"]);
            applyItems(list, [{title: "1"}, {title: "2"}]);
            expect(list.videos.map((v) => v.videoId)).toEqual(["a"]);
        });

        it("retrouve la vidéo déclarée par son identifiant quand l'ordre change", () => {
            const playlist = makePlaylist("PL1", [video("x", {title: "X"}), video("y", {title: "Y"})]);
            applyItems(playlist, [{id: "y"}, {id: "x"}]);

            expect(playlist.videos.map((v) => [v.videoId, v.title])).toEqual([["y", "Y"], ["x", "X"]]);
        });
    });
});

// ═════════════════════════════════════════════
// applyDefinition
// ═════════════════════════════════════════════
describe("applyDefinition", () => {
    it.each([[null], [undefined]])("renvoie false pour la définition %j", (definition) => {
        expect(applyDefinition(video("a"), definition)).toBe(false);
    });

    describe("vidéo seule", () => {
        it("comble tous les champs vides et renvoie true", () => {
            const v = video("a");
            const changed = applyDefinition(v, {
                title: "T", description: "D", channel: "C", channelUrl: "https://c.test", thumbnail: "https://t.test/i.jpg", duration: 90
            });

            expect(changed).toBe(true);
            expect(pick(v, "title", "description", "channel", "channelUrl", "thumbnail", "duration"))
                .toEqual({title: "T", description: "D", channel: "C", channelUrl: "https://c.test", thumbnail: "https://t.test/i.jpg", duration: 90});
        });

        it("ne remplace pas ce qui est déclaré et renvoie false", () => {
            const v = video("a", {title: "T", description: "D", channel: "C", channelUrl: "U", thumbnail: "X", duration: 5});
            expect(applyDefinition(v, {title: "autre"})).toBe(false);
            expect(v.title).toBe("T");
        });

        it("ignore la propriété videos", () => {
            expect(applyDefinition(video("a"), {videos: [{title: "x"}]})).toBe(false);
        });
    });

    describe("liste et playlist", () => {
        it.each([
            ["sans videos", {}],
            ["avec videos vide", {videos: []}]
        ])("renvoie false et ne touche à rien %s", (_, definition) => {
            const list = makeList(["a"], [video("a", {title: "T"})]);
            expect(applyDefinition(list, definition)).toBe(false);
            expect(list.videos[0].title).toBe("T");
        });

        it("applique les items par position pour une liste de vidéos", () => {
            const list = makeList(["a", "b"]);
            const changed = applyDefinition(list, {videos: [{title: "Un"}, {title: "Deux"}]});

            expect(changed).toBe(true);
            expect(list.videos.map((v) => [v.videoId, v.title])).toEqual([["a", "Un"], ["b", "Deux"]]);
        });

        it("transmet aussi description, channelUrl et duration", () => {
            const list = makeList(["a"]);
            applyDefinition(list, {videos: [{description: "D", channelUrl: "https://c.test", duration: 42}]});
            expect(pick(list.videos[0], "description", "channelUrl", "duration"))
                .toEqual({description: "D", channelUrl: "https://c.test", duration: 42});
        });

        it("utilise l'id des items pour une playlist", () => {
            const playlist = makePlaylist("PL1");
            applyDefinition(playlist, {videos: [{id: "v1", title: "Un"}, {id: "v2", title: "Deux"}]});
            expect(playlist.videos.map((v) => [v.videoId, v.title])).toEqual([["v1", "Un"], ["v2", "Deux"]]);
        });
    });
});

// ═════════════════════════════════════════════
// resolveDefinition
// ═════════════════════════════════════════════
describe("resolveDefinition", () => {
    it("appelle la fonction avec l'info et renvoie son résultat", () => {
        const info = video("a");
        const fn = vi.fn(() => ({title: "T"}));
        expect(resolveDefinition(fn, info)).toEqual({title: "T"});
        expect(fn).toHaveBeenCalledWith(info);
    });

    it("renvoie null quand la fonction ne renvoie rien", () => {
        expect(resolveDefinition(() => undefined, video("a"))).toBeNull();
        expect(resolveDefinition(() => null, video("a"))).toBeNull();
    });

    it("cherche dans l'objet par clé d'info (vidéo, liste, playlist)", () => {
        const single = video("a");
        const list = makeList(["a", "b"]);
        const playlist = makePlaylist("PL1");
        const definitions = {
            "youtube:a": {title: "vidéo"},
            "youtube:list:a,b": {title: "liste"},
            "youtube:playlist:PL1": {title: "playlist"}
        };

        expect(resolveDefinition(definitions, single)).toEqual({title: "vidéo"});
        expect(resolveDefinition(definitions, list)).toEqual({title: "liste"});
        expect(resolveDefinition(definitions, playlist)).toEqual({title: "playlist"});
    });

    it.each([[{}], [null], [undefined]])("renvoie null quand rien ne correspond (%j)", (definitions) => {
        expect(resolveDefinition(definitions, video("a"))).toBeNull();
    });
});
