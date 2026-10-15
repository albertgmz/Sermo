import { beforeEach, expect, mock, test } from "bun:test";
import { SermoError } from "@/lib/sermo/errors";

let answer: () => Promise<unknown> = async () => ({
  poll: null,
  canCreate: false,
});
mock.module("server-only", () => ({}));
mock.module("@/lib/sermo/client", () => ({
  readIfAllowed: () => answer(),
}));

const { ThreadPoll } = await import("./thread-poll");

const image = (fileId: number) => ({
  fileId,
  url: `/api/v1/files/${fileId}`,
  contentType: "image/png",
  byteSize: 1,
  width: 1,
  height: 1,
  thumbnailUrl: null,
});
const poll = {
  id: 5,
  updatedAt: "2026-01-01T00:00:00.000Z",
  questions: [
    {
      id: 1,
      image: image(70),
      answers: [
        { id: 11, image: image(71) },
        { id: 12, image: null },
      ],
    },
  ],
};

beforeEach(() => {
  answer = async () => ({ poll: null, canCreate: false });
});

test("a thread with no poll draws nothing", async () => {
  expect(
    await ThreadPoll({ threadId: 9, signedIn: true, attachIn: null }),
  ).toBeNull();
});

test("a poll the backend refuses to this visitor, or no longer has, is no poll and no error", async () => {
  answer = async () => null;
  expect(
    await ThreadPoll({ threadId: 9, signedIn: false, attachIn: null }),
  ).toBeNull();
  answer = async () => {
    throw new SermoError("not_found", 404, "Gone.");
  };
  expect(
    await ThreadPoll({ threadId: 9, signedIn: false, attachIn: null }),
  ).toBeNull();
});

test("any other failure is raised, not hidden", async () => {
  answer = async () => {
    throw new SermoError("internal", 500, "Down.");
  };
  await expect(
    ThreadPoll({ threadId: 9, signedIn: true, attachIn: null }),
  ).rejects.toThrow("Down.");
});

test("each picture goes through the data saver's gate as a post picture, by file id", async () => {
  answer = async () => ({ poll, canCreate: false });
  const element = (await ThreadPoll({
    threadId: 9,
    signedIn: true,
    attachIn: 4,
  })) as {
    key: string;
    props: {
      pictures: Record<number, { props: { src: string; category: string } }>;
      attachIn: number;
    };
  };
  expect(element.key).toBe("2026-01-01T00:00:00.000Z");
  expect(Object.keys(element.props.pictures).sort()).toEqual(["70", "71"]);
  for (const id of [70, 71]) {
    expect(element.props.pictures[id]?.props.category).toBe("postImages");
    expect(element.props.pictures[id]?.props.src).toBe(`/api/v1/files/${id}`);
  }
  expect(element.props.attachIn).toBe(4);
});
