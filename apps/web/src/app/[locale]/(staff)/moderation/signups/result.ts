// What a decision on sign-ups leaves in the address it redirects to: the counts, and the members
// that were skipped or refused with the backend's reason for each. The page reads them back with
// `readResult`, which accepts nothing but this shape (the address is anyone's to type).

// The parameters a decision leaves in the address.
export const RESULT_KEYS = ["decided", "done", "skipped", "failed", "lines"];

export type Params = Record<string, string | string[] | undefined>;

export type Line = {
  status: "skipped" | "failed";
  name: string;
  message: string;
};

export type Result = {
  decision: "approve" | "reject";
  done: number;
  skipped: number;
  failed: number;
  lines: Line[];
};

// The most lines carried in an address, and the longest text of one: the counts say the rest.
const MAX_LINES = 10;
const MAX_NAME = 64;
const MAX_MESSAGE = 200;
// The longest query carried in an address: lines are dropped, last first, until it fits.
const MAX_QUERY = 3000;

type Outcome = {
  name: string;
  status: "done" | "skipped" | "failed";
  message: string | null;
};

export function resultQuery(
  decision: Result["decision"],
  answer: {
    items: readonly Outcome[];
    done: number;
    skipped: number;
    failed: number;
  },
): string {
  const all = answer.items
    .filter((item) => item.status !== "done")
    .slice(0, MAX_LINES)
    .map((item) => [
      item.status,
      item.name.slice(0, MAX_NAME),
      (item.message ?? "").slice(0, MAX_MESSAGE),
    ]);
  const query = new URLSearchParams({
    decided: decision,
    done: String(answer.done),
    skipped: String(answer.skipped),
    failed: String(answer.failed),
  });
  for (let kept = all.length; kept > 0; kept--) {
    query.set("lines", JSON.stringify(all.slice(0, kept)));
    if (query.toString().length <= MAX_QUERY) break;
    query.delete("lines");
  }
  return query.toString();
}

const count = (value: unknown) => {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && /^\d{1,4}$/.test(text)
    ? Number(text)
    : null;
};

function linesOf(value: unknown): Line[] {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_LINES).flatMap((entry): Line[] => {
      if (!Array.isArray(entry)) return [];
      const [status, name, message] = entry;
      if (
        (status !== "skipped" && status !== "failed") ||
        typeof name !== "string" ||
        typeof message !== "string"
      )
        return [];
      return [
        {
          status,
          name: name.slice(0, MAX_NAME),
          message: message.slice(0, MAX_MESSAGE),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function readResult(params: Params): Result | null {
  const decision = Array.isArray(params.decided)
    ? params.decided[0]
    : params.decided;
  if (decision !== "approve" && decision !== "reject") return null;
  const done = count(params.done);
  const skipped = count(params.skipped);
  const failed = count(params.failed);
  if (done === null || skipped === null || failed === null) return null;
  return { decision, done, skipped, failed, lines: linesOf(params.lines) };
}
