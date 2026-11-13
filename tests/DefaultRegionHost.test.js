import {DefaultRegionHost} from "../src/DefaultRegionHost.js";

describe("DefaultRegionHost", () => {
    let host;
    let root;
    let onLinkDiscovered;
    let onTargetDiscovered;
    let onFrameDiscovered;

    beforeEach(() => {
        root = document.createElement("div");
        document.body.appendChild(root);

        onLinkDiscovered = vi.fn();
        onTargetDiscovered = vi.fn();
        onFrameDiscovered = vi.fn();

        host = new DefaultRegionHost();
        host.init({
            root,
            onLinkDiscovered,
            onTargetDiscovered,
            onFrameDiscovered
        });
    });

    afterEach(() => {
        document.body.innerHTML = "";
        host.clear();
    });

    // ───────── Liens ─────────

    it("découvre les nouveaux liens [data-link]", () => {
        const a = document.createElement("a");
        a.dataset.link = "";
        a.href = "https://youtube.com/watch?v=abc";
        root.appendChild(a);

        const div = document.createElement("div");
        div.dataset.link = "";
        div.dataset.url = "https://youtube.com/watch?v=def";
        root.appendChild(div);

        host.discoverLinks();

        expect(host.links).toHaveLength(2);
        expect(onLinkDiscovered).toHaveBeenCalledWith([a, div]);
    });

    it("n'appelle le callback que pour les nouveaux liens", () => {
        const a = document.createElement("a");
        a.dataset.link = "";
        a.href = "https://youtube.com/watch?v=abc";
        root.appendChild(a);

        host.discoverLinks();
        host.discoverLinks(); // 2e appel

        expect(onLinkDiscovered).toHaveBeenCalledTimes(1);
    });

    it("oublie les liens déconnectés du DOM", () => {
        const a = document.createElement("a");
        a.dataset.link = "";
        a.href = "https://youtube.com/watch?v=abc";
        root.appendChild(a);

        host.discoverLinks();
        expect(host.links).toHaveLength(1);

        a.remove();
        host.discoverLinks();
        expect(host.links).toHaveLength(0);
    });

    it("ignore les éléments [data-link] sans href / data-url", () => {
        const div = document.createElement("div");
        div.dataset.link = "";
        root.appendChild(div);

        host.discoverLinks();
        expect(host.links).toHaveLength(0);
        expect(onLinkDiscovered).not.toHaveBeenCalled();
    });

    // ───────── Targets ─────────

    it("découvre les targets via defaultTarget et data-target des liens", () => {
        host.setDefaultTarget("player");

        const container = document.createElement("div");
        container.id = "player";
        root.appendChild(container);

        const a = document.createElement("a");
        a.dataset.link = "";
        a.href = "https://youtube.com/watch?v=abc";
        a.dataset.target = "player";
        root.appendChild(a);

        host.discoverLinks();
        host.discoverTargets();

        expect([...host.targets]).toEqual([["player", container]]);
        expect(onTargetDiscovered).toHaveBeenCalled();
    });

    it("ne redécouvre pas un target encore connecté", () => {
        host.setDefaultTarget("player");

        const container = document.createElement("div");
        container.id = "player";
        root.appendChild(container);

        host.discoverTargets();
        host.discoverTargets();

        expect(onTargetDiscovered).toHaveBeenCalledTimes(1);
    });

    it("redécouvre un target s'il a été déconnecté puis reconnecté", () => {
        host.setDefaultTarget("player");

        const container = document.createElement("div");
        container.id = "player";
        root.appendChild(container);

        host.discoverTargets();
        expect(onTargetDiscovered).toHaveBeenCalledTimes(1);

        container.remove();
        host.discoverTargets(); // oublié car déconnecté

        root.appendChild(container);
        host.discoverTargets();
        expect(onTargetDiscovered).toHaveBeenCalledTimes(2);
    });

    // ───────── Frames ─────────

    it("découvre les nouvelles iframes", () => {
        const iframe = document.createElement("iframe");
        root.appendChild(iframe);

        host.discoverFrames();

        expect(host.frames).toContain(iframe);
        expect(onFrameDiscovered).toHaveBeenCalledWith([iframe]);
    });

    it("oublie les iframes déconnectées", () => {
        const iframe = document.createElement("iframe");
        root.appendChild(iframe);

        host.discoverFrames();
        iframe.remove();
        host.discoverFrames();

        expect(host.frames).toHaveLength(0);
    });

    // ───────── Divers ─────────

    it("discoverAll appelle les trois découvertes", () => {
        const spyLinks = vi.spyOn(host, "discoverLinks");
        const spyTargets = vi.spyOn(host, "discoverTargets");
        const spyFrames = vi.spyOn(host, "discoverFrames");

        host.discoverAll();

        expect(spyLinks).toHaveBeenCalled();
        expect(spyTargets).toHaveBeenCalled();
        expect(spyFrames).toHaveBeenCalled();
    });

    it("clear remet tout à zéro", () => {
        host.setDefaultTarget("player");

        const a = document.createElement("a");
        a.dataset.link = "";
        a.href = "https://example.com";
        root.appendChild(a);

        host.discoverAll();
        host.clear();

        expect(host.links).toHaveLength(0);
        expect(host.targets).toHaveLength(0);
        expect(host.frames).toHaveLength(0);
        expect(host.defaultTarget).toBeNull();
    });
});