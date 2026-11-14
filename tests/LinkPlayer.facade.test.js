import {afterEach, describe, expect, it, vi} from "vitest";

vi.mock("../src/ui/PanelRenderer.js", () => ({
    PanelRenderer: class {
        render = vi.fn();
        clear = vi.fn();
        setCurrent = vi.fn();
        destroy = vi.fn();
    }
}));

import {LinkPlayer} from "../src/LinkPlayer.js";

// ───────── helpers ─────────

const makeInfo = (key, {isPlaylist = false, videoIds, videos = [], showOnInit = false} = {}) =>
    ({key, provider: "yt", isPlaylist, videoIds, videos, showOnInit});
const video = (key, options) => makeInfo(key, options);
const playlist = (key, nb = 3) =>
    makeInfo(key, {isPlaylist: true, videoIds: Array.from({length: nb}, (_, i) => `v${i}`)});

function makePlayer(iframe) {
    const unsubscribe = vi.fn();
    return {
        kind: "yt",
        iframe: iframe ?? document.createElement("iframe"),
        load: vi.fn(),
        next: vi.fn(),
        previous: vi.fn(),
        playAt: vi.fn(),
        pause: vi.fn(),
        dispose: vi.fn(),
        subscribe: vi.fn(() => unsubscribe)
    };
}

let current; // l'environnement du test en cours, nettoyé après chaque test

/**
 * withHost: false => l'élément #zone n'existe pas quand la région est créée.
 * discover() simule la découverte du conteneur par le RegionHost.
 * saved: état sauvegardé, lu par LinkPlayer au scan().
 */
function createEnv({withHost = true, saved = {}, ...options} = {}) {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    host.id = "zone";
    if (withHost) document.body.append(host);

    const players = [];
    const provider = {
        id: "yt",
        createPlayer: vi.fn((opts) => {
            const player = makePlayer(opts?.iframe);
            players.push(player);
            return player;
        })
    };
    const registry = {get: vi.fn(() => provider), resolve: vi.fn(() => provider)};
    const panel = {render: vi.fn(), clear: vi.fn(), setCurrent: vi.fn(), destroy: vi.fn()};
    const store = {get: vi.fn((key) => saved[key] ?? null), set: vi.fn()};

    let callbacks = null;
    const regionHost = {
        defaultTarget: null,
        setDefaultTarget: vi.fn(),
        init: vi.fn((c) => (callbacks = c)),
        discoverAll: vi.fn(),
        clear: vi.fn()
    };

    const lp = new LinkPlayer({
        autoScan: false,
        tooltip: false,
        registry,
        regionHost,
        panelRenderer: panel,
        store,
        onError: vi.fn(),
        ...options
    });

    /** Déclare des infos dans la région « zone » (la crée au besoin). */
    const declare = (...infos) => {
        const region = lp.getRegion("zone");
        infos.forEach((info) => region.add(info));
        return region;
    };

    current = {
        lp,
        host,
        players,
        provider,
        panel,
        declare,
        lastPlayer: () => players.at(-1),
        discover: () => {
            if (!host.isConnected) document.body.append(host);
            callbacks.onTargetDiscovered(new Map([["zone", host]]));
        }
    };
    return current;
}

afterEach(() => {
    current?.lp.dispose();
    current = null;
    document.body.innerHTML = "";
});

// ───────── façade : conteneur présent, actions directes ─────────

