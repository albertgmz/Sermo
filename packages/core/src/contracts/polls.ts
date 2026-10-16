import * as z from "zod";
import { POLL_KINDS, POLL_RESULTS } from "../db/schema";
import {
  MAX_POLL_ANSWERS,
  MAX_QUIZ_QUESTIONS,
  POLL_ANSWER_LENGTH,
  POLL_EXPLANATION_LENGTH,
  POLL_QUESTION_LENGTH,
} from "../limits";
import { defineContract } from "../operation";
import { Attachment } from "./attachments";
import { Id, Page, pageInput, Timestamp, UserSummary } from "./common";

export const PollKind = z.enum(POLL_KINDS);
export const PollResultsMode = z.enum(POLL_RESULTS);

const pollText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    // The cap that counts is on the text once its BB code is read (the writer's); a text whose words
    // fit but whose tags do not is not refused here.
    .max(Math.max(max * 5, 500))
    .describe(
      `One line of text, at most ${max} characters once its BB code is read: tags, pictures and ` +
        "links leave nothing but their words. The word filter and the new-member links rule apply.",
    );

const PollAnswerInput = z.object({
  id: Id.optional().describe("An answer the poll already has, to keep it. Omit for a new one."),
  text: pollText(POLL_ANSWER_LENGTH),
  imageFileId: Id.nullable()
    .default(null)
    .describe(
      "A picture of the answer: the id of a file the member uploaded (purpose attachment) and has " +
        "not attached anywhere yet, or the one the answer already has. Null for none.",
    ),
  correct: z.boolean().default(false).describe("Quiz only: the right answer. One per question."),
});

const PollQuestionInput = z.object({
  id: Id.optional().describe("A question the poll already has, to keep it. Omit for a new one."),
  text: pollText(POLL_QUESTION_LENGTH),
  imageFileId: Id.nullable().default(null).describe("A picture of the question, as for an answer."),
  explanation: z
    .string()
    .trim()
    .max(POLL_EXPLANATION_LENGTH)
    .default("")
    .describe("Quiz only: shown with the right answer once the member has answered."),
  answers: z.array(PollAnswerInput).min(2).max(MAX_POLL_ANSWERS),
});

/** What a poll or quiz is made of: the settings and the whole list of questions and answers. */
export const PollEdit = z.object({
  maxChoices: z
    .number()
    .int()
    .min(1)
    .max(MAX_POLL_ANSWERS)
    .default(1)
    .describe("Answers one vote may pick (1: single choice). A quiz picks one per question."),
  allowCustom: z
    .boolean()
    .default(false)
    .describe("Voters may add an answer of their own (one each, poll.addAnswer)."),
  allowChange: z.boolean().default(true).describe("A voter may change their vote."),
  results: PollResultsMode.default("always").describe(
    "When the results are shown: always, once the viewer has voted, or once the poll is closed. " +
      "A closed poll shows them to everyone; its creator and staff who manage polls always see them.",
  ),
  closesAt: Timestamp.nullable().default(null).describe("Close date; null for none."),
  questions: z
    .array(PollQuestionInput)
    .min(1)
    .max(MAX_QUIZ_QUESTIONS)
    .describe("A poll has exactly one question; a quiz has a series of them."),
});

export const PollInput = PollEdit.extend({
  kind: PollKind.default("poll"),
  anonymous: z
    .boolean()
    .default(false)
    .describe("Fixed at creation: an anonymous poll never reveals who voted, to anyone."),
});

const PollAnswerValue = z.object({
  id: Id,
  text: z.string(),
  image: Attachment.nullable(),
  /** Null while the viewer may not see results, and always for a quiz. */
  votes: z.number().int().nonnegative().nullable(),
  /** The viewer picked it. */
  chosen: z.boolean(),
  /** Quiz: whether it is the right answer; null until the viewer has answered the question. */
  correct: z.boolean().nullable(),
  /** A voter added it. */
  custom: z.boolean(),
});

const PollQuestionValue = z.object({
  id: Id,
  text: z.string(),
  image: Attachment.nullable(),
  /** Quiz: shown once the viewer has answered; null before, and for a poll. */
  explanation: z.string().nullable(),
  /** The viewer has answered it (a quiz question) or voted in it (a poll). */
  answered: z.boolean(),
  answers: z.array(PollAnswerValue),
});

