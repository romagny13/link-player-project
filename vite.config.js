import { defineConfig } from "vite";

export default defineConfig({
  test: { globals: true, environment: "jsdom" },
  build: {
    lib: {
      entry: "src/umd.js",
      name: "LinkPlayer",
      formats: ["es"],
      fileName: () => "link-player.es.js"
    },
    rollupOptions: {
      output: [
        {
          format: "umd",
          entryFileNames: "link-player.js",
          name: "LinkPlayer",
          exports: "auto",
          minifyInternalExports: false
        },
        {
          format: "umd",
          entryFileNames: "link-player.min.js",
          name: "LinkPlayer",
          exports: "auto"
        }
      ]
    },
    minify: "esbuild",
    sourcemap: true
  }
});
