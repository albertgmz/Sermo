import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attributionText,
  GROUPS,
  generatedModule,
  MATOMO_ICONS,
  monochromeKeys,
  planIcons,
} from "./device-icons-lib";

// Vendors the `os` and `devices` icons of matomo-icons into the web app, from a checkout of the
// pinned commit: `bun scripts/device-icons.ts <checkout>`. The steps are in
// `apps/web/assets/device-icons/README.md`.

/** sharp is a dependency of core, which is where it is resolved from. */
type Sharp = (input: string) => {
  webp(options: { lossless: boolean; effort: number }): { toFile(path: string): Promise<unknown> };
};
const sharp = createRequire(
  fileURLToPath(new URL("../packages/core/package.json", import.meta.url)),
)("sharp") as Sharp;

const checkout = process.argv[2];
if (!checkout) {
  console.error("Usage: bun scripts/device-icons.ts <checkout of matomo-icons>");
  process.exit(1);
}
const head = spawnSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" });
if (head.stdout.trim() !== MATOMO_ICONS.commit) {
  console.error(
    `${checkout} is not at the pinned commit ${MATOMO_ICONS.commit}. ` +
      "Check it out, or change the commit in scripts/device-icons-lib.ts.",
  );
  process.exit(1);
}

const web = fileURLToPath(new URL("../apps/web/", import.meta.url));
const out = join(web, "assets", "device-icons");
for (const group of GROUPS) {
  rmSync(join(out, group), { recursive: true, force: true });
  mkdirSync(join(out, group), { recursive: true });
}
const plan = planIcons(checkout);
for (const icon of plan) {
  const to = join(out, icon.group, icon.file);
  if (icon.convert) await sharp(icon.from).webp({ lossless: true, effort: 6 }).toFile(to);
  else copyFileSync(icon.from, to);
}
copyFileSync(join(checkout, "gpl-3.0.txt"), join(out, "LICENSE-GPL-3.0.txt"));
copyFileSync(join(checkout, "src", "devices", "LICENSE"), join(out, "LICENSE-APACHE-2.0.txt"));
writeFileSync(join(out, "ATTRIBUTION.md"), attributionText(plan, MATOMO_ICONS.commit));
writeFileSync(
  join(web, "src", "lib", "device-icon-files.ts"),
  generatedModule(plan, monochromeKeys(checkout), MATOMO_ICONS.commit),
);
console.log(`${plan.length} icons written to ${out}.`);
