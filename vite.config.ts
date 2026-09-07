import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // three.js in its own chunk: it is the bulk of the download and never changes between deploys,
    // so it caches independently and fetches in parallel with the app
    rollupOptions: { output: { manualChunks: { three: ["three"] } } },
    chunkSizeWarningLimit: 900,
  },
});
