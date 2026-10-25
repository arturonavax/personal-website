// Optional local staging only; never initiates a remote read or publication.
import { stageObsidianContent } from "./lib/obsidian-content.mjs";

stageObsidianContent()
  .then((result) => {
    if (!result) {
      console.log("[obsidian] No vault configured; skipping.");
    } else {
      console.log(
        `[obsidian] Staged ${result.changed} changed file(s), ${result.unchanged} unchanged, ${result.unpublished} unpublished${result.retired ? `, ${result.retired} retired` : ""}; no remote operations.`,
      );
    }
  })
  .catch((error) => {
    console.error(`[obsidian] Error: ${error.message}`);
    process.exitCode = 1;
  });
