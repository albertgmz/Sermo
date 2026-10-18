import { beforeEach, expect, mock, test } from "bun:test";
import { SermoError } from "@/lib/sermo/errors";

let answer: () => Promise<unknown> = async () => ({
  poll: null,
  canCreate: false,
});
let blocked = false;
mock.module("server-only", () => ({}));
mock.module("@/lib/sermo/client", () => ({
  readIfAllowed: () => answer(),
}));
mock.module("@/lib/lite-mode", () => ({ liteBlocks: async () => blocked }));

const { ThreadPoll } = await import("./thread-poll");
const { LazyArt } = await import("@/components/forum/art");

const image = (fileId: number) => ({
  fileId,
  url: `/api/v1/files/${fileId}`,
  contentType: "image/png",
  byteSize: 1,
  width: 1000,
  height: 500,
  thumbnailUrl: `/api/v1/files/${fileId + 1000}`,
  widths: [
    { url: `/api/v1/files/${fileId + 1000}`, width: 320 },
    { url: `/api/v1/files/${fileId + 2000}`, width: 640 },
  ],
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

type Drawn = {
  key: string;
  props: {
    poll: unknown;
    pictures: Record<
      number,
      {
        type: unknown;
        props: {
          src: string;
          category: string;
          candidates: string;
          sizes: string;
        };
      }
    >;
    attachIn: number;
  };
};
const draw = async (attachIn: number | null = null) =>
  (await ThreadPoll({
    threadId: 9,
    signedIn: true,
    attachIn,
  })) as unknown as Drawn;

beforeEach(() => {
  answer = async () => ({ poll: null, canCreate: false });
  blocked = false;
});

test("a thread with no poll draws nothing", async () => {
  expect(
    await ThreadPoll({ threadId: 9, signedIn: true, attachIn: null }),
  ).toBeNull();
});

test("a poll the backend refuses to this visitor, no longer has, or fails to read is no poll and no error", async () => {
  for (const failure of [
    new SermoError("not_found", 404, "Gone."),
    new SermoError("internal", 500, "Down."),
    new SermoError("rate_limited", 429, "Slow down."),
  ]) {
    answer = async () => {
      throw failure;
    };
    expect(
      await ThreadPoll({ threadId: 9, signedIn: false, attachIn: null }),
    ).toBeNull();
  }
  answer = async () => null;
  expect(
    await ThreadPoll({ threadId: 9, signedIn: false, attachIn: null }),
  ).toBeNull();
});

test("what is not the backend's answer is raised, not hidden", async () => {
  answer = async () => {
    throw new TypeError("bug");
  };
  await expect(
    ThreadPoll({ threadId: 9, signedIn: true, attachIn: null }),
  ).rejects.toThrow("bug");
});

test("each picture goes through the data saver's gate as a post picture, by file id", async () => {
  answer = async () => ({ poll, canCreate: false });
  const element = await draw(4);
  expect(element.key).toBe("2026-01-01T00:00:00.000Z");
  expect(Object.keys(element.props.pictures).sort()).toEqual(["70", "71"]);
  for (const id of [70, 71]) {
    expect(element.props.pictures[id]?.type).toBe(LazyArt);
    expect(element.props.pictures[id]?.props.category).toBe("postImages");
    // With its smaller copies, for the browser to take the one the box needs.
    expect(element.props.pictures[id]?.props.candidates).toBe(
      `/api/v1/files/${id + 1000} 320w, /api/v1/files/${id + 2000} 640w, /api/v1/files/${id} 1000w`,
    );
    expect(element.props.pictures[id]?.props.sizes).toBe("auto, 100vw");
  }
  expect(element.props.attachIn).toBe(4);
});

test("the client is given no picture address, with the data saver on or off", async () => {
  answer = async () => ({ poll, canCreate: false });
  for (const state of [true, false]) {
    blocked = state;
    const element = await draw();
    // What the block reads of the poll names pictures by id only.
    const data = JSON.stringify(element.props.poll);
    expect(data).not.toContain("/files/");
    expect(data).not.toContain("thumbnail");
    expect(data).toContain('"fileId":70');
  }
});
