// Converts the supplied house-fly OBJ (Tripo-generated, one fused mesh with vertex colours)
// into a compressed GLB for the browser: meshoptimizer simplification to ~20% of the
// triangles, quantised attributes and EXT_meshopt_compression.
// Usage: npm run build:fly [-- path/to/source.obj]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] ?? resolve(here, "../../assets/source/housefly_tripo.obj"));
const out = resolve(here, "../public/models/housefly.glb");
const RATIO = "0.2";

const bin = resolve(here, "../node_modules/gltfpack/cli.js");
execFileSync(process.execPath, [bin, "-i", src, "-o", out, "-si", RATIO, "-cc", "-v"], { stdio: "inherit" });

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const meta = {
  source_file: basename(src),
  source_sha256: sha(src),
  source_bytes: statSync(src).size,
  output_sha256: sha(out),
  output_bytes: statSync(out).size,
  tool: "gltfpack 1.3.0",
  options: `-si ${RATIO} -cc`,
  note: "Tripo AI-generated house-fly mesh (Musca-like), not Drosophila; used as a stylised illustration only.",
};
writeFileSync(resolve(here, "../public/models/housefly.json"), JSON.stringify(meta, null, 1) + "\n");
console.log(meta);
