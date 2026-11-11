import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {VideoInfo} from "../../../src/models/VideoInfo.js";
import {VideoListInfo} from "../../../src/models/VideoListInfo.js";
import {OkruPlayer} from "../../../src/providers/okru/OkruPlayer.js";
import {OkruEmbedSrcBuilder} from "../../../src/providers/okru/OkruEmbedSrcBuilder.js";

/* -------------------------------------------------------------------------- */
/* Faux OkruIframeBridge (le vrai parle à un iframe / postMessage)             */
/* -------------------------------------------------------------------------- */

const h = vi.hoisted(() => {
    const instances = [];

    class FakeBridge {
        constructor(iframe) {
            this.iframe = iframe;
            this.handler = null;
            this.options = null;
            this.command = vi.fn();
            this.connect = vi.fn();
            this.disconnect = vi.fn();
            instances.push(this);
        }

        subscribe(handler, options) {
            this.handler = handler;
            this.options = options;
        }

        emit(event) {
            this.handler(event);
        }
    }

    const Event = {VideoPlay: "video_play", VideoPause: "video_pause", VideoEnded: "video_ended", Error: "error"};
    return {instances, FakeBridge, Event};
});

vi.mock("../../../src/providers/okru/OkruIframeBridge.js", () => ({
    OkruIframeBridge: h.FakeBridge,
    OkruBridgeEvent: h.Event
}));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const fakeIframe = (src = "") => ({src, remove: vi.fn()});
const video = (videoId, startSeconds) =>
    new VideoInfo({provider: "okru", target: "player", videoId, startSeconds});
const list = (ids, startSecondsById = {}) => {
    const l = new VideoListInfo("okru", "player", ids, 0, false);
    ids.forEach((id) => l.addVideo(video(id, startSecondsById[id])));
    return l;
};
const lastBridge = () => h.instances.at(-1);