export const Poll = z
  .object({
    id: Id,
    threadId: Id,
    kind: PollKind,
    anonymous: z.boolean(),
    maxChoices: z.number().int().positive(),
    allowCustom: z.boolean(),
    allowChange: z.boolean(),
    results: PollResultsMode,
    closesAt: Timestamp.nullable(),
    /** Closed by hand or past its close date. */
    closed: z.boolean(),
    /** The longest answer a voter may add, in characters. */
    answerMaxLength: z.number().int().positive(),
    /** The viewer sees the counts: `votes` and `voterCount` are null when this is false. */
    resultsShown: z.boolean(),
    /** Members who took part (the takers of a quiz); null while results are hidden. */
    voterCount: z.number().int().nonnegative().nullable(),
    questions: z.array(PollQuestionValue),
    /** The viewer's own part: for a quiz their progress and score, kept after the last answer. */
    mine: z.object({
      voted: z.boolean(),
      answered: z.number().int().nonnegative(),
      correct: z.number().int().nonnegative(),
      completed: z.boolean(),
    }),
    permissions: z.object({
      canVote: z.boolean(),
      canAddAnswer: z.boolean(),
      canEdit: z.boolean(),
      canDelete: z.boolean(),
      /** Close it, or reopen it when it is closed. */
      canClose: z.boolean(),
      /** Who voted is public and shown to the viewer. */
      canViewVoters: z.boolean(),
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "Poll" });

export const pollsGet = defineContract({
  name: "polls.get",
  summary:
    "The poll or quiz of a thread the viewer can read (`poll` is null when it has none), and " +
    "whether they may add one. Counts are left out (null) until the poll's results rule shows " +
    "them to the viewer; a quiz never carries a right answer or an explanation before the viewer " +
    "answers that question, and never counts. A thread whose posts are closed to the viewer " +
    "(forum.viewContent) holds no poll for them. Requires site.view.",
  kind: "read",
  input: z.object({ threadId: Id }),
  output: z.object({ poll: Poll.nullable(), canCreate: z.boolean() }),
});

export const pollsCreate = defineContract({
  name: "polls.create",
  summary:
    "Add a poll or a quiz to a thread that has none: the thread's author while it is unlocked " +
    "(poll.create), or staff who manage polls. A poll is one question with 2 to 20 answers " +
    "(`maxChoices` of them per vote); a quiz is 1 to 20 questions of 2 to 8 answers with exactly " +
    "one right answer each. `anonymous` and the kind cannot change later. A thread may also " +
    "carry it from the start (`poll` of threads.create).",
  kind: "write",
  input: z.object({ threadId: Id, poll: PollInput }),
  output: Poll,
});

export const pollsUpdate = defineContract({
  name: "polls.update",
  summary:
    "Replace a poll's settings, questions and answers (the whole definition; items that keep " +
    "their `id` keep their votes, items left out are removed with their votes). The creator " +
    "while the thread is unlocked, or staff who manage polls (their edits of someone else's " +
    "poll are logged). The creator may remove only answers nobody voted for; a quiz keeps its " +
    "questions, answers and right answers once a member has taken it (texts and explanations " +
    "may still change). The kind and `anonymous` never change.",
  kind: "write",
  input: z.object({
    pollId: Id,
    poll: PollEdit,
    loadedAt: Timestamp.optional().describe(
      "The `updatedAt` of the definition the edit started from (polls.definition). When given and " +
        "the poll has changed since (an answer a voter added, a close), the update is refused as a " +
        "conflict, so a stale editor cannot delete what it never saw.",
    ),
    reason: z.string().trim().max(1000).default(""),
  }),
  output: Poll,
});

export const pollsVote = defineContract({
  name: "polls.vote",
  summary:
    "Vote in a poll (1 to `maxChoices` answers; a later call replaces the vote when changes are " +
    "allowed), or answer one question of a quiz (one answer, final). The answer comes back in " +
    "the poll: for a quiz it now carries that question's right answer and explanation. Needs " +
    "poll.vote, a visible thread the viewer can read and an open poll.",
  kind: "write",
  input: z.object({
    pollId: Id,
    questionId: Id,
    answerIds: z.array(Id).min(1).max(MAX_POLL_ANSWERS),
  }),
  output: Poll,
});

export const pollsAddAnswer = defineContract({
  name: "polls.addAnswer",
  summary:
    "Add an answer of one's own to a poll that allows custom answers: one per member, the text " +
    "under the same rules as the creator's (length cap, BB code read for its text only, the word " +
    "filter; a text the filter holds for approval is refused). Needs poll.addAnswer, which a " +
    "posting restriction takes away, and the right to vote. Not for quizzes.",
  kind: "write",
  input: z.object({ pollId: Id, text: pollText(POLL_ANSWER_LENGTH) }),
  output: Poll,
});

export const pollsClose = defineContract({
  name: "polls.close",
  summary:
    "Close a poll or quiz by hand (`closed: true`), or reopen one (`closed: false`; a close date " +
    "already past is cleared). The creator with poll.closeOwn, or anyone with poll.closeAny " +
    "(logged when it is not the creator).",
  kind: "write",
  input: z.object({
    pollId: Id,
    closed: z.boolean(),
    reason: z.string().trim().max(1000).default(""),
  }),
  output: Poll,
});

export const pollsDelete = defineContract({
  name: "polls.delete",
  summary:
    "Delete a poll or quiz with its votes. Staff who manage polls any time (logged); the creator " +
    "only while nobody has voted and the thread is unlocked. The votes go in bounded batches: a " +
    "poll with more voters than one batch is taken out of sight at once and `completed` is false " +
    "until the call has been repeated enough times to remove the rest.",
  kind: "write",
  input: z.object({ pollId: Id, reason: z.string().trim().max(1000).default("") }),
  output: z.object({ ok: z.literal(true), completed: z.boolean() }),
});

export const pollsVoters = defineContract({
  name: "polls.voters",
  summary:
    "The members who picked an answer of a poll whose voters are public, by member id, " +
    "cursor-paged. Refused for an anonymous poll (nobody, staff included, ever sees voters) and " +
    "for a quiz; needs poll.viewVoters and the results to be shown to the viewer.",
  kind: "read",
  input: z.object({ pollId: Id, answerId: Id, ...pageInput }),
  output: Page(z.object({ user: UserSummary, votedAt: Timestamp })),
});

const DefinitionAnswer = z.object({
  id: Id,
  text: z.string(),
  image: Attachment.nullable(),
  /** Quiz: the right answer. */
  correct: z.boolean(),
  /** A voter added it. */
  custom: z.boolean(),
  /** Votes for it (an editor sees the counts whatever the results rule says). */
  votes: z.number().int().nonnegative(),
});

export const PollDefinition = z
  .object({
    id: Id,
    threadId: Id,
    kind: PollKind,
    anonymous: z.boolean(),
    maxChoices: z.number().int().positive(),
    allowCustom: z.boolean(),
    allowChange: z.boolean(),
    results: PollResultsMode,
    closesAt: Timestamp.nullable(),
    /** Members who took part; a quiz that has any keeps its questions and answers. */
    ballotCount: z.number().int().nonnegative(),
    /** When the poll's definition last changed: send it back as `loadedAt`. */
    updatedAt: Timestamp,
    questions: z.array(
      z.object({
        id: Id,
        text: z.string(),
        image: Attachment.nullable(),
        explanation: z.string(),
        answers: z.array(DefinitionAnswer),
      }),
    ),
  })
  .meta({ id: "PollDefinition" });

export const pollsDefinition = defineContract({
  name: "polls.definition",
  summary:
    "A poll or quiz as its editor sees it: every question and answer with its id, the right " +
    "answers and explanations of a quiz and the vote counts, ready to be changed and sent back to " +
    "polls.update. Only for someone who may edit the poll (its creator, or staff who manage " +
    "polls); polls.get never carries a quiz's right answers.",
  kind: "read",
  input: z.object({ pollId: Id }),
  output: PollDefinition,
});
