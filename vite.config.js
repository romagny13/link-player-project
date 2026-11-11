import { defineConfig } from "vite";
import terser from "@rollup/plugin-terser";

export default defineConfig({
  test: { globals: true, environment: "jsdom", disableConsoleIntercept: true },
  build: {
    lib: { entry: "src/umd.js", name: "LinkPlayer" },
    minify: false, // nothing is minified unless an output asks for it
    sourcemap: true,
    rollupOptions: {
      output: [
        {
          format: "es",
          entryFileNames: "link-player.es.js"
        },
        {
          format: "umd",
          name: "LinkPlayer",
          exports: "auto",
          entryFileNames: "link-player.js" // readable
        },
        {
          format: "umd",
          name: "LinkPlayer",
          exports: "auto",
          entryFileNames: "link-player.min.js",
          plugins: [terser()] // minified, only this one
        }
      ]
    }
  }
});
