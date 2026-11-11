// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ui/PanelRenderer.js", () => ({
  PanelRenderer: class {
    render = vi.fn();
    clear = vi.fn();
    setCurrent = vi.fn();
    destroy = vi.fn();
  }
}));

import { Region } from "../src/Region.js";

// ───────── helpers ─────────

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeInfo(
  key,
  { provider = "yt", isPlaylist = false, videoIds, videos = [] } = {}
) {
  return { key, provider, isPlaylist, videoIds, videos };
}

const video = (key, provider) => makeInfo(key, { provider });
const playlist = (key, nb = 3, provider) =>
  makeInfo(key, {
    provider,
    isPlaylist: true,
    videoIds: Array.from({ length: nb }, (_, i) => `v${i}`)
  });

function makePlayer(kind, iframe) {
  const listeners = new Set();
  const unsubscribe = vi.fn();
  return {
    kind,
    iframe: iframe ?? document.createElement("iframe"),
    load: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    playAt: vi.fn(),
    pause: vi.fn(),
    dispose: vi.fn(),
    unsubscribe,
    subscribe: vi.fn((cb) => {
      listeners.add(cb);
      return unsubscribe;
    }),
    emit: (event) => listeners.forEach((cb) => cb(event))
  };
}

function createEnv(options = {}) {
  document.body.innerHTML = `<div id="zone"></div>`;
  const host = document.getElementById("zone");
  const players = [];
  const providers = {};
  for (const id of ["yt", "dm"]) {
    providers[id] = {
      id,
      createPlayer: vi.fn((opts) => {
        const p = makePlayer(id, opts?.iframe);
        players.push(p);
        return p;
      })
    };
  }
  const registry = { get: vi.fn((id) => providers[id]) };
  const panel = {
    render: vi.fn(),
    clear: vi.fn(),
    setCurrent: vi.fn(),
    destroy: vi.fn()
  };
  const region = new Region({
    target: "zone",
    registry,
    panelRenderer: panel,
    ...options
  });
  const lastPlayer = () => players[players.length - 1];
  return { region, host, registry, providers, players, panel, lastPlayer };
}

function listen(region, type = "change") {
  const handler = vi.fn();
  region.on(type, handler);
  return handler;
}

// ───────── tests ─────────

