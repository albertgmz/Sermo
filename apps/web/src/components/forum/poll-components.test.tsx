import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { blankDraft, type PollView } from "@/lib/sermo/polls";
import { withIntl } from "@/lib/test-intl";

// The blocks hand on server actions.
mock.module("server-only", () => ({}));

const { PollBlock } = await import("./poll-block");
const { PollForm } = await import("./poll-form");
const { PollField } = await import("./poll-field");
const { PollAdder } = await import("./poll-adder");
const { PollVoters } = await import("./poll-voters");
const { QuizPlayer } = await import("./quiz-player");

const source = (name: string) =>
  readFileSync(join(import.meta.dir, name), "utf8");

const PERMISSIONS = {
  canVote: false,
  canAddAnswer: false,
  canEdit: false,
  canDelete: false,
  canClose: false,
  canViewVoters: false,
};
const NOT_VOTED = { voted: false, answered: 0, correct: 0, completed: false };

function poll(over: Partial<PollView> = {}): PollView {
  return {
    id: 5,
    threadId: 9,
    kind: "poll",
    anonymous: false,
    maxChoices: 1,
    allowCustom: false,
    allowChange: true,
    results: "always",
    closesAt: null,
    closed: false,
    resultsShown: true,
    voterCount: 4,
    questions: [
      {
        id: 1,
        text: "Best colour?",
        image: null,
        explanation: null,
        answered: false,
        answers: [
          {
            id: 11,
            text: "Red",
            image: null,
            votes: 3,
            chosen: false,
            correct: null,
            custom: false,
          },
          {
            id: 12,
            text: "Blue",
            image: null,
            votes: 1,
            chosen: true,
            correct: null,
            custom: true,
          },
        ],
      },
    ],
    mine: { voted: true, answered: 1, correct: 0, completed: true },
    permissions: { ...PERMISSIONS },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const quiz = (answered: number[], over: Partial<PollView> = {}) =>
  poll({
    kind: "quiz",
    voterCount: 2,
    questions: [1, 2].map((id, index) => {
      const done = answered.includes(index);
      return {
        id,
        text: `Question ${id}`,
        image: null,
        explanation: done ? "Because." : null,
        answered: done,
        answers: [
          {
            id: id * 10,
            text: "Yes",
            image: null,
            votes: null,
            chosen: done,
            correct: done ? true : null,
            custom: false,
          },
          {
            id: id * 10 + 1,
            text: "No",
            image: null,
            votes: null,
            chosen: false,
            correct: done ? false : null,
            custom: false,
          },
        ],
      };
    }),
    mine: {
      voted: answered.length > 0,
      answered: answered.length,
      correct: answered.length,
      completed: answered.length === 2,
    },
    permissions: { ...PERMISSIONS, canVote: true },
    ...over,
  });

const draw = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));
const player = (value: PollView, signedIn = true) =>
  draw(
    <QuizPlayer
      poll={value}
      threadId={9}
      pictures={{}}
      signedIn={signedIn}
      onPoll={() => {}}
    />,
  );
const block = (value: PollView, signedIn = true) =>
  draw(
    <PollBlock
      poll={value}
      threadId={9}
      pictures={{}}
      signedIn={signedIn}
      attachIn={null}
    />,
  );

test("a poll shows its question, the answers with their shares and the voters count", () => {
  const html = block(poll());
  expect(html).toContain("Best colour?");
  expect(html).toContain("75% (3)");
  expect(html).toContain("25% (1)");
  expect(html).toContain("4 voters");
  expect(html).toContain("Added by a voter");
  // The results are kept out of snippets.
  expect(html).toContain("data-nosnippet");
});

test("a result the backend did not send is never drawn as zero", () => {
  const question = poll().questions[0];
  if (!question) throw new Error("fixture");
  const html = block(
    poll({
      resultsShown: false,
      voterCount: null,
      results: "after_vote",
      mine: NOT_VOTED,
      questions: [
        {
          ...question,
          answers: question.answers.map((a) => ({
            ...a,
            votes: null,
            chosen: false,
          })),
        },
      ],
    }),
  );
  expect(html).not.toContain("0%");
  expect(html).not.toContain("voters");
  expect(html).toContain("The results are shown once you have voted.");
});

test("a member who may vote gets the choices and the button; a guest a way to sign in", () => {
  const voting = block(
    poll({
      permissions: { ...PERMISSIONS, canVote: true },
      mine: NOT_VOTED,
    }),
  );
  expect(voting).toContain('type="radio"');
  expect(voting).toContain(">Vote<");
  const multiple = block(
    poll({ maxChoices: 2, permissions: { ...PERMISSIONS, canVote: true } }),
  );
  expect(multiple).toContain('type="checkbox"');
  expect(multiple).toContain("Pick up to 2.");
  expect(multiple).toContain("Change vote");
  const guest = block(poll({ mine: NOT_VOTED }), false);
  expect(guest).toContain("/login?next=%2Fthreads%2F9");
  expect(guest).not.toContain('type="radio"');
  const refused = block(poll({ mine: NOT_VOTED }));
  expect(refused).toContain("You cannot vote in this poll.");
});

test("a closed poll says so, offers no vote and keeps its results", () => {
  const html = block(
    poll({ closed: true, permissions: { ...PERMISSIONS, canClose: true } }),
  );
  expect(html).toContain("Closed");
  expect(html).not.toContain(">Vote<");
  expect(html).toContain("Reopen");
});

