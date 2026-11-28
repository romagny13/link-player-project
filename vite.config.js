import { defineConfig } from "vite";

// One build per mode, because the ES and UMD bundles do not share the same entry:
//   es  : src/index.js, named exports (the whole public API), for bundlers and <script type="module">
//   umd : src/umd.js, the global `LinkPlayer` is the class itself (`new LinkPlayer()`)
//   min : same as umd, minified
const TARGETS = {
    es: { entry: "src/index.js", format: "es", file: "link-player.es.js", minify: false },
    umd: { entry: "src/umd.js", format: "umd", file: "link-player.js", minify: false },
    min: { entry: "src/umd.js", format: "umd", file: "link-player.min.js", minify: true }
};

export default defineConfig(({ mode }) => {
    const target = TARGETS[mode] ?? TARGETS.es;

    return {
        test: { globals: true, environment: "jsdom", disableConsoleIntercept: true },
        build: {
            lib: { entry: target.entry, name: "LinkPlayer" },
            emptyOutDir: target === TARGETS.es,   // the first build cleans dist/, the others add to it
            minify: target.minify ? "terser" : false,
            sourcemap: true,
            rollupOptions: {
                output: [{
                    format: target.format,
                    ...(target.format === "umd" && { name: "LinkPlayer" }),
                    exports: "auto",
                    entryFileNames: target.file
                }]
            }
        }
    };
});