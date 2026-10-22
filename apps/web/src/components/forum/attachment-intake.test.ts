import { expect, test } from "bun:test";
import { createIntake, receiveOffers } from "./attachment-intake";
import { offerFiles } from "./composer-insert";

type Stored = { id: number; type?: string };

const file = (name: string, type = "") => new File(["x"], name, { type });

// A list whose uploads answer as `answers` says (by file name): the stored type, or a refusal.
function list(answers: Record<string, Stored | "refused">, delay = 0) {
  const log: string[] = [];
  let errors = 0;
  const intake = createIntake<Stored>({
    send: async (sent) => {
      log.push(`start ${sent.name}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      log.push(`end ${sent.name}`);
      const answer = answers[sent.name];
      return answer === "refused" || answer === undefined ? undefined : answer;
    },
    place: (stored) => log.push(`place ${stored.id}`),
    clearError: () => {
      errors += 1;
    },
  });
  return { intake, log, cleared: () => errors };
}

test("a picture that is stored goes into the text, by the type it was stored with", async () => {
  const { intake, log } = list({
    "shot.png": { id: 1, type: "image/png" },
    // Sent with no type: it is the stored type that says it is a picture.
    "pasted-1": { id: 2, type: "image/jpeg" },
  });
  await intake([file("shot.png", "image/png"), file("pasted-1")], true);
  expect(log.filter((line) => line.startsWith("place"))).toEqual([
    "place 1",
    "place 2",
  ]);
});

test("a file that is no picture is stored and not put in the text", async () => {
  const { intake, log } = list({
    "plan.pdf": { id: 3, type: "application/pdf" },
    "odd.bin": { id: 4 },
  });
  await intake([file("plan.pdf"), file("odd.bin")], true);
  expect(log.some((line) => line.startsWith("place"))).toBe(false);
});

test("the files of the attach button are stored and never put in the text", async () => {
  const { intake, log } = list({ "a.png": { id: 5, type: "image/png" } });
  await intake([file("a.png", "image/png")]);
  expect(log).toEqual(["start a.png", "end a.png"]);
});

test("files go up one after the other and into the text in the order given", async () => {
  const { intake, log } = list(
    {
      "a.png": { id: 1, type: "image/png" },
      "b.png": { id: 2, type: "image/png" },
      "c.png": { id: 3, type: "image/png" },
    },
    5,
  );
  await intake([file("a.png"), file("b.png"), file("c.png")], true);
  expect(log).toEqual([
    "start a.png",
    "end a.png",
    "place 1",
    "start b.png",
    "end b.png",
    "place 2",
    "start c.png",
    "end c.png",
    "place 3",
  ]);
});

test("a second batch waits for the first, and does not clear what the first was refused with", async () => {
  const { intake, log, cleared } = list(
    {
      "a.png": "refused",
      "b.png": { id: 2, type: "image/png" },
    },
    5,
  );
  const first = intake([file("a.png")], true);
  const second = intake([file("b.png")], true);
  expect(cleared()).toBe(1);
  await Promise.all([first, second]);
  expect(log).toEqual([
    "start a.png",
    "end a.png",
    "start b.png",
    "end b.png",
    "place 2",
  ]);
  // Once everything is done, the next batch starts afresh.
  await intake([file("b.png")], true);
  expect(cleared()).toBe(2);
});

test("a file that could not be stored puts nothing in the text and the files after it still go", async () => {
  const { intake, log } = list({
    "bad.png": "refused",
    "good.png": { id: 7, type: "image/png" },
  });
  await intake([file("bad.png"), file("good.png")], true);
  expect(log.filter((line) => line.startsWith("place"))).toEqual(["place 7"]);
});

test("files offered to a list that allows files are taken, as files that came into the text", () => {
  const form = new EventTarget() as unknown as HTMLFormElement;
  const taken: [number, boolean][] = [];
  receiveOffers(form, true, (files, inText) =>
    taken.push([files.length, inText]),
  );
  expect(offerFiles(form, [file("a.png"), file("b.png")])).toBe(true);
  expect(taken).toEqual([[2, true]]);
});

test("a list that does not allow files leaves the offer alone, and one that is gone does too", () => {
  const form = new EventTarget() as unknown as HTMLFormElement;
  const taken: number[] = [];
  receiveOffers(form, false, (files) => taken.push(files.length));
  expect(offerFiles(form, [file("a.png")])).toBe(false);
  const stop = receiveOffers(form, true, (files) => taken.push(files.length));
  stop();
  expect(offerFiles(form, [file("a.png")])).toBe(false);
  expect(taken).toEqual([]);
});

test("a picture the editor holds a place for ends that place, stored or refused, and is not put in again", async () => {
  const settled: [string, number | undefined][] = [];
  const placed: number[] = [];
  const held = new Map<File, string>();
  const intake = createIntake<Stored>({
    send: async (sent) =>
      sent.name === "refused.png" ? undefined : { id: 8, type: "image/png" },
    place: (stored) => placed.push(stored.id),
    settle: (sent, stored) => {
      const key = held.get(sent);
      if (key === undefined) return false;
      settled.push([key, stored?.id]);
      return true;
    },
    clearError: () => {},
  });
  const shown = file("shown.png", "image/png");
  const refused = file("refused.png", "image/png");
  held.set(shown, "k1");
  held.set(refused, "k2");
  await intake([shown, refused, file("other.png", "image/png")], true);
  expect(settled).toEqual([
    ["k1", 8],
    ["k2", undefined],
  ]);
  expect(placed).toEqual([8]);
});
