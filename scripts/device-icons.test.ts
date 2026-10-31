import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attributionText, generatedModule, monochromeKeys, planIcons } from "./device-icons-lib";

const checkouts: string[] = [];
afterEach(() => {
  for (const dir of checkouts.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// A checkout of matomo-icons cut down to what the script reads: the source files with their
// `.source` notes, the converted PNGs of `dist` and its list of dark monochrome icons.
function checkout() {
  const root = mkdtempSync(join(tmpdir(), "matomo-icons-"));
  checkouts.push(root);
  const file = (path: string, text = "x") => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  file("src/os/UBT.png");
  file("src/os/UBT.png.source", "https://design.ubuntu.com/logo.png\n");
  file("src/os/HAI.ico");
  file("src/os/HAI.ico.source", "https://www.haiku-os.org/favicon.ico\n");
  file("src/os/HAI.todo", "favicon because there is no square logo\n");
  file("src/os/IOS.svg", "<svg/>");
  file("src/os/IOS.svg.source", "https://commons.wikimedia.org/wiki/File:IOS.svg\n");
  file("src/os/QNX.jpg");
  file("src/os/QNX.jpg.sources", "https://example.org/qnx.jpg\n");
  file("src/browsers/UNK.png");
  symlinkSync("../browsers/UNK.png", join(root, "src/os/UNK.png"));
  file("src/devices/tablet.svg", "<svg>tablet</svg>");
  symlinkSync("tablet.svg", join(root, "src/devices/phablet.svg"));
  file("src/devices/feature_phone.svg");
  symlinkSync("../browsers/UNK.png", join(root, "src/devices/unknown.png"));
  file("src/devices/LICENSE", "Apache License");
  file("src/devices/README.md", "## Device Icons");
  for (const name of ["os/UBT", "os/HAI", "os/IOS", "os/QNX", "os/UNK", "devices/unknown"])
    file(`dist/${name}.png`);
  file(
    "dist/dark-monochrome-icons.json",
    JSON.stringify(["brand/Apple.png", "devices/tablet.png", "os/IOS.png", "flags/xx.png"]),
  );
  return root;
}

describe("device-icons", () => {
  test("an SVG source is copied as SVG; any other source is the converted PNG of dist, to WebP", () => {
    const root = checkout();
    const plan = planIcons(root);
    const of = (group: string, code: string) =>
      plan.find((icon) => icon.group === group && icon.code === code);
    expect(of("os", "IOS")).toEqual({
      group: "os",
      code: "IOS",
      from: join(root, "src/os/IOS.svg"),
      file: "IOS.svg",
      convert: false,
      source: "https://commons.wikimedia.org/wiki/File:IOS.svg",
    });
    for (const code of ["UBT", "HAI", "QNX"])
      expect(of("os", code)).toMatchObject({
        from: join(root, `dist/os/${code}.png`),
        file: `${code}.webp`,
        convert: true,
      });
    expect(of("os", "QNX")?.source).toBe("https://example.org/qnx.jpg");
    expect(of("os", "UNK")).toMatchObject({ file: "UNK.webp", source: null });
    // A link is followed: the phablet is drawn as the tablet.
    expect(of("devices", "phablet")).toMatchObject({
      from: join(root, "src/devices/tablet.svg"),
      file: "phablet.svg",
    });
    expect(of("devices", "unknown")).toMatchObject({ file: "unknown.webp", convert: true });
    // Notes, licences and to-do files are no icons.
    expect(plan.map((icon) => `${icon.group}/${icon.code}`).sort()).toEqual([
      "devices/feature_phone",
      "devices/phablet",
      "devices/tablet",
      "devices/unknown",
      "os/HAI",
      "os/IOS",
      "os/QNX",
      "os/UBT",
      "os/UNK",
    ]);
  });

  test("two source files for one code stop the run", () => {
    const root = checkout();
    writeFileSync(join(root, "src/os/UBT.svg"), "<svg/>");
    expect(() => planIcons(root)).toThrow("os/UBT");
  });

  test("the dark monochrome icons are read from the list of dist, for the vendored groups only", () => {
    expect(monochromeKeys(checkout())).toEqual(["devices/tablet", "os/IOS"]);
  });

  test("the module imports each file and keys it by its code", () => {
    const root = checkout();
    const text = generatedModule(planIcons(root), ["devices/tablet", "os/IOS"], "abc123");
    expect(text).toContain("matomo-icons abc123");
    expect(text).toContain(
      'import devices_feature_phone from "../../assets/device-icons/devices/feature_phone.svg";',
    );
    expect(text).toContain('import os_UBT from "../../assets/device-icons/os/UBT.webp";');
    expect(text).toContain("  feature_phone: devices_feature_phone,\n");
    expect(text).toContain("  UBT: os_UBT,\n");
    expect(text).toContain('"devices/tablet",\n  "os/IOS",\n');
    // Sorted, so a second run writes the same text.
    expect(text.indexOf("os_HAI from")).toBeLessThan(text.indexOf("os_UBT from"));
  });

  test("the attribution lists every icon with the place it came from", () => {
    const text = attributionText(planIcons(checkout()), "abc123");
    expect(text).toContain("abc123");
    expect(text).toContain("| `os/UBT.webp` | https://design.ubuntu.com/logo.png |");
    expect(text).toContain("| `os/UNK.webp` | - |");
    expect(text).toContain("| `devices/phablet.svg` |");
  });
});
