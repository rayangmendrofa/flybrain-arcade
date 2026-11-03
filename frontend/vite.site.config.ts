// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
/// <reference types="vitest/config" />
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Static showcase page (gelastinta.com). Self-contained: reads precomputed files from site/public/data,
// needs no backend, and uses relative URLs so it can be served from any sub-path.
const MEDIA_DIR = resolve(__dirname, "site/public/media");

/** Dev-only endpoint used by the video studio (site/#studio) to save rendered files. */
function saveMedia(): Plugin {
  return {
    name: "flybrain-save-media",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__save-media", (req, res) => {
        const name = new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "";
        if (req.method !== "POST" || !/^[\w.-]+\.(mp4|webm|jpg|png)$/.test(name)) {
          res.statusCode = 400;
          res.end("bad request");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          mkdirSync(MEDIA_DIR, { recursive: true });
          writeFileSync(resolve(MEDIA_DIR, name), Buffer.concat(chunks));
          res.end("ok");
        });
      });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, "site"),
  base: "./",
  plugins: [react(), saveMedia()],
  server: { port: 5175, fs: { allow: [resolve(__dirname)] } },
  build: { outDir: resolve(__dirname, "dist-site"), emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
