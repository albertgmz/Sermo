// Lighthouse CI configuration, read by `lhci` (see scripts/lighthouse.ts, which runs it).
//
// The addresses, the Cookie header and the Chrome to use change from run to run, so the runner
// writes them to a JSON file and names it in LIGHTHOUSE_RUN_FILE. Everything else is fixed here.
const { readFileSync } = require("node:fs");

const run = JSON.parse(readFileSync(process.env.LIGHTHOUSE_RUN_FILE, "utf8"));

// A category passes at 90, measured on the median of the runs of each address. Accessibility is
// not asserted.
const category = (minScore) => ["error", { minScore, aggregationMethod: "median" }];
// An agentic-browsing audit passes at 1 on every run, or does not apply.
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
// of these two is held at 50: any other SEO failure still shows.
const NOT_INDEXED = "/(conversations/|search)";

module.exports = {
  ci: {
    collect: {
      url: run.urls,
      numberOfRuns: run.runs,
      chromePath: run.chromePath,
      settings: {
        // Lighthouse's mobile emulation: a 412 x 823 phone screen at 1.75 pixel ratio, a phone
        // user agent, simulated slow 4G and a 4x slower processor. A fresh profile for every run.
        formFactor: "mobile",
        ...(run.cookie ? { extraHeaders: { Cookie: run.cookie } } : {}),
      },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: `^(?!.*${NOT_INDEXED}).*$`,
          assertions: { ...shared, "categories:seo": category(0.9) },
        },
        {
          matchingUrlPattern: `.*${NOT_INDEXED}.*`,
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
