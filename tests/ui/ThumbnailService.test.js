import { describe, it, expect, vi } from "vitest";
import { ThumbnailService } from "../../src/ui/ThumbnailService.js";

/** Fake Image : on déclenche onload ou onerror manuellement */
function createFakeImageFactory({ mode = "success" } = {}) {
    return () => {
        const img = {
            onload: null,
            onerror: null,
            set src(_url) {
                // microtask pour rester async comme un vrai chargement
                queueMicrotask(() => {
                    if (mode === "success") img.onload?.();
                    else img.onerror?.();
                });
            },
        };
        return img;
    };
}

describe("ThumbnailService", () => {
    it("doit retourner null si url est vide / null / undefined", async () => {
        const service = new ThumbnailService();
        expect(await service.resolve(null)).toBeNull();
        expect(await service.resolve(undefined)).toBeNull();
        expect(await service.resolve("")).toBeNull();
    });

    it("doit retourner l'url si l'image charge correctement", async () => {
        const service = new ThumbnailService({
            createImage: createFakeImageFactory({ mode: "success" }),
        });

        await expect(service.resolve("https://cdn.test/ok.jpg")).resolves.toBe(
            "https://cdn.test/ok.jpg"
        );
    });

    it("doit retourner null si l'image échoue (onerror)", async () => {
        const service = new ThumbnailService({
            createImage: createFakeImageFactory({ mode: "error" }),
        });

        await expect(service.resolve("https://cdn.test/broken.jpg")).resolves.toBeNull();
    });

    it("ne doit jamais reject", async () => {
        const service = new ThumbnailService({
            createImage: createFakeImageFactory({ mode: "error" }),
        });

        await expect(service.resolve("https://x.test/nope.jpg")).resolves.not.toThrow();
        await expect(service.resolve("https://x.test/nope.jpg")).resolves.toBeNull();
    });

    it("doit dédupliquer les requêtes en cours pour la même url (cache pending)", async () => {
        let instanceCount = 0;
        const createImage = () => {
            instanceCount++;
            const img = {
                onload: null,
                onerror: null,
                set src(_u) {
                    // ne résout pas tout de suite → pending actif
                    this._src = _u;
                },
                /** helper test */
                succeed() {
                    this.onload?.();
                },
            };
            return img;
        };

        const service = new ThumbnailService({ createImage });

        const p1 = service.resolve("https://cdn.test/same.jpg");
        const p2 = service.resolve("https://cdn.test/same.jpg");

        // même promesse partagée
        expect(p1).toBe(p2);
        expect(instanceCount).toBe(1);

        // on laisse le premier Image "charger"
        // (récupérer l'instance est plus simple en capturant la dernière)
    });

    it("doit recréer un chargement si le précédent a échoué (pending nettoyé)", async () => {
        let mode = "error";
        let calls = 0;

        const service = new ThumbnailService({
            createImage: () => {
                calls++;
                const img = {
                    onload: null,
                    onerror: null,
                    set src(_u) {
                        queueMicrotask(() => {
                            if (mode === "success") img.onload?.();
                            else img.onerror?.();
                        });
                    },
                };
                return img;
            },
        });

        await expect(service.resolve("https://cdn.test/retry.jpg")).resolves.toBeNull();
        expect(calls).toBe(1);

        mode = "success";
        await expect(service.resolve("https://cdn.test/retry.jpg")).resolves.toBe(
            "https://cdn.test/retry.jpg"
        );
        expect(calls).toBe(2); // nouveau load car échec précédent → entrée supprimée
    });

    it("doit réutiliser le résultat en cache si le premier load a réussi", async () => {
        let calls = 0;
        const service = new ThumbnailService({
            createImage: () => {
                calls++;
                const img = {
                    onload: null,
                    onerror: null,
                    set src(_u) {
                        queueMicrotask(() => img.onload?.());
                    },
                };
                return img;
            },
        });

        const url = "https://cdn.test/cached.jpg";
        await expect(service.resolve(url)).resolves.toBe(url);
        await expect(service.resolve(url)).resolves.toBe(url);

        // 1 seul Image créé : la promesse reste dans #pending après succès
        expect(calls).toBe(1);
    });
});