describe("Region", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructeur", () => {
    it("lève une erreur quand la cible est introuvable", () => {
      document.body.innerHTML = "";
      expect(() => new Region({ target: "absent", registry: {} })).toThrow(
        "Target #absent not found"
      );
    });

    it("expose la cible", () => {
      const { region } = createEnv();
      expect(region.target).toBe("zone");
    });

    it("démarre dans un état vide", () => {
      const { region } = createEnv();
      expect(region.current).toBeNull();
      expect(region.currentIndex).toBe(0);
      expect(region.itemCount).toBe(0);
      expect(region.isVisible).toBe(true);
      expect(region.infos).toEqual([]);
    });

    it("désactive tous les contrôles au départ", () => {
      const { region } = createEnv();
      expect(region.canGoBack).toBe(false);
      expect(region.canGoForward).toBe(false);
      expect(region.canGoPreviousInfo).toBe(false);
      expect(region.canGoNextInfo).toBe(false);
      expect(region.canGoPreviousItem).toBe(false);
      expect(region.canGoNextItem).toBe(false);
    });
  });

  describe("infos", () => {
    it("ajoute une info et renvoie true", () => {
      const { region } = createEnv();
      const a = video("A");
      expect(region.add(a)).toBe(true);
      expect(region.has("A")).toBe(true);
      expect(region.get("A")).toBe(a);
    });

    it("refuse une clé déjà connue et renvoie false", () => {
      const { region } = createEnv();
      region.add(video("A"));
      expect(region.add(video("A"))).toBe(false);
      expect(region.infos).toHaveLength(1);
    });

    it("conserve l'ordre d'ajout", () => {
      const { region } = createEnv();
      region.add(video("B"));
      region.add(video("A"));
      expect(region.infos.map((i) => i.key)).toEqual(["B", "A"]);
    });

    it("expose une liste gelée", () => {
      const { region } = createEnv();
      region.add(video("A"));
      expect(Object.isFrozen(region.infos)).toBe(true);
    });

    it("renvoie undefined pour une clé inconnue", () => {
      const { region } = createEnv();
      expect(region.get("nope")).toBeUndefined();
      expect(region.has("nope")).toBe(false);
    });
  });

  describe("événements", () => {
    it("on() renvoie une fonction qui désabonne le handler", () => {
      const { region } = createEnv();
      region.add(video("A"));
      const handler = vi.fn();
      const off = region.on("change", handler);
      off();
      region.navigate("A");
      expect(handler).not.toHaveBeenCalled();
    });

    it("off() retire le handler", () => {
      const { region } = createEnv();
      region.add(video("A"));
      const handler = vi.fn();
      region.on("change", handler);
      region.off("change", handler);
      region.navigate("A");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("navigate()", () => {
    it("lève une erreur pour une clé inconnue", () => {
      const { region } = createEnv();
      expect(() => region.navigate("nope")).toThrow(
        "No info found for key 'nope'"
      );
    });

    it("crée un lecteur via le fournisseur de l'info et charge l'info", () => {
      const { region, providers, lastPlayer } = createEnv();
      const a = video("A");
      region.add(a);
      region.navigate("A");

      expect(providers.yt.createPlayer).toHaveBeenCalledTimes(1);
      expect(lastPlayer().load).toHaveBeenCalledWith(a, {
        autoplay: false,
        index: 0
      });
    });

    it("rend l'info courante", () => {
      const { region } = createEnv();
      const a = video("A");
      region.add(a);
      region.navigate("A");
      expect(region.current).toBe(a);
      expect(region.isCurrent("A")).toBe(true);
    });

    it("insère l'iframe avant le panneau dans l'hôte", () => {
      const { region, host, lastPlayer } = createEnv();
      const panelEl = document.createElement("aside");
      host.append(panelEl);
      region.add(video("A"));
      region.navigate("A");
      expect(host.firstChild).toBe(lastPlayer().iframe);
      expect(host.lastChild).toBe(panelEl);
    });

    it("affiche l'hôte s'il était caché", () => {
      const { region, host } = createEnv();
      region.add(video("A"));
      host.hidden = true;
      region.navigate("A");
      expect(host.hidden).toBe(false);
    });

    it("émet « change » avec la raison « navigate »", () => {
      const { region } = createEnv();
      const a = video("A");
      region.add(a);
      const handler = listen(region);
      region.navigate("A");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({
        type: "change",
        region,
        reason: "navigate",
        info: a,
        index: 0,
        visible: true
      });
    });

    it("transmet autoplay, index  (options de navigate)", () => {
      const { region, lastPlayer } = createEnv();
      const p = playlist("P", 5);
      region.add(p);
      const handler = listen(region);
      region.navigate("P", { autoplay: true, index: 2 });

      expect(lastPlayer().load).toHaveBeenCalledWith(p, {
        autoplay: true,
        index: 2
      });
      expect(region.currentIndex).toBe(2);
    });

    it("réutilise le même lecteur quand le fournisseur ne change pas", () => {
      const { region, providers } = createEnv();
      region.add(video("A"));
      region.add(video("B"));
      region.navigate("A");
      region.navigate("B");
      expect(providers.yt.createPlayer).toHaveBeenCalledTimes(1);
    });

    it("remplace le lecteur et l'iframe quand le fournisseur change", () => {
      const { region, host, providers, players } = createEnv();
      region.add(video("A", "yt"));
      region.add(video("B", "dm"));
      region.navigate("A");
      const ancien = players[0];
      region.navigate("B");

      expect(ancien.dispose).toHaveBeenCalled();
      expect(ancien.unsubscribe).toHaveBeenCalled();
      expect(host.contains(ancien.iframe)).toBe(false);
      expect(providers.dm.createPlayer).toHaveBeenCalledTimes(1);
      expect(host.contains(players[1].iframe)).toBe(true);
    });

    it("planifie la résolution des métadonnées d'une playlist", async () => {
      const resolveMeta = vi.fn().mockResolvedValue(false);
      const { region } = createEnv({ resolveMeta });
      const p = playlist("P");
      region.add(p);
      region.navigate("P");
      expect(resolveMeta).toHaveBeenCalledWith(p);
    });

    describe("quand l'info est déjà courante", () => {
      it("bascule la visibilité par défaut (toggle) sans nouvelle entrée de journal", () => {
        const { region, host } = createEnv();
        region.add(video("A"));
        region.navigate("A");
        const handler = listen(region);
        region.navigate("A");

        expect(host.hidden).toBe(true);
        expect(handler.mock.calls[0][0].reason).toBe("visibility");
        expect(region.canGoBack).toBe(false);
      });

      it("réaffiche l'hôte au second toggle", () => {
        const { region, host } = createEnv();
        region.add(video("A"));
        region.navigate("A");
        region.navigate("A");
        region.navigate("A");
        expect(host.hidden).toBe(false);
      });

      it("ne fait rien avec le comportement « skip »", () => {
        const { region, host, providers } = createEnv({
          currentBehavior: "skip"
        });
        region.add(video("A"));
        region.navigate("A");
        const handler = listen(region);
        region.navigate("A");

        expect(handler).not.toHaveBeenCalled();
        expect(host.hidden).toBe(false);
        expect(providers.yt.createPlayer).toHaveBeenCalledTimes(1);
      });

      it("navigue normalement avec un autre comportement", () => {
        const { region } = createEnv({ currentBehavior: "navigate" });
        region.add(video("A"));
        region.navigate("A");
        const handler = listen(region);
        region.navigate("A");

        expect(handler.mock.calls[0][0].reason).toBe("navigate");
        expect(region.canGoBack).toBe(true);
      });
    });
  });

  describe("replace()", () => {
    it("lève une erreur pour une clé inconnue", () => {
      const { region } = createEnv();
      expect(() => region.replace("nope")).toThrow(
        "No info found for key 'nope'"
      );
    });

    it("remplace l'entrée courante sans ajouter d'historique", () => {
      const { region } = createEnv();
      const b = video("B");
      region.add(video("A"));
      region.add(b);
      region.navigate("A");
      region.replace("B");

      expect(region.current).toBe(b);
      expect(region.canGoBack).toBe(false);
    });

    it("transmet autoplay, index", () => {
      const { region, lastPlayer } = createEnv();
      const p = playlist("P", 4);
      region.add(p);
      const handler = listen(region);
      region.replace("P", { autoplay: true, index: 1 });

      expect(lastPlayer().load).toHaveBeenCalledWith(p, {
        autoplay: true,
        index: 1
      });
      expect(handler.mock.calls[0][0]).toMatchObject({
        reason: "replace",
        index: 1,
      });
    });
  });

  describe("journal : goBack() / goForward()", () => {
    let env;

    beforeEach(() => {
      env = createEnv();
      env.region.add(video("A"));
      env.region.add(playlist("P", 5));
      env.region.add(video("C"));
      env.region.navigate("A");
      env.region.navigate("P", { index: 3 });
      env.region.navigate("C");
    });

    it("renvoie false quand il n'y a rien à restaurer", () => {
      const { region } = createEnv();
      expect(region.goBack()).toBe(false);
      expect(region.goForward()).toBe(false);
    });

    it("recule d'une entrée et renvoie true", () => {
      expect(env.region.goBack()).toBe(true);
      expect(env.region.current.key).toBe("P");
    });

    it("restaure l'index de l'item sans lancer la lecture", () => {
      env.region.goBack();
      expect(env.region.currentIndex).toBe(3);
      expect(env.lastPlayer().load).toHaveBeenLastCalledWith(
        env.region.get("P"),
        { autoplay: false, index: 3 }
      );
    });

    it("émet « change » avec les raisons « back » et « forward »", () => {
      const handler = listen(env.region);
      env.region.goBack();
      env.region.goForward();
      expect(handler.mock.calls.map(([e]) => e.reason)).toEqual([
        "back",
        "forward"
      ]);
    });

    it("met à jour canGoBack / canGoForward", () => {
      expect(env.region.canGoBack).toBe(true);
      expect(env.region.canGoForward).toBe(false);
      env.region.goBack();
      env.region.goBack();
      expect(env.region.canGoBack).toBe(false);
      expect(env.region.canGoForward).toBe(true);
    });

    it("ne crée pas d'entrée de journal en navigant dans l'historique", () => {
      env.region.goBack();
      env.region.goForward();
      env.region.goBack();
      env.region.goBack();
      expect(env.region.goBack()).toBe(false);
      expect(env.region.goForward()).toBe(true);
      expect(env.region.goForward()).toBe(true);
      expect(env.region.goForward()).toBe(false);
    });

    it("supprime l'historique « avant » après une nouvelle navigation", () => {
      env.region.goBack();
      env.region.navigate("A");
      expect(env.region.canGoForward).toBe(false);
    });
  });

  describe("navigation entre les infos", () => {
    let env;

    beforeEach(() => {
      env = createEnv();
      env.region.add(video("A"));
      env.region.add(video("B"));
      env.region.add(video("C"));
    });

    it("autorise « suivant » dès qu'il existe des infos mais aucune courante", () => {
      expect(env.region.canGoNextInfo).toBe(true);
      expect(env.region.canGoPreviousInfo).toBe(false);
    });

    it("nextInfo() sans info courante va à la première, en lecture automatique", () => {
      expect(env.region.nextInfo()).toBe(true);
      expect(env.region.current.key).toBe("A");
      expect(env.lastPlayer().load).toHaveBeenCalledWith(env.region.get("A"), {
        autoplay: true,
        index: 0
      });
    });

    it("nextInfo() avance dans l'ordre des liens", () => {
      env.region.navigate("A");
      env.region.nextInfo();
      expect(env.region.current.key).toBe("B");
    });

    it("previousInfo() recule dans l'ordre des liens", () => {
      env.region.navigate("C");
      env.region.previousInfo();
      expect(env.region.current.key).toBe("B");
    });

    it("renvoie false aux extrémités", () => {
      env.region.navigate("C");
      expect(env.region.nextInfo()).toBe(false);
      expect(env.region.canGoNextInfo).toBe(false);
      env.region.navigate("A");
      expect(env.region.previousInfo()).toBe(false);
      expect(env.region.canGoPreviousInfo).toBe(false);
    });

    it("ajoute une entrée au journal", () => {
      env.region.navigate("A");
      env.region.nextInfo();
      expect(env.region.canGoBack).toBe(true);
      env.region.goBack();
      expect(env.region.current.key).toBe("A");
    });

    it("émet « change » avec la raison « navigate »", () => {
      env.region.navigate("A");
      const handler = listen(env.region);
      env.region.nextInfo();
      expect(handler.mock.calls[0][0].reason).toBe("navigate");
    });
  });

  describe("navigation entre les items", () => {
    it("nextItem() / previousItem() délèguent au lecteur", () => {
      const { region, lastPlayer } = createEnv();
      region.add(playlist("P"));
      region.navigate("P");
      region.nextItem();
      region.previousItem();
      expect(lastPlayer().next).toHaveBeenCalledTimes(1);
      expect(lastPlayer().previous).toHaveBeenCalledTimes(1);
    });

    it("ne plante pas sans lecteur", () => {
      const { region } = createEnv();
      expect(() => {
        region.nextItem();
        region.previousItem();
      }).not.toThrow();
    });

    it("playAt() délègue au lecteur, met à jour l'index, le panneau et émet « change »", () => {
      const { region, lastPlayer, panel } = createEnv();
      region.add(playlist("P", 5));
      region.navigate("P");
      const handler = listen(region);
      region.playAt(3);

      expect(lastPlayer().playAt).toHaveBeenCalledWith(3);
      expect(region.currentIndex).toBe(3);
      expect(panel.setCurrent).toHaveBeenCalledWith(3);
      expect(handler.mock.calls[0][0]).toMatchObject({
        reason: "item",
        index: 3
      });
    });

    it("playAt() est mémorisé dans le journal (restauré au retour)", () => {
      const { region } = createEnv();
      region.add(playlist("P", 5));
      region.add(video("A"));
      region.navigate("P");
      region.playAt(2);
      region.navigate("A");
      region.goBack();
      expect(region.currentIndex).toBe(2);
    });

    describe("getters can*Item", () => {
      it("sont désactivés pour une vidéo seule", () => {
        const { region } = createEnv();
        region.add(video("A"));
        region.navigate("A");
        expect(region.canGoPreviousItem).toBe(false);
        expect(region.canGoNextItem).toBe(false);
        expect(region.itemCount).toBe(0);
      });

      it("tiennent compte de l'index dans une playlist", () => {
        const { region } = createEnv();
        region.add(playlist("P", 3));
        region.navigate("P");
        expect(region.canGoPreviousItem).toBe(false);
        expect(region.canGoNextItem).toBe(true);
        region.playAt(1);
        expect(region.canGoPreviousItem).toBe(true);
        expect(region.canGoNextItem).toBe(true);
        region.playAt(2);
        expect(region.canGoNextItem).toBe(false);
      });

      it("itemCount utilise videoIds en priorité", () => {
        const { region } = createEnv();
        region.add(playlist("P", 4));
        region.navigate("P");
        expect(region.itemCount).toBe(4);
      });

      it("itemCount se rabat sur videos quand videoIds est absent", () => {
        const { region } = createEnv();
        region.add(makeInfo("P", { isPlaylist: true, videos: [{}, {}] }));
        region.navigate("P");
        expect(region.itemCount).toBe(2);
      });

      it("itemCount vaut null quand le nombre est inconnu, et « suivant » reste possible", () => {
        const { region } = createEnv();
        region.add(makeInfo("P", { isPlaylist: true }));
        region.navigate("P");
        expect(region.itemCount).toBeNull();
        expect(region.canGoNextItem).toBe(true);
      });
    });
  });

  describe("panneau", () => {
    it("est vidé pour une vidéo seule", () => {
      const { region, panel } = createEnv();
      region.add(video("A"));
      region.navigate("A");
      expect(panel.clear).toHaveBeenCalled();
      expect(panel.render).not.toHaveBeenCalled();
    });

    it("est dessiné pour une playlist avec l'index courant", () => {
      const { region, panel, host, lastPlayer } = createEnv();
      const p = playlist("P", 5);
      region.add(p);
      region.navigate("P", { index: 2 });

      expect(panel.render).toHaveBeenCalledTimes(1);
      expect(panel.render).toHaveBeenCalledWith(
        expect.objectContaining({
          host,
          iframe: lastPlayer().iframe,
          info: p,
          current: 2
        })
      );
    });

    it("onSelectItem lance playAt()", () => {
      const { region, panel, lastPlayer } = createEnv();
      region.add(playlist("P", 5));
      region.navigate("P");
      panel.render.mock.calls[0][0].onSelectItem(4);
      expect(lastPlayer().playAt).toHaveBeenCalledWith(4);
      expect(region.currentIndex).toBe(4);
    });

    it("n'est pas redessiné pour la même playlist (setCurrent seulement)", () => {
      const { region, panel } = createEnv({ currentBehavior: "navigate" });
      region.add(playlist("P", 5));
      region.navigate("P");
      region.navigate("P", { index: 3 });
      expect(panel.render).toHaveBeenCalledTimes(1);
      expect(panel.setCurrent).toHaveBeenCalledWith(3);
    });

    it("est redessiné après être passé par une autre info", () => {
      const { region, panel } = createEnv();
      region.add(playlist("P", 5));
      region.add(video("A"));
      region.navigate("P");
      region.navigate("A");
      region.goBack();
      expect(panel.render).toHaveBeenCalledTimes(2);
    });
  });

  describe("événements du lecteur", () => {
    let env;

    beforeEach(() => {
      env = createEnv();
      env.region.add(playlist("P", 5));
      env.region.navigate("P");
    });

    it("« itemChange » met à jour l'index, le panneau et émet « change » (item)", () => {
      const handler = listen(env.region);
      env.lastPlayer().emit({ type: "itemChange", index: 2 });

      expect(env.region.currentIndex).toBe(2);
      expect(env.panel.setCurrent).toHaveBeenCalledWith(2);
      expect(handler.mock.calls[0][0]).toMatchObject({
        reason: "item",
        index: 2
      });
    });

    it("« itemChange » prévient les vues dépendantes", () => {
      const fn = vi.fn();
      env.region.registerDependentView("v", fn);
      env.lastPlayer().emit({ type: "itemChange", index: 1 });
      expect(fn).toHaveBeenCalledWith(env.region.current);
    });

    it("« state » est relayé avec l'index fourni", () => {
      const handler = listen(env.region, "state");
      env.lastPlayer().emit({ type: "state", state: "playing", index: 3 });
      expect(handler.mock.calls[0][0]).toMatchObject({
        type: "state",
        region: env.region,
        state: "playing",
        index: 3
      });
    });

    it("« state » utilise l'index courant quand il n'est pas fourni", () => {
      env.lastPlayer().emit({ type: "itemChange", index: 4 });
      const handler = listen(env.region, "state");
      env.lastPlayer().emit({ type: "state", state: "paused" });
      expect(handler.mock.calls[0][0].index).toBe(4);
    });

    it("« error » est relayé avec l'info courante", () => {
      const handler = listen(env.region, "error");
      const erreur = new Error("boom");
      env.lastPlayer().emit({ type: "error", error: erreur });
      expect(handler.mock.calls[0][0]).toMatchObject({
        error: erreur,
        info: env.region.current
      });
    });
  });

  describe("erreurs", () => {
    it("émet « error » avec l'info quand la création du lecteur échoue, sans « change »", () => {
      const { region, providers } = createEnv();
      const erreur = new Error("création");
      providers.yt.createPlayer.mockImplementationOnce(() => {
        throw erreur;
      });
      const a = video("A");
      region.add(a);
      const onError = listen(region, "error");
      const onChange = listen(region);
      region.navigate("A");

      expect(onError.mock.calls[0][0]).toMatchObject({
        error: erreur,
        info: a,
        region
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it("émet « error » quand le chargement échoue", () => {
      const { region, providers, players } = createEnv();
      const erreur = new Error("load");
      providers.yt.createPlayer.mockImplementationOnce(() => {
        const p = makePlayer("yt");
        p.load.mockImplementation(() => {
          throw erreur;
        });
        players.push(p);
        return p;
      });
      region.add(video("A"));
      const onError = listen(region, "error");
      region.navigate("A");
      expect(onError.mock.calls[0][0].error).toBe(erreur);
    });

    it("journalise dans la console quand personne n'écoute « error »", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { region, providers } = createEnv();
      const erreur = new Error("silencieuse");
      providers.yt.createPlayer.mockImplementationOnce(() => {
        throw erreur;
      });
      region.add(video("A"));
      region.navigate("A");
      expect(spy).toHaveBeenCalledWith("[Region]", erreur);
    });

    it("ne journalise pas quand un handler « error » existe", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { region, providers } = createEnv();
      providers.yt.createPlayer.mockImplementationOnce(() => {
        throw new Error("x");
      });
      region.add(video("A"));
      listen(region, "error");
      region.navigate("A");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("résolution des métadonnées", () => {
    it("redessine le panneau quand resolveMeta renvoie true", async () => {
      const resolveMeta = vi.fn().mockResolvedValue(true);
      const { region, panel } = createEnv({ resolveMeta });
      region.add(playlist("P", 5));
      region.navigate("P", { index: 1 });
      await flush();

      expect(panel.render).toHaveBeenCalledTimes(2);
      expect(panel.render.mock.calls[1][0]).toMatchObject({ current: 1 });
    });

    it("ne redessine pas quand resolveMeta renvoie false", async () => {
      const resolveMeta = vi.fn().mockResolvedValue(false);
      const { region, panel } = createEnv({ resolveMeta });
      region.add(playlist("P"));
      region.navigate("P");
      await flush();
      expect(panel.render).toHaveBeenCalledTimes(1);
    });

    it("accepte un resolveMeta synchrone", async () => {
      const { region, panel } = createEnv({ resolveMeta: () => true });
      region.add(playlist("P"));
      region.navigate("P");
      await flush();
      expect(panel.render).toHaveBeenCalledTimes(2);
    });

    it("ne redessine pas si l'info n'est plus courante", async () => {
      let fin;
      const resolveMeta = vi.fn(
        () => new Promise((resolve) => (fin = resolve))
      );
      const { region, panel } = createEnv({ resolveMeta });
      region.add(playlist("P"));
      region.add(video("A"));
      region.navigate("P");
      region.navigate("A");
      fin(true);
      await flush();
      expect(panel.render).toHaveBeenCalledTimes(1);
    });

    it("n'est appelé qu'une fois par playlist", () => {
      const resolveMeta = vi.fn().mockResolvedValue(false);
      const { region } = createEnv({
        resolveMeta,
        currentBehavior: "navigate"
      });
      region.add(playlist("P"));
      region.navigate("P");
      region.navigate("P");
      expect(resolveMeta).toHaveBeenCalledTimes(1);
    });

    it("n'est pas appelé pour une vidéo seule", () => {
      const resolveMeta = vi.fn();
      const { region } = createEnv({ resolveMeta });
      region.add(video("A"));
      region.navigate("A");
      expect(resolveMeta).not.toHaveBeenCalled();
    });

    it("émet « error » quand resolveMeta échoue", async () => {
      const erreur = new Error("api");
      const { region } = createEnv({
        resolveMeta: vi.fn().mockRejectedValue(erreur)
      });
      const p = playlist("P");
      region.add(p);
      const onError = listen(region, "error");
      region.navigate("P");
      await flush();
      expect(onError.mock.calls[0][0]).toMatchObject({
        error: erreur,
        info: p
      });
    });
  });

  describe("visibilité", () => {
    it("hide() met le lecteur en pause, cache l'hôte et émet « change » (visibility)", () => {
      const { region, host, lastPlayer } = createEnv();
      region.add(video("A"));
      region.navigate("A");
      const handler = listen(region);
      region.hide();

      expect(lastPlayer().pause).toHaveBeenCalled();
      expect(host.hidden).toBe(true);
      expect(region.isVisible).toBe(false);
      expect(handler.mock.calls[0][0]).toMatchObject({
        reason: "visibility",
        visible: false
      });
    });

    it("hide() ne plante pas sans lecteur", () => {
      const { region, host } = createEnv();
      expect(() => region.hide()).not.toThrow();
      expect(host.hidden).toBe(true);
    });

    it("show() affiche l'hôte et émet « change »", () => {
      const { region, host } = createEnv();
      host.hidden = true;
      const handler = listen(region);
      region.show();
      expect(host.hidden).toBe(false);
      expect(handler.mock.calls[0][0]).toMatchObject({
        reason: "visibility",
        visible: true
      });
    });

    it("toggle() alterne entre caché et visible", () => {
      const { region } = createEnv();
      region.toggle();
      expect(region.isVisible).toBe(false);
      region.toggle();
      expect(region.isVisible).toBe(true);
    });
  });

  describe("adopt()", () => {
    function withIframe(host) {
      const iframe = document.createElement("iframe");
      host.append(iframe);
      return iframe;
    }

    it("lève une erreur quand l'iframe est hors de la cible", () => {
      const { region } = createEnv();
      const dehors = document.createElement("iframe");
      document.body.append(dehors);
      expect(() => region.adopt(dehors, video("A"))).toThrow(
        "The iframe is not inside #zone"
      );
    });

    it("ajoute l'info et la rend courante", () => {
      const { region, host } = createEnv();
      const a = video("A");
      region.adopt(withIframe(host), a);
      expect(region.has("A")).toBe(true);
      expect(region.current).toBe(a);
    });

    it("crée le lecteur sur l'iframe existante", () => {
      const { region, host, providers } = createEnv();
      const iframe = withIframe(host);
      region.adopt(iframe, video("A"));
      expect(providers.yt.createPlayer).toHaveBeenCalledWith({ iframe });
    });

    it("émet « change » avec la raison « adopt » et l'index donné", () => {
      const { region, host } = createEnv();
      const handler = listen(region);
      region.adopt(withIframe(host), playlist("P", 5), { index: 2 });
      expect(handler.mock.calls[0][0]).toMatchObject({
        reason: "adopt",
        index: 2
      });
    });

    it("dessine le panneau pour une playlist", () => {
      const { region, host, panel } = createEnv();
      const iframe = withIframe(host);
      region.adopt(iframe, playlist("P", 5), { index: 1 });
      expect(panel.render).toHaveBeenCalledWith(
        expect.objectContaining({ iframe, current: 1 })
      );
    });

    it("remplace un lecteur existant", () => {
      const { region, host, players } = createEnv();
      region.adopt(withIframe(host), video("A"));
      region.adopt(withIframe(host), video("B"));
      expect(players[0].dispose).toHaveBeenCalled();
    });

    it("planifie la résolution des métadonnées", () => {
      const resolveMeta = vi.fn().mockResolvedValue(false);
      const { region, host } = createEnv({ resolveMeta });
      const p = playlist("P");
      region.adopt(withIframe(host), p);
      expect(resolveMeta).toHaveBeenCalledWith(p);
    });

    it("ne supprime pas l'iframe adoptée quand le fournisseur change (elle est retirée explicitement)", () => {
      const { region, host } = createEnv();
      const iframe = withIframe(host);
      region.adopt(iframe, video("A", "yt"));
      region.add(video("B", "dm"));
      region.navigate("B");
      expect(host.contains(iframe)).toBe(false);
    });
  });

  describe("vues dépendantes", () => {
    it("enregistre une vue et la signale avec hasDependentView()", () => {
      const { region } = createEnv();
      region.registerDependentView("v", vi.fn());
      expect(region.hasDependentView("v")).toBe(true);
      expect(region.hasDependentView("autre")).toBe(false);
    });

    it("refuse un identifiant déjà enregistré", () => {
      const { region } = createEnv();
      region.registerDependentView("v", vi.fn());
      expect(() => region.registerDependentView("v", vi.fn())).toThrow(
        "Duplicate dependent view ID: 'v' is already registered."
      );
    });

    it("désenregistre une vue existante et renvoie true", () => {
      const { region } = createEnv();
      region.registerDependentView("v", vi.fn());
      expect(region.unregisterDependentView("v")).toBe(true);
      expect(region.hasDependentView("v")).toBe(false);
    });

    it("renvoie false avec un avertissement pour une vue inexistante", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { region } = createEnv();
      expect(region.unregisterDependentView("nope")).toBe(false);
      expect(warn).toHaveBeenCalled();
    });

    it("notifie toutes les vues avec l'info", () => {
      const { region } = createEnv();
      const f1 = vi.fn();
      const f2 = vi.fn();
      region.registerDependentView("a", f1);
      region.registerDependentView("b", f2);
      const info = video("A");
      region.notifyDependentViews(info);
      expect(f1).toHaveBeenCalledWith(info);
      expect(f2).toHaveBeenCalledWith(info);
    });

    it("une vue qui échoue n'empêche pas les autres d'être notifiées", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { region } = createEnv();
      const apres = vi.fn();
      region.registerDependentView("ko", () => {
        throw new Error("vue cassée");
      });
      region.registerDependentView("ok", apres);
      region.notifyDependentViews(video("A"));

      expect(apres).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining("'ko'"),
        expect.any(Error)
      );
    });

    it("ne notifie plus une vue désenregistrée", () => {
      const { region } = createEnv();
      const fn = vi.fn();
      region.registerDependentView("v", fn);
      region.unregisterDependentView("v");
      region.notifyDependentViews(video("A"));
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("dispose()", () => {
    it("libère le lecteur et détruit le panneau", () => {
      const { region, panel, lastPlayer } = createEnv();
      region.add(video("A"));
      region.navigate("A");
      const player = lastPlayer();
      region.dispose();

      expect(player.unsubscribe).toHaveBeenCalled();
      expect(player.dispose).toHaveBeenCalled();
      expect(panel.destroy).toHaveBeenCalled();
    });

    it("supprime tous les abonnements aux événements", () => {
      const { region } = createEnv();
      const handler = listen(region);
      region.dispose();
      region.show();
      expect(handler).not.toHaveBeenCalled();
    });

    it("ne plante pas sans lecteur", () => {
      const { region } = createEnv();
      expect(() => region.dispose()).not.toThrow();
    });
  });
});
