import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attributionText,
  familyIconCodes,
  GROUPS,
  generatedModule,
  iconLooks,
  MATOMO_ICONS,
  monochromeKeys,
  type PictureStats,
  pictureStats,
  planIcons,
  webSvg,
} from "./device-icons-lib";

// Vendors the `os` and `devices` icons of matomo-icons into the web app, from a checkout of the
// pinned commit: `bun scripts/device-icons.ts <checkout>`. The steps are in
// `apps/web/assets/device-icons/README.md`.

/**
 * sharp and the device detector are dependencies of core, which is where they are resolved from;
 * the little of sharp's interface used here is typed locally.
 */
type Sharp = (
  input: string,
  options?: { density: number },
) => {
  webp(options: { lossless: boolean; effort: number }): { toFile(path: string): Promise<unknown> };
  resize(
    width: number,
    height: number,
    options: { fit: "contain"; background: string },
  ): { ensureAlpha(): { raw(): { toBuffer(): Promise<Buffer> } } };
};
const core = createRequire(
  fileURLToPath(new URL("../packages/core/package.json", import.meta.url)),
);
const sharp = core("sharp") as Sharp;
// The detector's own tables: the codes of each family of systems, and the name of each system.
const families = core("node-device-detector/parser/os/os_families.js") as Record<string, string[]>;
const systems = core("node-device-detector/parser/os/os_systems.js") as Record<string, string>;

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
const stats = new Map<string, PictureStats>();
for (const icon of plan) {
  const to = join(out, icon.group, icon.file);
  if (icon.convert) await sharp(icon.from).webp({ lossless: true, effort: 6 }).toFile(to);
  else writeFileSync(to, webSvg(readFileSync(icon.from, "utf8")));
  // Measured as drawn: 48 pixels square.
  const pixels = await sharp(to, { density: 300 })
    .resize(48, 48, { fit: "contain", background: "#0000" })
    .ensureAlpha()
    .raw()
    .toBuffer();
  stats.set(`${icon.group}/${icon.code}`, pictureStats(pixels));
}
copyFileSync(join(checkout, "gpl-3.0.txt"), join(out, "LICENSE-GPL-3.0.txt"));
copyFileSync(join(checkout, "src", "devices", "LICENSE"), join(out, "LICENSE-APACHE-2.0.txt"));
writeFileSync(join(out, "ATTRIBUTION.md"), attributionText(plan, MATOMO_ICONS.commit));
writeFileSync(
  join(web, "src", "lib", "device-icon-files.ts"),
  generatedModule(
    plan,
    {
      ...iconLooks(stats, monochromeKeys(checkout)),
      families: familyIconCodes(
        families,
        systems,
        new Set(plan.filter((icon) => icon.group === "os").map((icon) => icon.code)),
      ),
    },
    MATOMO_ICONS.commit,
  ),
);
console.log(`${plan.length} icons written to ${out}.`);