describe("LinkPlayer : façade avec conteneur (actions directes)", () => {
    describe("navigate() / replace()", () => {
        it("navigate() affiche l'info dans la région de la target", () => {
            const {lp, declare, lastPlayer} = createEnv();
            const region = declare(video("A"));
            lp.navigate("zone", "A", {autoplay: true});

            expect(region.current.key).toBe("A");
            expect(lastPlayer().load).toHaveBeenCalledWith(region.get("A"), {autoplay: true, index: 0});
        });

        it("navigate() lève une erreur pour une clé inconnue", () => {
            const {lp, declare} = createEnv();
            declare(video("A"));
            expect(() => lp.navigate("zone", "inconnue")).toThrow("No info found for key 'inconnue'");
        });

        it("replace() remplace l'entrée courante sans allonger l'historique", () => {
            const {lp, declare} = createEnv();
            const region = declare(video("A"), video("B"));
            lp.navigate("zone", "A");
            lp.replace("zone", "B");

            expect(region.current.key).toBe("B");
            expect(lp.canGoBack("zone")).toBe(false);
        });
    });

    describe("goBack() / goForward()", () => {
        it("parcourent l'historique et renvoient true", () => {
            const {lp, declare} = createEnv();
            const region = declare(video("A"), video("B"));
            lp.navigate("zone", "A");
            lp.navigate("zone", "B");

            expect(lp.goBack("zone")).toBe(true);
            expect(region.current.key).toBe("A");
            expect(lp.goForward("zone")).toBe(true);
            expect(region.current.key).toBe("B");
        });

        it("renvoient false aux extrémités", () => {
            const {lp, declare} = createEnv();
            declare(video("A"));
            lp.navigate("zone", "A");
            expect(lp.goBack("zone")).toBe(false);
            expect(lp.goForward("zone")).toBe(false);
        });
    });

    describe("nextInfo() / previousInfo()", () => {
        it("avancent et reculent dans l'ordre des infos, en lecture automatique", () => {
            const {lp, declare, lastPlayer} = createEnv();
            const region = declare(video("A"), video("B"), video("C"));
            lp.navigate("zone", "A");

            expect(lp.nextInfo("zone")).toBe(true);
            expect(region.current.key).toBe("B");
            expect(lastPlayer().load).toHaveBeenLastCalledWith(region.get("B"), {autoplay: true, index: 0});
            expect(lp.previousInfo("zone")).toBe(true);
            expect(region.current.key).toBe("A");
        });

        it("renvoient false aux extrémités", () => {
            const {lp, declare} = createEnv();
            declare(video("A"), video("B"));
            lp.navigate("zone", "A");
            expect(lp.previousInfo("zone")).toBe(false);
            lp.navigate("zone", "B");
            expect(lp.nextInfo("zone")).toBe(false);
        });

        it("transmettent les options (autoplay peut être désactivé)", () => {
            const {lp, declare, lastPlayer} = createEnv();
            const region = declare(video("A"), video("B"));
            lp.navigate("zone", "A");
            lp.nextInfo("zone", {autoplay: false});
            expect(lastPlayer().load).toHaveBeenLastCalledWith(region.get("B"), {autoplay: false, index: 0});
        });
    });

    describe("nextItem() / previousItem() / playAt()", () => {
        it("délèguent au lecteur de la région", () => {
            const {lp, declare, lastPlayer} = createEnv();
            declare(playlist("P", 5));
            lp.navigate("zone", "P");
            lp.nextItem("zone");
            lp.previousItem("zone");
            lp.playAt("zone", 3);

            expect(lastPlayer().next).toHaveBeenCalledTimes(1);
            expect(lastPlayer().previous).toHaveBeenCalledTimes(1);
            expect(lastPlayer().playAt).toHaveBeenCalledWith(3);
        });

        it("playAt() met à jour l'index courant", () => {
            const {lp, declare} = createEnv();
            const region = declare(playlist("P", 5));
            lp.navigate("zone", "P");
            lp.playAt("zone", 4);
            expect(region.currentIndex).toBe(4);
        });
    });

    describe("show() / hide() / toggle()", () => {
        it("hide() cache le conteneur et met le lecteur en pause", () => {
            const {lp, declare, host, lastPlayer} = createEnv();
            declare(video("A"));
            lp.navigate("zone", "A");
            lp.hide("zone");

            expect(host.hidden).toBe(true);
            expect(lastPlayer().pause).toHaveBeenCalled();
        });

        it("show() réaffiche le conteneur", () => {
            const {lp, declare, host} = createEnv();
            declare(video("A"));
            host.hidden = true;
            lp.show("zone");
            expect(host.hidden).toBe(false);
        });

        it("toggle() alterne", () => {
            const {lp, declare, host} = createEnv();
            declare(video("A"));
            lp.toggle("zone");
            expect(host.hidden).toBe(true);
            lp.toggle("zone");
            expect(host.hidden).toBe(false);
        });
    });
});

