// Lighthouse CI configuration, read by `lhci` (see scripts/lighthouse.ts, which runs it).
//
// The addresses and the Chrome to use change from run to run, so the runner writes them to a JSON
// file and names it in LIGHTHOUSE_RUN_FILE. Cookies (the consent choice, a signed-in session) are
// not in that file: they come in LIGHTHOUSE_COOKIES, only when a run needs them. Everything else is
// fixed here.
const { readFileSync } = require("node:fs");
const { join, relative } = require("node:path");

const run = JSON.parse(readFileSync(process.env.LIGHTHOUSE_RUN_FILE, "utf8"));

// A category passes at 90, measured on the median of the runs of each address. Accessibility is
// not asserted.
const category = (minScore) => ["error", { minScore, aggregationMethod: "median" }];
// An agentic-browsing audit passes at 1 on every run, or does not apply. (The audit ids are also
// in scripts/lighthouse-lib.ts, AGENTIC_AUDITS, for the summary.)
const agentic = ["error", { minScore: 1, aggregationMethod: "pessimistic" }];
const shared = {
  "categories:performance": category(0.9),
  "categories:best-practices": category(0.9),
  "agent-accessibility-tree": agentic,
  "llms-txt": agentic,
  "ard-schema": agentic,
  "webmcp-registered-tools": agentic,
  "webmcp-form-coverage": agentic,
  "webmcp-schema-validity": agentic,
};

// Search results and conversations stay out of search engines on purpose (`noindex`). Lighthouse's
// `is-crawlable` audit counts that as a failure worth 40 points of the SEO score, so the SEO score
// of these two is held at 50: any other SEO failure still shows. Matched against the final address.
const NOT_INDEXED = "https?://[^/]+/(conversations|search)(?:[/?#]|$)";

// lhci joins this path to its working folder, which is inside .lighthouseci.
const cookieScript = relative(process.cwd(), join(__dirname, "scripts", "lighthouse-cookies.cjs"));

module.exports = {
  ci: {
    collect: {
      url: run.urls,
      numberOfRuns: run.runs,
      chromePath: run.chromePath,
      settings: {
        // Lighthouse's mobile emulation: a 412 x 823 phone screen at 1.75 pixel ratio, a phone
        // user agent, simulated slow 4G and a 4x slower processor. One Chrome, started by the
        // puppeteer script below, serves the runs of a group: no stored data is kept between them
        // except the cookies the pages set themselves.
        formFactor: "mobile",
      },
      // Always the same launcher, so "before" and "after" differ only in the cookies. The script puts
      // them (if any) into the browser's own jar, where the page's scripts (the banner) read them.
      puppeteerScript: cookieScript,
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: `^(?!${NOT_INDEXED}).*$`,
          assertions: { ...shared, "categories:seo": category(0.9) },
        },
        {
          matchingUrlPattern: `^${NOT_INDEXED}.*$`,
          assertions: { ...shared, "categories:seo": category(0.5) },
        },
      ],
    },
    upload: {
      target: "filesystem",
      outputDir: run.outputDir,
    },
  },
};
