import { expect, test } from "bun:test";
import { knownSmilies, loadSmilies } from "./smilie-store";

const LAUGH = { id: 17, title: "Laugh", codes: [":LOL:"], emoji: "😆" };

test("the smilies are asked for once a page, and a failed ask is asked again", async () => {
  let asks = 0;
  const failing = () => {
    asks++;
    return Promise.reject(new Error("offline"));
  };
  expect(await loadSmilies(failing)).toEqual([]);
  const working = () => {
    asks++;
    return Promise.resolve([LAUGH]);
  };
  expect(await loadSmilies(working)).toEqual([LAUGH]);
  expect(await loadSmilies(working)).toEqual([LAUGH]);
  expect(asks).toBe(2);
  expect(knownSmilies()).toEqual([LAUGH]);
});
