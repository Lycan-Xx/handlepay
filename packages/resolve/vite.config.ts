// Library build: one ES module, with the protocol libraries left as dependencies.
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: "es2022",
    lib: { entry: "src/index.ts", formats: ["es"], fileName: () => "index.js" },
    rollupOptions: {
      external: [/^@bitauth\/libauth/, /^nostr-tools/, /^cashscript/],
    },
  },
});
