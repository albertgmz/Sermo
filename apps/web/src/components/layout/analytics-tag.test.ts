import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { analyticsSnippets, pageViewReporter } from "./analytics-snippets";

test("provider none adds nothing", () => {
  expect(analyticsSnippets({ provider: "none" })).toEqual([]);
});

test("matomo loads its tracker from the site's own address with the site id", () => {
  const [config, loader] = analyticsSnippets({
    provider: "matomo",
    url: "https://stats.example.com",
    siteId: 7,
  });
  expect(config?.code).toContain(
    `_paq.push(['setTrackerUrl',"https://stats.example.com/matomo.php"]);`,
  );
  expect(config?.code).toContain("_paq.push(['setSiteId',7]);");
  expect(config?.code).toContain("_paq.push(['trackPageView']);");
  expect(loader?.src).toBe("https://stats.example.com/matomo.js");
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

test("values reach the script as escaped literals", () => {
  const hostile = `https://x.example/"</script><script>alert(1)//`;
  const [config] = analyticsSnippets({
    provider: "matomo",
    url: hostile,
    siteId: 1,
  });
  expect(config?.code).not.toContain("</script");
  expect(config?.code).toContain(String.raw`\u003c/script>`);
  expect(config?.code).toContain(String.raw`\"`);
  const [, google] = analyticsSnippets({
    provider: "google",
    measurementId: `G-1");alert(1);("</script>`,
  });
  expect(google?.code).not.toContain("</script");
  expect(google?.code).toContain(String.raw`G-1\");alert(1);(\"`);
});

test("only navigations after the first page view are reported to matomo", () => {
  const paq: unknown[][] = [];
  const report = pageViewReporter(paq);
  report("https://f.example/", "Home");
  expect(paq).toEqual([]);
  report("https://f.example/forums/1?x=2", "A forum");
  expect(paq).toEqual([
    ["setCustomUrl", "https://f.example/forums/1?x=2"],
    ["setDocumentTitle", "A forum"],
    ["trackPageView"],
  ]);
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
