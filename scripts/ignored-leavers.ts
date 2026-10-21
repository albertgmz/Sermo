import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { applyIgnoredLeavers, parsePairs, planIgnoredLeavers } from "./ignored-leavers-lib";

const { values } = parseArgs({
  options: {
    db: { type: "string" },
    pairs: { type: "string" },
    backup: { type: "string" },
    apply: { type: "boolean" },
    help: { type: "boolean" },
  },
});

if (values.help || !values.pairs) {
  console.log(
    [
      "Marks members who left a XenForo conversation ignoring future messages as left_ignored.",
      "",
      "  bun scripts/ignored-leavers.ts --pairs <file> [--db <sermo.db>] [--backup <file>] [--apply]",
      "",
      "<file> has one `conversation_id,user_id` per line: the rows of xf_conversation_recipient",
      "whose recipient_state is deleted_ignored. Without --apply nothing is written: it only",
      "counts what would change. With --apply it first copies the database to --backup",
      "(default: backups/ignored-leavers-<time>.db beside the database), then marks the rows",
      "in one transaction. --db defaults to SERMO_DB_PATH, else ./data/sermo.db.",
    ].join("\n"),
  );
  process.exit(values.help ? 0 : 1);
}

const dbPath = values.db ?? process.env.SERMO_DB_PATH ?? "./data/sermo.db";
const pairs = parsePairs(readFileSync(values.pairs, "utf8"));
const db = values.apply
  ? new Database(dbPath, { readwrite: true, strict: true })
  : new Database(dbPath, { readonly: true, strict: true });
db.run("PRAGMA busy_timeout = 30000");
try {
  if (values.apply) {
    const backup =
      values.backup ??
      join(
        dirname(dbPath),
        "backups",
        `ignored-leavers-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
      );
    mkdirSync(dirname(backup), { recursive: true });
    const result = applyIgnoredLeavers(db, pairs, backup);
    console.log(`Backup written to ${backup}`);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("Dry run: nothing was written. Pass --apply to write.");
    console.log(JSON.stringify(planIgnoredLeavers(db, pairs), null, 2));
  }
} finally {
  db.close();
}
