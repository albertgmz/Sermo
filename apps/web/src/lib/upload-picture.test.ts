import { expect, test } from "bun:test";
import { uploadPicture } from "@/lib/upload-picture";

function sender(answer: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
  return { send, calls };
}

const blob = new Blob(["picture"], { type: "image/png" });

test("the cropped picture is posted as the file of the kind, asking for JSON", async () => {
  const { send, calls } = sender(() => Response.json({ ok: true }));
  expect(await uploadPicture("cover", blob, "me.png", send)).toEqual({
    ok: true,
  });
  expect(calls[0].url).toBe("/account/picture?kind=cover");
  expect(calls[0].init.method).toBe("POST");
  expect(calls[0].init.headers).toEqual({ accept: "application/json" });
  const file = (calls[0].init.body as FormData).get("file") as File;
  expect(file.name).toBe("me.png");
  expect(file.size).toBe(blob.size);
  expect(file.type).toBe("image/png");
});

test("a refusal gives the message of the route", async () => {
  const { send } = sender(() =>
    Response.json({ error: "Too large." }, { status: 413 }),
  );
  expect(await uploadPicture("avatar", blob, "a.png", send)).toEqual({
    ok: false,
    error: "Too large.",
  });
});

test("an expired session asks to sign in again", async () => {
  const { send } = sender(() => Response.json({ error: "" }, { status: 401 }));
  expect(await uploadPicture("avatar", blob, "a.png", send)).toEqual({
    ok: false,
    error: "",
    signIn: true,
  });
});

test("a network failure or an answer that is not JSON is an error with no message", async () => {
  const down = (async () => {
    throw new TypeError("offline");
  }) as unknown as typeof fetch;
  expect(await uploadPicture("avatar", blob, "a.png", down)).toEqual({
    ok: false,
    error: "",
  });
  const { send } = sender(() => new Response("<html>", { status: 502 }));
  expect(await uploadPicture("avatar", blob, "a.png", send)).toEqual({
    ok: false,
    error: "",
  });
});
