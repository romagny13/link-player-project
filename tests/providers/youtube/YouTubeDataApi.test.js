import { describe, it, expect, vi, beforeEach } from 'vitest';
import {YouTubeDataApi, YouTubeApiError, parseIsoDuration} from "../../../src/providers/youtube/YouTubeDataApi.js";

describe("parseIsoDuration", () => {
    it("parse les durées YouTube classiques", () => {
        expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
        expect(parseIsoDuration("PT15M33S")).toBe(933);
        expect(parseIsoDuration("PT45S")).toBe(45);
        expect(parseIsoDuration("PT0S")).toBe(0);
    });

    it("retourne null sur entrée invalide", () => {
        expect(parseIsoDuration(null)).toBeNull();
        expect(parseIsoDuration("")).toBeNull();
        expect(parseIsoDuration("invalid")).toBeNull();
    });
});

describe('YouTubeDataApi', () => {
    let fetchMock;
    let api;

    beforeEach(() => {
        fetchMock = vi.fn();
        api = new YouTubeDataApi({ apiKey: "test-key", fetch: fetchMock, timeoutMs: 1000 });
    });

    it("available est false sans clé", () => {
        const noKey = new YouTubeDataApi({ fetch: fetchMock });
        expect(noKey.available).toBe(false);
    });

    it("videos retourne une Map avec les métas attendues", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                items: [
                    {
                        id: "abc123",
                        snippet: {
                            title: "Ma vidéo",
                            channelTitle: "Ma chaîne",
                            thumbnails: { medium: { url: "https://i.ytimg.com/vi/abc123/mqdefault.jpg" } },
                        },
                        contentDetails: { duration: "PT5M30S" },
                    },
                ],
            }),
        });

        const result = await api.videos(["abc123"]);

        expect(result).toBeInstanceOf(Map);
        expect(result.get("abc123")).toEqual({
            title: "Ma vidéo",
            channel: "Ma chaîne",
            thumbnail: "https://i.ytimg.com/vi/abc123/mqdefault.jpg",
            duration: 330,
        });

        // Vérifie l’URL appelée
        const calledUrl = fetchMock.mock.calls[0][0].toString();
        expect(calledUrl).toContain("videos");
        expect(calledUrl).toContain("id=abc123");
        expect(calledUrl).toContain("part=snippet%2CcontentDetails");
        expect(calledUrl).toContain("key=test-key");
    });

    it("videos découpe bien par lots de 50", async () => {
        const ids = Array.from({ length: 60 }, (_, i) => `id${i}`);
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });

        await api.videos(ids);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("playlistItems respecte l’ordre et maxItems + arrête la pagination dès que possible", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                items: [
                    { snippet: { resourceId: { videoId: "v1" }, title: "A", channelTitle: "C", thumbnails: {} } },
                    { snippet: { resourceId: { videoId: "v2" }, title: "B", channelTitle: "C", thumbnails: {} } },
                ],
                nextPageToken: "TOKEN",
            }),
        });

        const result = await api.playlistItems("PLxxx", 2);

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe("v1");
        expect(result[1].id).toBe("v2");
        expect(fetchMock).toHaveBeenCalledTimes(1); // ← plus de 2
    });

    it("désactive l’API sur quotaExceeded / keyInvalid", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 403,
            json: async () => ({
                error: { errors: [{ reason: "quotaExceeded" }] },
            }),
        });

        await expect(api.videos(["x"])).rejects.toBeInstanceOf(YouTubeApiError);
        expect(api.available).toBe(false);

        // Les appels suivants ne doivent plus partir
        fetchMock.mockClear();
        await expect(api.videos(["y"])).rejects.toThrow(); // ou selon ton comportement souhaité
        // Si tu veux qu’il throw immédiatement sans fetch quand disabled, tu peux ajouter un guard dans #get
    });

    it("ne désactive PAS sur une playlist privée (403 sans reason disabling)", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 403,
            json: async () => ({
                error: { errors: [{ reason: "playlistItemsNotAccessible" }] }, // raison fictive
            }),
        });

        await expect(api.playlistItems("privatePL")).rejects.toBeInstanceOf(YouTubeApiError);
        expect(api.available).toBe(true); // toujours dispo
    });

    it("YouTubeApiError contient status et reason", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: async () => ({ error: { errors: [{ reason: "invalidParameter" }] } }),
        });

        try {
            await api.videos(["bad"]);
        } catch (e) {
            expect(e).toBeInstanceOf(YouTubeApiError);
            expect(e.status).toBe(400);
            expect(e.message).toContain("400");
            expect(e.message).toContain("invalidParameter");
        }
    });
});