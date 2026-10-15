import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ValidationError } from "../errors";
import { nodesCreateOp, threadsCreateOp } from "../modules/forums";
import { execute } from "../operation";
import { renderBbCode, renderContent } from "../render";
import { ADVERSARIAL_INPUTS } from "./adversarial-inputs";
import { Deadline, TOO_COMPLEX } from "./deadline";

const RUNS = 10;
/** Well under the 50 ms the renderer allows itself (ten runs, so this bounds the slowest of them). */
const P95_LIMIT_MS = 30;

async function world() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const author = userActor(insertUser(ctx, { username: "abcdefghi" }));
  insertUser(ctx, { username: "target5" });
  const forum = await execute(ctx, nodesCreateOp, admin, {
    parentId: null,
    type: "forum",
    title: "Forum",
  });
  const thread = await execute(ctx, threadsCreateOp, author, {
    nodeId: forum.id,
    title: "Topic",
    body: "Original",
  });
  return { ctx, reader: userActor(insertUser(ctx)), postId: thread.post.id };
}

function percentile95(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

describe("adversarial inputs", () => {
  test("every input finishes in time, with HTML or a refusal that is not the time bound", async () => {
    const { ctx, reader, postId } = await world();
    expect(ADVERSARIAL_INPUTS.length).toBeGreaterThan(300);
    const slow: string[] = [];
    const tripped: string[] = [];
    for (const input of ADVERSARIAL_INPUTS) {
      expect(input.source.length, input.name).toBeLessThanOrEqual(10_000);
      const source = input.source.replaceAll("post: 1,", `post: ${postId},`);
      // The time bound is not what holds these back: it is lifted for the measurement.
      const run = () =>
        input.withActor
          ? renderContent(ctx, reader, source, { limitMs: 60_000 })
          : renderBbCode(source, { limitMs: 60_000 });
      const measure = () => {
        const times: number[] = [];
        for (let i = 0; i < RUNS + 2; i++) {
          const started = performance.now();
          try {
            run();
          } catch (error) {
            expect(error, input.name).toBeInstanceOf(ValidationError);
            expect((error as ValidationError).message, input.name).not.toBe(TOO_COMPLEX);
          }
          if (i >= 2) times.push(performance.now() - started);
        }
        return percentile95(times);
      };
      // One more try before judging: another process on the machine can stall a whole round.
      const p95 = measure();
      if (p95 > P95_LIMIT_MS && measure() > P95_LIMIT_MS) slow.push(`${input.name}: ${p95}`);
      // And the real bound does not trip on any of them either.
      try {
        if (input.withActor) renderContent(ctx, reader, source);
        else renderBbCode(source);
      } catch (error) {
        if ((error as ValidationError).message === TOO_COMPLEX) tripped.push(input.name);
      }
    }
    expect(slow).toEqual([]);
    expect(tripped).toEqual([]);
  }, 180_000);

  test("unclosed and misnested tags stay text, in linear time", () => {
    expect(renderBbCode("[B]".repeat(3000))).toBe(`<p>${"[B]".repeat(3000)}</p>`);
    expect(renderBbCode("[/B]".repeat(2000))).toBe(`<p>${"[/B]".repeat(2000)}</p>`);
    expect(renderBbCode("[".repeat(10_000))).toBe(`<p>${"[".repeat(10_000)}</p>`);
    expect(renderBbCode("[B][I]x[/B][/I]")).toBe("<p><strong>[I]x</strong>[/I]</p>");
    expect(renderBbCode("[CODE]".repeat(1600))).toContain("[CODE]");
    // Four times the text, about four times the time (a quadratic stage would take sixteen).
    const cost = (n: number) => {
      const source = "[B][I]x[/B][/I]".repeat(n);
      renderBbCode(source);
      let best = Number.POSITIVE_INFINITY;
      for (let batch = 0; batch < 4; batch++) {
        const started = performance.now();
        for (let i = 0; i < 10; i++) renderBbCode(source);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    expect(cost(660)).toBeLessThan(cost(165) * 8);
  });

  test("a message that cannot be output safely is refused, not rendered", () => {
    const nested = `${"[QUOTE]".repeat(11)}x${"[/QUOTE]".repeat(11)}`;
    expect(() => renderBbCode(nested)).toThrow(ValidationError);
    expect(() => renderBbCode(`${"[B]".repeat(31)}x${"[/B]".repeat(31)}`)).toThrow(ValidationError);
  });
});

describe("the time bound", () => {
  const busy = "[B]x[/B] ".repeat(1000);

  test("work past the limit is refused as too complex", () => {
    let now = 0;
    const clock = () => (now += 1);
    let error: unknown;
    try {
      renderBbCode(busy, { clock });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toBe(TOO_COMPLEX);
    expect((error as ValidationError).issues).toEqual([{ path: ["body"], message: TOO_COMPLEX }]);
  });

  test("a clock that stands still never trips it", () => {
    expect(renderBbCode(busy, { clock: () => 5 })).toContain("<strong>x</strong>");
  });

  test("the limit is the render limit unless the caller sets one", () => {
    let now = 0;
    const clock = () => (now += 0.01);
    expect(renderBbCode("[B]x[/B]", { clock })).toBe("<p><strong>x</strong></p>");
    now = 0;
    expect(() => renderBbCode(busy, { clock, limitMs: 0.5 })).toThrow(ValidationError);
  });

  test("the checks before and after the sanitizer catch a slow tail", () => {
    // "hi" is too short for the per-step checks: only the explicit ones read the clock.
    for (const slowFrom of [4, 5]) {
      let reads = 0;
      const clock = () => (++reads >= slowFrom ? reads * 1_000 : 0);
      expect(() => renderBbCode("hi", { clock }), `read ${slowFrom}`).toThrow(ValidationError);
    }
  });

  test("time spent while paused is not counted", () => {
    let now = 0;
    const deadline = new Deadline(50, () => now);
    deadline.resume();
    now = 10;
    deadline.pause();
    now = 5_000;
    deadline.resume();
    now = 5_040;
    deadline.check();
    now = 5_041;
    expect(() => deadline.check()).toThrow(ValidationError);
  });

  test("an actor render keeps its lookups out of the bound", async () => {
    const { ctx, reader } = await world();
    let now = 0;
    // Every database statement run takes a second on this clock.
    const prepare = ctx.sqlite.prepare.bind(ctx.sqlite);
    // biome-ignore lint/suspicious/noExplicitAny: a test double for the statement API
    (ctx.sqlite as any).prepare = (sql: string) =>
      // biome-ignore lint/suspicious/noExplicitAny: a test double for the statement API
      new Proxy(prepare(sql) as any, {
        get(target, key) {
          const value = target[key];
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (key === "all" || key === "get" || key === "run") now += 1_000;
            return value.apply(target, args);
          };
        },
      });
    ctx.statements.clear();
    const rendered = renderContent(ctx, reader, "[B]x[/B] @abcdefghi", { clock: () => now });
    expect(rendered.mentionedUserIds).toHaveLength(1);
    expect(now).toBeGreaterThanOrEqual(1_000);
  });

  test("a slow first try is rendered once more, a second one refuses", () => {
    // Slow for the first five reads (the first try), still afterwards.
    let reads = 0;
    const slowOnce = () => 60 * Math.min(++reads, 5);
    expect(renderBbCode("[B]x[/B]", { clock: slowOnce })).toBe("<p><strong>x</strong></p>");
    expect(reads).toBeGreaterThan(5);
    let now = 0;
    const alwaysSlow = () => (now += 60);
    expect(() => renderBbCode("[B]x[/B]", { clock: alwaysSlow })).toThrow(ValidationError);
    // Other refusals are not tried again.
    let renders = 0;
    const counting = () => {
      renders++;
      return 0;
    };
    expect(() =>
      renderBbCode(`${"[B]".repeat(31)}x${"[/B]".repeat(31)}`, { clock: counting }),
    ).toThrow(ValidationError);
    expect(renders).toBeLessThan(10);
  });

  test("the renderer is warmed up when a context is created, once per process", async () => {
    const probe = (when: "before" | "after") =>
      Bun.spawnSync(["bun", `${import.meta.dir}/warm-probe.ts`, when])
        .stdout.toString()
        .trim();
    expect(probe("before")).toBe("cold");
    expect(probe("after")).toBe("warm");
  });
});
