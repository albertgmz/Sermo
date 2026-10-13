import { afterEach, describe, expect, test } from "bun:test";
import { RateLimitedError } from "../../errors";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";

afterEach(closeAll);

const WRONG = "wrong-wrong-1";
const WINDOW = 15 * 60_000;

async function world() {
  const w = await accounts();
  const owner = await w.register("Owner", 4);
  /** The owner as seen through one particular session. */
  const session = (sessionId: number) => ({ ...owner.actor, sessionId });
  const verify = (sessionId: number, password: string) =>
    w.run("auth.verifyPassword", session(sessionId), { password });
  return { ...w, owner, verify };
}

describe("wrong passwords are limited per session and per member", () => {
  test("one session used up does not lock another session of the same member", async () => {
    const w = await world();
    for (let i = 0; i < 5; i++) await expect(w.verify(1, WRONG)).rejects.toThrow(/not your/);
    await expect(w.verify(1, WRONG)).rejects.toBeInstanceOf(RateLimitedError);
    // The right answer is refused for the locked session, and works for the other one.
    await expect(w.verify(1, PASSWORD)).rejects.toBeInstanceOf(RateLimitedError);
    expect(await w.verify(2, PASSWORD)).toEqual({ ok: true });
    // The unlocked session keeps its own five.
    for (let i = 0; i < 5; i++) await expect(w.verify(2, WRONG)).rejects.toThrow(/not your/);
    await expect(w.verify(2, PASSWORD)).rejects.toBeInstanceOf(RateLimitedError);
  });

  test("twenty wrong answers across sessions lock the member out", async () => {
    const w = await world();
    for (const sessionId of [1, 2, 3, 4])
      for (let i = 0; i < 5; i++)
        await expect(w.verify(sessionId, WRONG)).rejects.toThrow(/not your/);
    // A fifth session has not given a wrong answer, but the member's twenty are gone.
    await expect(w.verify(5, PASSWORD)).rejects.toBeInstanceOf(RateLimitedError);
    // Another member is not affected, and the window moving on frees the owner.
    const other = await w.register("Other", 4);
    expect(await w.run("auth.verifyPassword", other.actor, { password: PASSWORD })).toEqual({
      ok: true,
    });
    w.ctx.clock.advance(WINDOW + 1000);
    expect(await w.verify(5, PASSWORD)).toEqual({ ok: true });
  });

  test("nineteen wrong answers across sessions still leave the right one working", async () => {
    const w = await world();
    for (const [sessionId, wrongs] of [
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 4],
    ] as const)
      for (let i = 0; i < wrongs; i++)
        await expect(w.verify(sessionId, WRONG)).rejects.toThrow(/not your/);
    expect(await w.verify(5, PASSWORD)).toEqual({ ok: true });
  });
});
