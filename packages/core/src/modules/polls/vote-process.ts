/**
 * Test support: one process that votes in a poll on a database file other processes hold too,
 * the way separate servers or workers would. Arguments: file, poll id, question id, the answer
 * ids (JSON), the member ids (JSON), rounds. Each round every member votes for the next answer
 * (a change of vote after the first round). Prints `ok <votes>` or fails with the error.
 */
import { closeContext, createContext } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor } from "../../permissions/test-contexts";

const [path, pollId, questionId, answers, members, rounds] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const answerIds = JSON.parse(answers) as number[];
const memberIds = JSON.parse(members) as number[];
const ctx = createContext({ path });
let votes = 0;
try {
  for (let round = 0; round < Number(rounds); round++)
    for (const [index, userId] of memberIds.entries()) {
      await execute(ctx, getOperation("polls.vote"), resolvedActor(ctx, userId), {
        pollId: Number(pollId),
        questionId: Number(questionId),
        answerIds: [answerIds[(round + index) % answerIds.length]!],
      });
      votes++;
    }
  console.log(`ok ${votes}`);
} finally {
  closeContext(ctx);
}
