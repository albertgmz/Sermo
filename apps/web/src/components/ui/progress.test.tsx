import { expect, test } from "bun:test";

// The server and the browser each have a locale of their own; the text spoken must not depend on
// either (the HTML of the server and the first render of the browser must match). Drawn in a
// process of its own, because other suites replace the library's hooks for the whole run.
const script = `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { Progress } from "./src/components/ui/progress";
const drawn = (locale) =>
  renderToStaticMarkup(
    createElement(IntlProvider, { locale, messages: {}, timeZone: "UTC" },
      createElement(Progress, { value: 77, "aria-label": "Level" })),
  );
console.log(JSON.stringify({ es: drawn("es"), en: drawn("en") }));
`;

test("the value is spoken in the language of the page, not the runtime's", () => {
  const run = Bun.spawnSync(["bun", "-e", script], {
    cwd: new URL("../../..", import.meta.url).pathname,
    env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
  });
  expect(run.stderr.toString()).toBe("");
  const { es, en } = JSON.parse(run.stdout.toString());
  expect(es).toContain('aria-valuetext="77 %"');
  expect(en).toContain('aria-valuetext="77%"');
});