beforeEach(() => {
    h.instances.length = 0;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* OkruPlayer                                                                  */
/* -------------------------------------------------------------------------- */

describe("OkruPlayer", () => {
    /** Crée un player + createIframe espion + collecte des évènements. */
    const setup = (options = {}) => {
        const createIframe = vi.fn((src) => fakeIframe(src));
        const player = new OkruPlayer({createIframe, ...options});
        const events = [];
        player.subscribe((e) => events.push(e));
        return {player, createIframe, events};
    };

    it("kind = okru", () => {
        expect(new OkruPlayer().kind).toBe("okru");
    });

    describe("load : vidéo seule", () => {
        it("crée l'iframe avec la bonne src et connecte le bridge", () => {
            const {player, createIframe} = setup();
            player.load(video("123"));

            expect(createIframe).toHaveBeenCalledTimes(1);
            expect(createIframe).toHaveBeenCalledWith("https://ok.ru/videoembed/123");
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/123");
            expect(h.instances).toHaveLength(1);
            expect(lastBridge().connect).toHaveBeenCalledTimes(1);
            expect(lastBridge().iframe).toBe(player.iframe);
        });

        it("n'émet pas d'itemChange", () => {
            const {player, events} = setup();
            player.load(video("123"));
            expect(events).toEqual([]);
        });

        it("autoplay et startSeconds de la vidéo", () => {
            const {player} = setup();
            player.load(video("123", 90), {autoplay: true});
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/123?autoplay=1&fromTime=90");
        });

        it("souscrit aux 4 types d'évènements du bridge", () => {
            const {player} = setup();
            player.load(video("123"));
            expect(lastBridge().options.types).toEqual(
                [h.Event.VideoPlay, h.Event.VideoPause, h.Event.VideoEnded, h.Event.Error]
            );
        });

        it("index hors limites : rien ne se passe", () => {
            const {player, createIframe, events} = setup();
            player.load(video("123"), {index: 1});
            expect(createIframe).not.toHaveBeenCalled();
            expect(player.iframe).toBeNull();
            expect(events).toEqual([]);
        });

        it("recharge dans la même iframe (pas de nouvel iframe ni de nouveau bridge)", () => {
            const {player, createIframe} = setup();
            player.load(video("1"));
            const iframe = player.iframe;
            player.load(video("2"));

            expect(createIframe).toHaveBeenCalledTimes(1);
            expect(h.instances).toHaveLength(1);
            expect(player.iframe).toBe(iframe);
            expect(iframe.src).toBe("https://ok.ru/videoembed/2");
        });

        it("lève si ni createIframe ni iframe adoptée", () => {
            const player = new OkruPlayer();
            expect(() => player.load(video("1"))).toThrow(/createIframe is required/);
        });
    });

    describe("load : liste de vidéos", () => {
        it("charge la première vidéo et émet itemChange 0", () => {
            const {player, events} = setup();
            player.load(list(["a", "b", "c"]));
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/a");
            expect(events).toEqual([{type: "itemChange", index: 0}]);
        });

        it("respecte l'option index", () => {
            const {player, events} = setup();
            player.load(list(["a", "b", "c"]), {index: 2});
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/c");
            expect(events).toEqual([{type: "itemChange", index: 2}]);
        });

        it("applique le startSeconds de chaque vidéo (association par position)", () => {
            const {player} = setup();
            player.load(list(["a", "b"], {a: 10, b: 20}));
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/a?fromTime=10");
            player.next();
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/b?autoplay=1&fromTime=20");
        });

        it("fonctionne même si info.videos est vide (pas de startSeconds)", () => {
            const {player} = setup();
            const l = new VideoListInfo("okru", "player", ["a", "b"], 0, false); // aucun addVideo
            player.load(l);
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/a");
            player.next();
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/b?autoplay=1");
        });

        it("liste d'un seul id : pas d'itemChange", () => {
            const {player, events} = setup();
            player.load(list(["a"]));
            expect(events).toEqual([]);
        });

        it("liste vide : rien ne se passe", () => {
            const {player, createIframe} = setup();
            player.load(new VideoListInfo("okru", "player", [], 0, false));
            expect(createIframe).not.toHaveBeenCalled();
        });

        it("un nouveau load remplace complètement l'ancienne liste", () => {
            const {player} = setup();
            player.load(list(["a", "b", "c"]));
            player.load(video("solo"));
            player.next(); // plus rien après
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/solo");
        });
    });

    describe("navigation", () => {
        it("next / previous / playAt avancent avec autoplay=1 et émettent itemChange", () => {
            const {player, events} = setup();
            player.load(list(["a", "b", "c"]));
            events.length = 0;

            player.next();
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/b?autoplay=1");
            player.playAt(2);
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/c?autoplay=1");
            player.previous();
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/b?autoplay=1");

            expect(events).toEqual([
                {type: "itemChange", index: 1},
                {type: "itemChange", index: 2},
                {type: "itemChange", index: 1}
            ]);
        });

        it("next sur la dernière et previous sur la première sont sans effet", () => {
            const {player, events} = setup();
            player.load(list(["a", "b"]));
            events.length = 0;

            player.previous();
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/a");
            player.next();
            player.next();
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/b?autoplay=1");
            expect(events).toEqual([{type: "itemChange", index: 1}]);
        });

        it.each([[-1], [5], [undefined]])("playAt(%j) hors limites est sans effet", (i) => {
            const {player, events} = setup();
            player.load(list(["a", "b"]));
            events.length = 0;
            player.playAt(i);
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/a");
            expect(events).toEqual([]);
        });

        it("next/previous avant tout load : sans effet, sans erreur", () => {
            const {player, createIframe} = setup();
            expect(() => {
                player.next();
                player.previous();
                player.playAt(0);
            }).not.toThrow();
            expect(createIframe).not.toHaveBeenCalled();
        });
    });

    describe("play / pause", () => {
        it("envoient la commande au bridge", () => {
            const {player} = setup();
            player.load(video("1"));
            player.play();
            player.pause();
            expect(lastBridge().command.mock.calls).toEqual([["play"], ["pause"]]);
        });

        it("sans bridge : ne plantent pas", () => {
            const {player} = setup();
            expect(() => {
                player.play();
                player.pause();
            }).not.toThrow();
        });
    });

    describe("évènements du bridge", () => {
        it("play / pause -> state avec l'index courant", () => {
            const {player, events} = setup();
            player.load(list(["a", "b"]));
            player.next();
            events.length = 0;

            lastBridge().emit({type: h.Event.VideoPlay});
            lastBridge().emit({type: h.Event.VideoPause});
            expect(events).toEqual([
                {type: "state", state: "playing", index: 1},
                {type: "state", state: "paused", index: 1}
            ]);
        });

        it("ended sur une vidéo non finale : state ended puis passage à la suivante", () => {
            const {player, events} = setup();
            player.load(list(["a", "b"]));
            events.length = 0;

            lastBridge().emit({type: h.Event.VideoEnded});
            expect(events).toEqual([
                {type: "state", state: "ended", index: 0},
                {type: "itemChange", index: 1}
            ]);
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/b?autoplay=1");
        });

        it("ended sur la dernière vidéo : pas d'avance", () => {
            const {player, events} = setup();
            player.load(list(["a", "b"]), {index: 1});
            events.length = 0;

            lastBridge().emit({type: h.Event.VideoEnded});
            expect(events).toEqual([{type: "state", state: "ended", index: 1}]);
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/b");
        });

        it("ended sur une vidéo seule : juste state ended", () => {
            const {player, events} = setup();
            player.load(video("1"));
            lastBridge().emit({type: h.Event.VideoEnded});
            expect(events).toEqual([{type: "state", state: "ended", index: 0}]);
        });

        it("error -> évènement error avec le message du bridge", () => {
            const {player, events} = setup();
            player.load(video("1"));
            lastBridge().emit({type: h.Event.Error, message: "boom"});
            expect(events[0].type).toBe("error");
            expect(events[0].error).toBeInstanceOf(Error);
            expect(events[0].error.message).toBe("boom");
        });

        it("error sans message -> message par défaut", () => {
            const {player, events} = setup();
            player.load(video("1"));
            lastBridge().emit({type: h.Event.Error});
            expect(events[0].error.message).toBe("Ok.ru player error");
        });

        it("type inconnu : ignoré", () => {
            const {player, events} = setup();
            player.load(video("1"));
            lastBridge().emit({type: "whatever"});
            expect(events).toEqual([]);
        });
    });

    describe("subscribe", () => {
        it("plusieurs listeners reçoivent les évènements", () => {
            const {player} = setup();
            const other = vi.fn();
            player.subscribe(other);
            player.load(list(["a", "b"]));
            expect(other).toHaveBeenCalledWith({type: "itemChange", index: 0});
        });

        it("la fonction retournée désabonne", () => {
            const {player} = setup();
            const l = vi.fn();
            const unsubscribe = player.subscribe(l);
            unsubscribe();
            player.load(list(["a", "b"]));
            expect(l).not.toHaveBeenCalled();
        });

        it("se désabonner pendant l'émission ne casse pas l'itération", () => {
            const {player} = setup();
            const second = vi.fn();
            const unsubscribe = player.subscribe(() => unsubscribe());
            player.subscribe(second);
            player.load(list(["a", "b"]));
            expect(second).toHaveBeenCalledTimes(1);
        });
    });

    describe("iframe adoptée", () => {
        it("attache le bridge dès le constructeur, sans appeler createIframe", () => {
            const iframe = fakeIframe();
            const createIframe = vi.fn();
            const player = new OkruPlayer({createIframe, iframe});
            expect(player.iframe).toBe(iframe);
            expect(h.instances).toHaveLength(1);
            expect(lastBridge().connect).toHaveBeenCalled();

            player.load(video("123"));
            expect(iframe.src).toBe("https://ok.ru/videoembed/123");
            expect(createIframe).not.toHaveBeenCalled();
        });

        it("fonctionne sans createIframe", () => {
            const player = new OkruPlayer({iframe: fakeIframe()});
            expect(() => player.load(video("1"))).not.toThrow();
        });

        it("dispose ne retire pas une iframe adoptée du DOM", () => {
            const iframe = fakeIframe();
            const player = new OkruPlayer({iframe});
            player.dispose();
            expect(iframe.remove).not.toHaveBeenCalled();
            expect(lastBridge().disconnect).toHaveBeenCalled();
        });
    });

    describe("dispose", () => {
        it("déconnecte le bridge, retire l'iframe créée, vide l'état", () => {
            const {player} = setup();
            player.load(video("1"));
            const iframe = player.iframe;
            const bridge = lastBridge();

            player.dispose();
            expect(bridge.disconnect).toHaveBeenCalledTimes(1);
            expect(iframe.remove).toHaveBeenCalledTimes(1);
            expect(player.iframe).toBeNull();
        });

        it("vide les listeners", () => {
            const {player} = setup();
            const l = vi.fn();
            player.subscribe(l);
            player.dispose();
            player.load(list(["a", "b"]));
            expect(l).not.toHaveBeenCalled();
        });

        it("est sûr sans load préalable et si appelé deux fois", () => {
            const {player} = setup();
            expect(() => {
                player.dispose();
                player.dispose();
            }).not.toThrow();
        });

        it("play/pause après dispose ne plantent pas", () => {
            const {player} = setup();
            player.load(video("1"));
            player.dispose();
            expect(() => {
                player.play();
                player.pause();
            }).not.toThrow();
        });

        it("on peut recharger après dispose (nouvelle iframe, nouveau bridge)", () => {
            const {player, createIframe} = setup();
            player.load(video("1"));
            player.dispose();
            player.load(video("2"));
            expect(createIframe).toHaveBeenCalledTimes(2);
            expect(h.instances).toHaveLength(2);
            expect(player.iframe.src).toBe("https://ok.ru/videoembed/2");
        });
    });

    describe("mode relais et injection du builder", () => {
        it("embedBaseUrl -> src de type relais", () => {
            vi.stubGlobal("location", {origin: "https://site.test"});
            const {player} = setup({embedBaseUrl: "https://relay.test/okru.html"});
            player.load(video("123", 30), {autoplay: true});
            expect(player.iframe.src).toBe(
                "https://relay.test/okru.html?videoId=123&autoplay=1&startSeconds=30&parentOrigin=https%3A%2F%2Fsite.test"
            );
        });

        it("un urlBuilder injecté est utilisé tel quel (et prime sur embedBaseUrl)", () => {
            const urlBuilder = {build: vi.fn(() => "custom://src")};
            const {player} = setup({urlBuilder, embedBaseUrl: "https://ignored.test"});
            player.load(list(["a", "b"], {a: 5}), {autoplay: true});

            expect(urlBuilder.build).toHaveBeenCalledWith({videoId: "a", autoplay: true, startSeconds: 5});
            expect(player.iframe.src).toBe("custom://src");
        });

        it("l'erreur du builder est propagée", () => {
            const urlBuilder = {
                build: () => {
                    throw new TypeError("nope");
                }
            };
            const {player} = setup({urlBuilder});
            expect(() => player.load(video("1"))).toThrow("nope");
        });
    });
});