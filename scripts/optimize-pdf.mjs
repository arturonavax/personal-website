// Lossless PDF optimization for the downloadable CVs (text stays vector/selectable).
//   node scripts/optimize-pdf.mjs [input.pdf ...]   default: .cv/ArturoNava-CV-*.pdf
// Writes to public/downloads/<same name>. Uses qpdf: object streams, maximum Flate recompression,
// unreferenced resource removal and linearization (fast web view). No rasterization, no
// font substitution. An output larger than the input is discarded in favour of a plain copy.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
const outDir = path.join(process.cwd(), "public/downloads");

async function inputs() {
  const given = process.argv.slice(2);
  if (given.length) return given;
  const dir = path.join(process.cwd(), ".cv");
  return (await readdir(dir))
    .filter((f) => /^ArturoNava-CV-.*\.pdf$/.test(f))
    .map((f) => path.join(dir, f));
}

async function main() {
  try {
    await run("qpdf", ["--version"]);
  } catch {
    throw new Error(
      "qpdf not found. Install it (e.g. `sudo apt install qpdf` / `brew install qpdf`).",
    );
  }
  await mkdir(outDir, { recursive: true });
  for (const input of await inputs()) {
    const out = path.join(outDir, path.basename(input));
    await run("qpdf", [
      "--object-streams=generate",
      "--compress-streams=y",
      "--recompress-flate",
      "--compression-level=9",
      "--linearize",
      input,
      out,
    ]);
    const [a, b] = [(await stat(input)).size, (await stat(out)).size];
    if (b >= a) await copyFile(input, out);
    const final = Math.min(a, b);
    console.log(
      `[pdf] ${path.basename(input)}: ${(a / 1024).toFixed(1)} KB -> ${(final / 1024).toFixed(1)} KB (-${(((a - final) / a) * 100).toFixed(1)}%)`,
    );
  }
}

main().catch((err) => {
  console.error("[pdf] Error:", err.message ?? err);
  process.exit(1);
});
