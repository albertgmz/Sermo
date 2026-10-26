import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { analyticsSnippets } from "./analytics-snippets";

test("provider none adds nothing", () => {
  expect(analyticsSnippets({ provider: "none" })).toEqual([]);
});

test("google loads gtag.js and configures the measurement id", () => {
  const [loader, config] = analyticsSnippets({
    provider: "google",
    measurementId: "G-ABC123",
  });
  expect(loader?.src).toBe(
    "https://www.googletagmanager.com/gtag/js?id=G-ABC123",
  );
  expect(config?.code).toContain(`gtag('config',"G-ABC123");`);
});

test("with a tag path the tag loads from the site's own address at the gateway's path", () => {
  const [loader, config] = analyticsSnippets({
    provider: "google",
    measurementId: "G-ABC123",
    tagPath: "/metrics",
  });
  expect(loader?.src).toBe("/metrics/");
  expect(config?.code).toContain(`gtag('config',"G-ABC123");`);
});

test("values reach the script as escaped literals", () => {
  const [, google] = analyticsSnippets({
    provider: "google",
    measurementId: `G-1");alert(1);("</script>`,
  });
  expect(google?.code).not.toContain("</script");
  expect(google?.code).toContain(String.raw`G-1\");alert(1);(\"`);
});

test("the public layout renders the tag and nothing in the staff panel does", () => {
  const app = join(import.meta.dir, "../../app/[locale]");
  expect(readFileSync(join(app, "(main)/layout.tsx"), "utf8")).toContain(
    "<AnalyticsTag />",
  );
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  for (const file of files(join(app, "(staff)")).filter((f) =>
    /\.tsx?$/.test(f),
  ))
    expect(readFileSync(file, "utf8"), file).not.toMatch(/analytics-tag/);
});
