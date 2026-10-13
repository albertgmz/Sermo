import type { Ctx } from "../context";

/**
 * Records the SQL of every statement the context executes from now on. Install it right after
 * the context is made: a statement is traced from the moment it is prepared, and prepared
 * statements are cached for the context's life.
 *
 * It sees statements run through `get`, `all`, `run`, `values` and `iterate` on anything
 * prepared by `prepare` or `query`, and `run` / `exec` called on the database itself. It cannot
 * see what SQLite runs on its own (the BEGIN and COMMIT of a transaction, triggers, foreign-key
 * actions) or statements prepared before it was installed. `inTransaction` tells, for each
 * recorded statement, whether a transaction was open when it ran.
 */
export function traceStatements(ctx: Ctx): {
  sql: string[];
  inTransaction: boolean[];
  count(pattern?: RegExp): number;
} {
  const sql: string[] = [];
  const inTransaction: boolean[] = [];
  const record = (text: string) => {
    sql.push(text);
    inTransaction.push(ctx.sqlite.inTransaction);
  };
  const originalPrepare = ctx.sqlite.prepare.bind(ctx.sqlite);
  const originalQuery = ctx.sqlite.query.bind(ctx.sqlite);
  const originalRun = ctx.sqlite.run.bind(ctx.sqlite);
  const originalExec = ctx.sqlite.exec.bind(ctx.sqlite);
  const track = (text: string, statement: object) => {
    for (const method of ["get", "all", "run", "values", "iterate"] as const) {
      const original = Reflect.get(statement, method) as (...args: unknown[]) => unknown;
      Reflect.set(statement, method, (...args: unknown[]) => {
        record(text);
        return Reflect.apply(original, statement, args);
      });
    }
    return statement;
  };
  Reflect.set(ctx.sqlite, "prepare", (text: string) => track(text, originalPrepare(text)));
  Reflect.set(ctx.sqlite, "query", (text: string) => track(text, originalQuery(text)));
  Reflect.set(ctx.sqlite, "run", (text: string, ...args: unknown[]) => {
    record(text);
    return Reflect.apply(originalRun, ctx.sqlite, [text, ...args]);
  });
  Reflect.set(ctx.sqlite, "exec", (text: string, ...args: unknown[]) => {
    record(text);
    return Reflect.apply(originalExec, ctx.sqlite, [text, ...args]);
  });
  return {
    sql,
    inTransaction,
    count: (pattern) => (pattern ? sql.filter((text) => pattern.test(text)) : sql).length,
  };
}