// ───────── façade : getters can* ─────────

describe("LinkPlayer : getters can*()", () => {
    it("sont tous faux sur une région vide", () => {
        const {lp} = createEnv();
        for (const name of [
            "canGoBack", "canGoForward", "canGoPreviousInfo", "canGoNextInfo",
            "canGoPreviousItem", "canGoNextItem"
        ]) {
            expect(lp[name]("zone"), name).toBe(false);
        }
    });

    it("canGoNextInfo() est vrai dès qu'il existe des infos, même sans info courante", () => {
        const {lp, declare} = createEnv();
        declare(video("A"), video("B"));
        expect(lp.canGoNextInfo("zone")).toBe(true);
        expect(lp.canGoPreviousInfo("zone")).toBe(false);
    });

    it("suivent la position dans la liste des infos", () => {
        const {lp, declare} = createEnv();
        declare(video("A"), video("B"), video("C"));

        lp.navigate("zone", "A");
        expect(lp.canGoPreviousInfo("zone")).toBe(false);
        expect(lp.canGoNextInfo("zone")).toBe(true);

        lp.navigate("zone", "B");
        expect(lp.canGoPreviousInfo("zone")).toBe(true);
        expect(lp.canGoNextInfo("zone")).toBe(true);

        lp.navigate("zone", "C");
        expect(lp.canGoNextInfo("zone")).toBe(false);
    });

    it("suivent l'historique", () => {
        const {lp, declare} = createEnv();
        declare(video("A"), video("B"));
        lp.navigate("zone", "A");
        expect(lp.canGoBack("zone")).toBe(false);

        lp.navigate("zone", "B");
        expect(lp.canGoBack("zone")).toBe(true);
        expect(lp.canGoForward("zone")).toBe(false);

        lp.goBack("zone");
        expect(lp.canGoBack("zone")).toBe(false);
        expect(lp.canGoForward("zone")).toBe(true);
    });

    it("suivent la position dans une playlist", () => {
        const {lp, declare} = createEnv();
        declare(playlist("P", 3));
        lp.navigate("zone", "P");
        expect(lp.canGoPreviousItem("zone")).toBe(false);
        expect(lp.canGoNextItem("zone")).toBe(true);

        lp.playAt("zone", 1);
        expect(lp.canGoPreviousItem("zone")).toBe(true);
        expect(lp.canGoNextItem("zone")).toBe(true);

        lp.playAt("zone", 2);
        expect(lp.canGoNextItem("zone")).toBe(false);
    });

    it("sont faux pour les items d'une vidéo seule", () => {
        const {lp, declare} = createEnv();
        declare(video("A"));
        lp.navigate("zone", "A");
        expect(lp.canGoPreviousItem("zone")).toBe(false);
        expect(lp.canGoNextItem("zone")).toBe(false);
    });
});

// ───────── façade : target inconnue ─────────

describe("LinkPlayer : façade avec une target encore inconnue", () => {
    it("crée la région au lieu de lever une erreur", () => {
        const {lp} = createEnv();
        expect(() => lp.canGoBack("nouvelle")).not.toThrow();
        expect(lp.regions.map((r) => r.target)).toContain("nouvelle");
    });

    it.each([
        "goBack", "goForward", "nextInfo", "previousInfo",
        "nextItem", "previousItem", "toggle", "show", "hide"
    ])("%s() ne lève pas d'erreur sur une target inconnue", (name) => {
        const {lp} = createEnv();
        expect(() => lp[name]("nouvelle")).not.toThrow();
    });

    it("playAt() ne lève pas d'erreur sur une target inconnue", () => {
        const {lp} = createEnv();
        expect(() => lp.playAt("nouvelle", 1)).not.toThrow();
    });
});

