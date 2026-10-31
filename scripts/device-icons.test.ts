import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attributionText,
  familyIconCodes,
  generatedModule,
  iconLooks,
  monochromeKeys,
  pictureStats,
  planIcons,
  webSvg,
} from "./device-icons-lib";

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
    const text = generatedModule(
      planIcons(root),
      {
        masks: ["devices/tablet", "os/IOS"],
        halos: ["os/HAI"],
        families: [
          ["Android", "AND"],
          ["GNU/Linux", "LIN"],
        ],
      },
      "abc123",
    );
    expect(text).toContain("matomo-icons abc123");
    expect(text).toContain(
      'import devices_feature_phone from "../../assets/device-icons/devices/feature_phone.svg";',
    );
    expect(text).toContain('import os_UBT from "../../assets/device-icons/os/UBT.webp";');
    expect(text).toContain("  feature_phone: devices_feature_phone,\n");
    expect(text).toContain("  UBT: os_UBT,\n");
    expect(text).toContain(
      'MONOCHROME_ICONS: ReadonlySet<string> = new Set([\n  "devices/tablet",\n  "os/IOS",\n]);',
    );
    expect(text).toContain('DARK_ICONS: ReadonlySet<string> = new Set([\n  "os/HAI",\n]);');
    // A family that is no plain name is quoted, as the formatter writes it.
    expect(text).toContain('  Android: "AND",\n  "GNU/Linux": "LIN",\n');
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

  test("an SVG is hidden from assistive technology and loses an empty title and old Illustrator styles", () => {
    expect(webSvg('<svg\n  viewBox="0 0 1 1"><title></title><path/></svg>')).toBe(
      '<svg aria-hidden="true"\n  viewBox="0 0 1 1"><path/></svg>',
    );
    expect(webSvg('<svg style="enable-background:new 0 0 5 5;" x="0"><title/></svg>')).toBe(
      '<svg aria-hidden="true" x="0"></svg>',
    );
    expect(
      webSvg('<svg style="fill:red;enable-background:new 0 0 5 5"><title>Tux</title></svg>'),
    ).toBe('<svg aria-hidden="true" style="fill:red;"><title>Tux</title></svg>');
    // Inkscape's own properties go; a named font gets a generic one after it.
    expect(
      webSvg(
        "<svg><g style=\"font-family:'SF Pro';-inkscape-font-specification:'SF Pro Bold';fill:#000\"/></svg>",
      ),
    ).toBe(
      '<svg aria-hidden="true"><g style="font-family:\'SF Pro\',sans-serif;fill:#000"/></svg>',
    );
    expect(webSvg('<svg><g style="font-family:serif"/></svg>')).toContain('font-family:serif"');
    // Run twice, the same text.
    const once = webSvg('<svg aria-hidden="true" x="0"/>');
    expect(webSvg(once)).toBe(once);
  });

  test("a picture's coverage and brightness come from its pixels", () => {
    // One white opaque pixel and one transparent one.
    const white = pictureStats(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 0]));
    expect(white.alpha).toBe(0.5);
    expect(white.luminance).toBeCloseTo(1, 6);
    expect(pictureStats(new Uint8Array([0, 0, 0, 0]))).toEqual({ alpha: 0, luminance: 0 });
  });

  test("a listed dark glyph is a mask; a listed picture that fills its square, and other dark pictures, get a light edge", () => {
    const stats = new Map([
      ["devices/tablet", { alpha: 0.33, luminance: 0 }],
      // HarmonyOS: an opaque black square around a cut-out glyph.
      ["os/HAR", { alpha: 0.9, luminance: 0.13 }],
      ["os/DEB", { alpha: 0.16, luminance: 0.16 }],
      ["os/UBT", { alpha: 0.78, luminance: 0.51 }],
      ["os/UNK", { alpha: 0, luminance: 0 }],
    ]);
    expect(iconLooks(stats, ["devices/tablet", "os/HAR"])).toEqual({
      masks: ["devices/tablet"],
      halos: ["os/DEB", "os/HAR"],
    });
  });

  test("a family takes the icon of the system the detector names it after, where there is a file", () => {
    const families = {
      Android: ["AND", "LEN", "AGO"],
      "GNU/Linux": ["LIN", "UBT", "ALP"],
      Unix: ["BSD", "GHO"],
      "Chrome OS": ["COS", "CRS"],
    };
    const systems = { AND: "Android", LIN: "GNU/Linux", BSD: "FreeBSD", COS: "Chrome OS" };
    expect(familyIconCodes(families, systems, new Set(["AND", "LIN", "BSD"]))).toEqual([
      ["Android", "AND"],
      ["GNU/Linux", "LIN"],
    ]);
  });
});
