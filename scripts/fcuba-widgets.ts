import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { formatPlan, parseSnapshot, planFromXenforo, reconcile } from "./fcuba-widgets-lib";
import { credentialsFrom } from "./grant-manual-awards-lib";

// Places Sermo's widgets like fcuba's XenForo and leaves the archive forums out of the feed.
//
//   bun scripts/fcuba-widgets.ts                       dry run: prints the plan and what would change
//   bun scripts/fcuba-widgets.ts --apply               does it, through the API
//   bun scripts/fcuba-widgets.ts --dump <file>         (on the machine with the XenForo copy) writes
//                                                      the snapshot of its widgets and nodes
//
// The credential is an administrator's API key in SERMO_API_KEY (or SERMO_SESSION_COOKIE); without
// one the dry run only prints the plan. Running it again changes nothing. --url is the API's site
// (default http://localhost:3000, as seen from the backend container), --snapshot the file made by
// --dump (default scripts/fcuba-widgets-snapshot.json). --dump reads XenForo's database with
// SELECT only, through the container XENFORO_DB_CONTAINER (default fcuba-xenforo-db-1), as the
// user XENFORO_DB_USER (default xenforo) with the password in XENFORO_DB_PASSWORD.

const { values } = parseArgs({
  options: {
    apply: { type: "boolean" },
    url: { type: "string" },
    snapshot: { type: "string" },
    dump: { type: "string" },
  },
});

const SNAPSHOT_QUERY = `SELECT JSON_OBJECT(
  'widgets', (SELECT JSON_ARRAYAGG(JSON_OBJECT('widgetId', widget_id, 'widgetKey', CAST(widget_key AS CHAR),
    'definitionId', CAST(definition_id AS CHAR), 'positions', CAST(positions AS CHAR),
    'options', CAST(options AS CHAR), 'displayCondition', display_condition)) FROM xf_widget),
  'templates', (SELECT JSON_ARRAYAGG(JSON_OBJECT('title', title, 'templateHex', HEX(template)))
    FROM xf_template WHERE style_id = 0 AND title LIKE '\\\\_widget\\\\_%'),
  'nodes', (SELECT JSON_ARRAYAGG(JSON_OBJECT('nodeId', node_id, 'parentNodeId', parent_node_id)) FROM xf_node)
)`;

async function dump(file: string): Promise<void> {
  const env = process.env;
  if (!env.XENFORO_DB_PASSWORD) throw new Error("Set XENFORO_DB_PASSWORD.");
  const process_ = Bun.spawn(
    [
      "docker",
      "exec",
      "-e",
      "MYSQL_PWD",
      env.XENFORO_DB_CONTAINER ?? "fcuba-xenforo-db-1",
      "mariadb",
      "--default-character-set=utf8mb4",
      "-N",
      "-B",
      "--raw",
      "-u",
      env.XENFORO_DB_USER ?? "xenforo",
      "xenforo",
      "-e",
      SNAPSHOT_QUERY,
    ],
    { env: { ...env, MYSQL_PWD: env.XENFORO_DB_PASSWORD }, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err] = await Promise.all([
    new Response(process_.stdout).text(),
    new Response(process_.stderr).text(),
  ]);
  if ((await process_.exited) !== 0) throw new Error(`The dump failed: ${err.trim()}`);
  // The template text travels as hex: JSON built in the server comes back in the wrong character set.
  const raw = JSON.parse(out) as {
    widgets: { positions: string; options: string }[];
    templates: { title: string; templateHex: string }[];
  };
  // Only the templates of placed widgets: the snapshot holds what the plan reads.
  const used = new Set(
    raw.widgets
      .filter((w) => w.positions !== "[]")
      .map((w) => (JSON.parse(w.options || "[]") as { template_title?: string }).template_title),
  );
  const snapshot = parseSnapshot(
    JSON.stringify({
      ...raw,
      templates: raw.templates
        .filter((t) => used.has(t.title))
        .map((t) => ({
          title: t.title,
          template: Buffer.from(t.templateHex, "hex").toString("utf8"),
        })),
    }),
  );
  writeFileSync(file, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(
    `${snapshot.widgets.length} widgets, ${snapshot.templates.length} templates, ${snapshot.nodes.length} nodes written to ${file}`,
  );
}

try {
  if (values.dump) {
    await dump(values.dump);
    process.exit(0);
  }
  const plan = planFromXenforo(
    parseSnapshot(
      readFileSync(values.snapshot ?? join(import.meta.dir, "fcuba-widgets-snapshot.json"), "utf8"),
    ),
  );
  console.log(formatPlan(plan));
  const dryRun = !values.apply;
  const hasCredential = Boolean(process.env.SERMO_API_KEY || process.env.SERMO_SESSION_COOKIE);
  if (!hasCredential && !dryRun) credentialsFrom(process.env);
  console.log(`\n${dryRun ? "Dry run (nothing written; pass --apply to write)" : "Applying"}:`);
  const report = await reconcile(
    { url: values.url ?? "http://localhost:3000", dryRun },
    hasCredential ? credentialsFrom(process.env) : null,
    plan,
    {
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => Bun.sleep(ms),
      log: (line) => console.log(`  ${line}`),
    },
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
