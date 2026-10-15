import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bundleWorker, WORKER_FILE } from "./build-sw-lib";

// Usage (from apps/web, before `next build`): bun scripts/build-sw.ts
// Writes public/sw.js. The `build` script runs it first. With SERMO_RETIRE_WORKER=1 it writes the
// worker that unregisters itself instead.

const root = resolve(".");
try {
  const script = await bundleWorker(
    root,
    process.env.SERMO_RETIRE_WORKER === "1",
  );
  writeFileSync(resolve(root, WORKER_FILE), script);
  console.log(`build-sw: ${WORKER_FILE} (${script.length} bytes)`);
} catch (error) {
  console.error(
    `build-sw: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
