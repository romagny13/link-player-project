import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const min = mode === "min";

  return {
    test: { globals: true, environment: "jsdom", disableConsoleIntercept: true },
    build: {
      lib: { entry: "src/umd.js", name: "LinkPlayer" },
      emptyOutDir: !min,
      minify: min ? "terser" : false,
      sourcemap: true,
      rollupOptions: {
        output: min
            ? [{
              format: "umd",
              name: "LinkPlayer",
              exports: "auto",
              entryFileNames: "link-player.min.js"
            }]
            : [
              { format: "es", entryFileNames: "link-player.es.js" },
              { format: "umd", name: "LinkPlayer", exports: "auto", entryFileNames: "link-player.js" }
            ]
      }
    }
  };
});