test("editing, closing, deleting and voters are offered to whoever the backend says may", () => {
  const plain = block(poll());
  for (const word of ["Edit", "Close", "Delete poll", "Show who voted"])
    expect(plain).not.toContain(word);
  const staff = block(
    poll({
      permissions: {
        ...PERMISSIONS,
        canEdit: true,
        canClose: true,
        canDelete: true,
        canViewVoters: true,
      },
    }),
  );
  for (const word of ["Edit", "Close", "Delete poll", "Show who voted"])
    expect(staff).toContain(word);
  expect(staff.match(/Show who voted/g)).toHaveLength(2);
  // No voters button on an answer nobody picked.
  const question = poll().questions[0];
  if (!question) throw new Error("fixture");
  const nobody = block(
    poll({
      permissions: { ...PERMISSIONS, canViewVoters: true },
      questions: [
        {
          ...question,
          answers: question.answers.map((a) => ({ ...a, votes: 0 })),
        },
      ],
    }),
  );
  expect(nobody).not.toContain("Show who voted");
});

test("an anonymous poll says it is, and a poll with a close date says when", () => {
  const html = block(
    poll({ anonymous: true, closesAt: "2030-05-06T07:08:00.000Z" }),
  );
  expect(html).toContain("Anonymous: nobody can see who voted");
  expect(html).toContain("Closes May 6, 2030");
  expect(
    block(
      poll({
        allowCustom: true,
        permissions: { ...PERMISSIONS, canVote: true, canAddAnswer: true },
      }),
    ),
  ).toContain("Add your own answer");
});

test("a quiz starts at the first question not answered and never shows a right answer before", () => {
  const fresh = player(quiz([]));
  expect(fresh).toContain("Question 1 of 2");
  expect(fresh).not.toContain("Right answer");
  expect(fresh).not.toContain("Because.");
  expect(fresh).toContain(">Answer<");
  const resumed = player(quiz([0]));
  expect(resumed).toContain("Question 2 of 2");
  expect(resumed).not.toContain("Because.");
});

test("a finished quiz shows the score and the review, a closed unstarted one only its size", () => {
  const done = player(quiz([0, 1]));
  expect(done).toContain("You scored 2 of 2.");
  expect(done).toContain("Because.");
  const closed = player(
    quiz([], { closed: true, permissions: { ...PERMISSIONS, canVote: false } }),
  );
  expect(closed).toContain("A quiz of 2 questions.");
  expect(closed).toContain("This quiz is closed.");
  expect(closed).not.toContain('type="radio"');
  const guest = player(
    quiz([], { permissions: { ...PERMISSIONS, canVote: false } }),
    false,
  );
  expect(guest).toContain("to take the quiz.");
});

test("a quiz in the block waits for its player, which is asked for when it is drawn", () => {
  const html = block(quiz([]));
  expect(html).toContain('aria-label="Quiz"');
  expect(html).toContain("2 members took this quiz");
  expect(html).not.toContain("Right answer");
  expect(source("poll-block.tsx")).toContain(
    'import("@/components/forum/quiz-player")',
  );
});

test("the form for a new poll: a kind to choose, a question, answers, the settings", () => {
  const html = draw(
    <PollForm draft={blankDraft()} onChange={() => {}} attachIn={4} />,
  );
  expect(html).toContain("What to add");
  expect(html).toContain('aria-label="Question"');
  expect(html).toContain('aria-label="Answer 3"');
  expect(html).toContain("Anonymous poll");
  expect(html).toContain("Voters may add an answer");
  expect(html).toContain("Add a picture");
  // No picture is drawn in a form, only the file name.
  expect(html).not.toContain("<img");
  const noFiles = draw(
    <PollForm draft={blankDraft()} onChange={() => {}} attachIn={null} />,
  );
  expect(noFiles).not.toContain("Add a picture");
});

test("the form of a quiz asks for the right answer and an explanation; an existing one fixes its kind", () => {
  const draft = { ...blankDraft(), kind: "quiz" as const };
  const html = draw(
    <PollForm draft={draft} onChange={() => {}} attachIn={null} />,
  );
  expect(html).toContain("is the right one");
  expect(html).toContain("Explanation");
  expect(html).toContain("Add a question");
  expect(html).not.toContain("Voters may add an answer");
  const existing = draw(
    <PollForm
      draft={draft}
      onChange={() => {}}
      attachIn={null}
      existing
      locked
    />,
  );
  expect(existing).not.toContain("What to add");
  expect(existing).not.toContain("Anonymous poll");
  expect(existing).toContain("can no longer change");
  expect(existing).toContain("disabled");
});

test("the composer section is a button until it is opened; the voters list one too", () => {
  const field = draw(<PollField attachIn={null} />);
  expect(field).toContain("Add a poll or quiz");
  expect(field).not.toContain('name="poll"');
  expect(draw(<PollAdder threadId={3} attachIn={null} />)).toContain(
    "Add a poll or quiz",
  );
  expect(draw(<PollVoters threadId={3} pollId={5} answerId={11} />)).toContain(
    "Show who voted",
  );
});

test("no picture is emitted by the poll components: they take the ones the server drew", () => {
  for (const name of [
    "poll-block.tsx",
    "poll-form.tsx",
    "quiz-player.tsx",
    "poll-voters.tsx",
    "poll-editor.tsx",
    "poll-field.tsx",
    "poll-adder.tsx",
    "poll-lazy.tsx",
  ])
    expect(source(name)).not.toMatch(/<img\b|backgroundImage|next\/image/);
});

test("the colours are the theme tokens and the accent is drawn as ink", () => {
  for (const name of [
    "poll-block.tsx",
    "poll-form.tsx",
    "quiz-player.tsx",
    "poll-voters.tsx",
  ]) {
    const text = source(name);
    expect(text).not.toMatch(/\btext-primary\b(?!-)/);
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  }
});
