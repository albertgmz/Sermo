/**
 * Test support: several contexts on one database file, the way separate processes hold it. Each
 * context has its own connection, prepared statements and in-memory permission state.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../actor";
import { type Ctx, closeContext, createContext } from "../context";
import { memberActor, PRINCIPAL_COLUMNS, type PrincipalRow } from "./check";
import { currentVersions } from "./state";

/** Copies `fixture` (an in-memory test context) to a temporary file that `open` connects to. */
export function sharedDatabase(fixture: Ctx): { open(): Ctx; close(): void } {
  const directory = mkdtempSync(join(tmpdir(), "sermo-permissions-"));
  const path = join(directory, "sermo.db");
  writeFileSync(path, fixture.sqlite.serialize());
  const opened: Ctx[] = [];
  return {
    open() {
      const ctx = createContext({ path, now: fixture.now, config: fixture.config });
      opened.push(ctx);
      return ctx;
    },
    close() {
      for (const ctx of opened) closeContext(ctx);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** The actor a request resolves for a member: its principal and cache versions read now. */
export function resolvedActor(ctx: Ctx, userId: number): Actor {
  const row = ctx.sqlite
    .prepare<PrincipalRow & { id: number; group_id: number }, [number]>(
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    )
    .get(userId)!;
  return memberActor(row.id, row.group_id, row, currentVersions(ctx));
}