// ───────── façade : conteneur absent, actions différées ─────────

describe("LinkPlayer : façade sans conteneur (actions différées)", () => {
    it("navigate() est mis en attente puis exécuté à la découverte du conteneur", () => {
        const {lp, declare, provider, discover} = createEnv({withHost: false});
        const region = declare(video("A"));
        lp.navigate("zone", "A", {autoplay: true});

        expect(provider.createPlayer).not.toHaveBeenCalled();
        expect(region.hasPending()).toBe(true);

        discover();
        expect(region.current.key).toBe("A");
        expect(provider.createPlayer).toHaveBeenCalledTimes(1);
        expect(region.hasPending()).toBe(false);
    });

    it("navigate() lève quand même une erreur pour une clé inconnue", () => {
        const {lp, declare} = createEnv({withHost: false});
        declare(video("A"));
        expect(() => lp.navigate("zone", "inconnue")).toThrow("No info found for key 'inconnue'");
    });

    it("replace() est différé et ne laisse pas d'historique", () => {
        const {lp, declare, discover} = createEnv({withHost: false});
        const region = declare(video("A"), video("B"));
        lp.navigate("zone", "A");
        lp.replace("zone", "B");
        discover();

        expect(region.current.key).toBe("B");
        expect(lp.canGoBack("zone")).toBe(false);
    });

    it("goBack() renvoie false tout de suite et agit à la découverte", () => {
        const {lp, declare, discover} = createEnv({withHost: false});
        const region = declare(video("A"), video("B"));
        lp.navigate("zone", "A");
        lp.navigate("zone", "B");

        expect(lp.goBack("zone")).toBe(false);
        discover();
        expect(region.current.key).toBe("A");
    });

    it("nextInfo() renvoie false tout de suite et avance à la découverte", () => {
        const {lp, declare, discover} = createEnv({withHost: false});
        const region = declare(video("A"), video("B"), video("C"));
        lp.navigate("zone", "A");

        expect(lp.nextInfo("zone")).toBe(false);
        lp.nextInfo("zone");
        discover();

        expect(region.current.key).toBe("C");
    });

    it("previousInfo() est différé", () => {
        const {lp, declare, discover} = createEnv({withHost: false});
        const region = declare(video("A"), video("B"));
        lp.navigate("zone", "B");
        lp.previousInfo("zone");
        discover();
        expect(region.current.key).toBe("A");
    });

    it("nextItem(), previousItem() et playAt() attendent la navigation et le conteneur", () => {
        const {lp, declare, players, discover} = createEnv({withHost: false});
        const region = declare(playlist("P", 5));
        lp.navigate("zone", "P");
        lp.nextItem("zone");
        lp.previousItem("zone");
        lp.playAt("zone", 3);

        expect(players).toHaveLength(0);
        discover();

        expect(players[0].next).toHaveBeenCalledTimes(1);
        expect(players[0].previous).toHaveBeenCalledTimes(1);
        expect(players[0].playAt).toHaveBeenCalledWith(3);
        expect(region.currentIndex).toBe(3);
    });

    it("show() et toggle() sont différés puis directs une fois le conteneur connu", () => {
        const {lp, host, discover} = createEnv({withHost: false});
        host.hidden = true;
        lp.show("zone");
        expect(host.hidden).toBe(true); // rien ne s'est passé : le conteneur est inconnu
        discover();
        expect(host.hidden).toBe(false);

        lp.toggle("zone"); // le conteneur est connu : exécuté directement
        expect(host.hidden).toBe(true);
    });

    it("hide() avant la découverte cache le conteneur à la découverte", () => {
        const {lp, host, discover} = createEnv({withHost: false});
        lp.hide("zone");
        expect(host.hidden).toBe(false);
        discover();
        expect(host.hidden).toBe(true);
    });

    it("les getters can*() restent utilisables sans conteneur", () => {
        const {lp, declare} = createEnv({withHost: false});
        declare(video("A"), video("B"));
        expect(lp.canGoNextInfo("zone")).toBe(true);
        expect(lp.canGoBack("zone")).toBe(false);
    });

    it("exécute les actions dans l'ordre demandé", () => {
        const {lp, declare, discover} = createEnv({withHost: false});
        const region = declare(video("A"), video("B"));
        lp.navigate("zone", "A");
        lp.navigate("zone", "B");
        lp.goBack("zone");
        lp.goForward("zone");
        discover();

        expect(region.current.key).toBe("B");
    });
});

// ───────── façade vs restauration / showOnInit au scan ─────────

describe("LinkPlayer : une navigation explicite prime sur le scan()", () => {
    const sauvegarde = {"state:zone": {key: "A", index: 0}};

    describe("état sauvegardé", () => {
        it("sans navigation explicite : le scan restaure l'état sauvegardé", () => {
            const {lp, declare} = createEnv({saved: sauvegarde});
            const region = declare(video("A"), video("B"));
            lp.scan();
            expect(region.current.key).toBe("A");
        });

        it("avec navigate() avant le scan : l'état sauvegardé n'écrase pas la navigation", () => {
            const {lp, declare} = createEnv({saved: sauvegarde});
            const region = declare(video("A"), video("B"));
            lp.navigate("zone", "B");
            lp.scan();
            expect(region.current.key).toBe("B");
        });

        it("même résultat quand le conteneur n'est découvert qu'après", () => {
            const {lp, declare, discover} = createEnv({withHost: false, saved: sauvegarde});
            const region = declare(video("A"), video("B"));
            lp.navigate("zone", "B");
            lp.scan();
            discover();
            expect(region.current.key).toBe("B");
        });

        it("sans navigation explicite et sans conteneur : la restauration est différée", () => {
            const {lp, declare, discover} = createEnv({withHost: false, saved: sauvegarde});
            const region = declare(video("A"), video("B"));
            lp.scan();
            expect(region.current).toBeNull();
            discover();
            expect(region.current.key).toBe("A");
        });
    });

    describe("showOnInit", () => {
        it("sans navigation explicite : le scan affiche l'info showOnInit", () => {
            const {lp, declare} = createEnv();
            const region = declare(video("A", {showOnInit: true}), video("B"));
            lp.scan();
            expect(region.current.key).toBe("A");
        });

        it("avec navigate() avant le scan : showOnInit n'écrase pas la navigation", () => {
            const {lp, declare, players} = createEnv();
            const region = declare(video("A", {showOnInit: true}), video("B"));
            lp.navigate("zone", "B");
            lp.scan();

            expect(region.current.key).toBe("B");
            expect(players).toHaveLength(1);
        });
    });

    // l'état sauvegardé désigne B ; les deux actions affichent A (nextInfo() sans info courante va à la première)
    it.each([
        ["replace", (lp) => lp.replace("zone", "A")],
        ["nextInfo", (lp) => lp.nextInfo("zone")]
    ])("%s() compte aussi comme navigation explicite", (_nom, action) => {
        const {lp, declare} = createEnv({saved: {"state:zone": {key: "B", index: 0}}});
        const region = declare(video("A"), video("B"));
        action(lp);
        lp.scan();
        expect(region.current.key).toBe("A");
    });

    it("une navigation explicite sur une région n'empêche pas l'init des autres", () => {
        const {lp} = createEnv({saved: {...sauvegarde, "state:autre": {key: "X", index: 0}}});
        const zone = lp.getRegion("zone");
        zone.add(video("A"));
        zone.add(video("B"));
        const autre = lp.getRegion("autre");
        autre.add(video("X"));
        const element = document.createElement("div");
        element.id = "autre";
        document.body.append(element);
        autre.register(element);

        lp.navigate("zone", "B");
        lp.scan();

        expect(zone.current.key).toBe("B");
        expect(autre.current.key).toBe("X");
    });
});
