import { beforeEach, expect, mock, test } from "bun:test";

const changeUsername = mock(async () => ({ ok: true }));
const setTitle = mock(async () => ({ ok: true }));
const setSignature = mock(async () => ({ ok: true }));
const setAppearance = mock(async () => ({ ok: true }));
const getCurrentUser = mock();
const revalidatePath = mock();

mock.module("@/lib/db", () => ({
  changeUsername,
  setTitle,
  setSignature,
  setAppearance,
}));
mock.module("@/lib/session", () => ({ getCurrentUser }));
mock.module("next/cache", () => ({ revalidatePath }));
mock.module("next/navigation", () => ({
  redirect: (href) => {
    throw new Error(`redirect:${href}`);
  },
}));

const { saveAppearance, saveDetails, saveSignature, saveTitle, saveUsername } =
  await import("./actions");

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  changeUsername.mockReset();
  changeUsername.mockResolvedValue({ ok: true });
  setTitle.mockReset();
  setTitle.mockResolvedValue({ ok: true });
  setSignature.mockReset();
  setSignature.mockResolvedValue({ ok: true });
  setAppearance.mockReset();
  setAppearance.mockResolvedValue({ ok: true });
  revalidatePath.mockClear();
  getCurrentUser.mockResolvedValue({
    id: 1,
    username: "member",
    customTitle: "Original title",
    permissions: ["usernameChange", "customTitle"],
  });
});

test("saving a title does not spend a username change", async () => {
  await expect(
    saveDetails(null, form({ username: "member", title: "New title" })),
  ).rejects.toThrow("redirect:/account/details?saved=details");
  expect(changeUsername).not.toHaveBeenCalled();
  expect(setTitle).toHaveBeenCalledWith(1, "New title");
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
});

test("validates the title before spending a username change", async () => {
  expect(
    await saveDetails(
      null,
      form({ username: "new-name", title: "x".repeat(41), confirm: "on" }),
    ),
  ).toEqual({ field: "title", error: "too_long" });
  expect(changeUsername).not.toHaveBeenCalled();
  expect(setTitle).not.toHaveBeenCalled();
});

test("requires confirmation before changing the username", async () => {
  expect(
    await saveDetails(null, form({ username: "new-name", title: "New title" })),
  ).toEqual({ field: "username", error: "unconfirmed" });
  expect(changeUsername).not.toHaveBeenCalled();
  expect(setTitle).not.toHaveBeenCalled();
});

test("a taken username leaves the title unchanged", async () => {
  changeUsername.mockResolvedValue({ ok: false, error: "taken" });
  expect(
    await saveDetails(
      null,
      form({ username: "taken-name", title: "New title", confirm: "on" }),
    ),
  ).toEqual({ field: "username", error: "taken" });
  expect(setTitle).not.toHaveBeenCalled();
});

test("checks title permission before changing either field", async () => {
  getCurrentUser.mockResolvedValue({
    id: 1,
    username: "member",
    customTitle: "Original title",
    permissions: ["usernameChange"],
  });
  expect(
    await saveDetails(
      null,
      form({ username: "new-name", title: "New title", confirm: "on" }),
    ),
  ).toEqual({ field: "title", error: "not_allowed" });
  expect(changeUsername).not.toHaveBeenCalled();
  expect(setTitle).not.toHaveBeenCalled();
});

test("omitted disabled fields are preserved", async () => {
  await expect(saveDetails(null, form({}))).rejects.toThrow(
    "redirect:/account/details?saved=details",
  );
  expect(changeUsername).not.toHaveBeenCalled();
  expect(setTitle).not.toHaveBeenCalled();
});

test("an empty title resets it to the default", async () => {
  await expect(saveDetails(null, form({ title: "" }))).rejects.toThrow(
    "redirect:/account/details?saved=details",
  );
  expect(setTitle).toHaveBeenCalledWith(1, "");
});

test("guests cannot save account details", async () => {
  getCurrentUser.mockResolvedValue(null);
  await expect(saveDetails(null, form({ title: "New title" }))).rejects.toThrow(
    "redirect:/login",
  );
  expect(changeUsername).not.toHaveBeenCalled();
  expect(setTitle).not.toHaveBeenCalled();
});

test("saves both details with one redirect", async () => {
  await expect(
    saveDetails(
      null,
      form({ username: "new-name", title: "New title", confirm: "on" }),
    ),
  ).rejects.toThrow("redirect:/account/details?saved=details");
  expect(changeUsername).toHaveBeenCalledWith(1, "new-name");
  expect(setTitle).toHaveBeenCalledWith(1, "New title");
});

test("a rejected username change does not save the title", async () => {
  changeUsername.mockResolvedValue({ ok: false, error: "not_allowed" });
  expect(
    await saveDetails(
      null,
      form({ username: "new-name", title: "New title", confirm: "on" }),
    ),
  ).toEqual({ field: "username", error: "not_allowed" });
  expect(setTitle).not.toHaveBeenCalled();
});

test("reports a username already saved if the title write fails", async () => {
  setTitle.mockResolvedValue({ ok: false, error: "not_allowed" });
  expect(
    await saveDetails(
      null,
      form({ username: "new-name", title: "New title", confirm: "on" }),
    ),
  ).toEqual({ field: "title", error: "not_allowed", usernameSaved: true });
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
});

test("appearance choices redirect to their section with saved status", async () => {
  for (const field of ["accent", "frame", "nameColor", "cover"]) {
    await expect(
      saveAppearance(field, null, form({ value: "" })),
    ).rejects.toThrow(`redirect:/account/appearance?saved=${field}`);
    expect(setAppearance).toHaveBeenLastCalledWith(1, { [field]: null });
  }
});

test("rich signatures reach storage as Markdown and redirect to permissions", async () => {
  await expect(
    saveSignature(null, form({ signature: "**Hello**\nForum member" })),
  ).rejects.toThrow("redirect:/account/permissions?saved=signature#signature");
  expect(setSignature).toHaveBeenCalledWith(1, "**Hello**\nForum member");
});

test("clearing ignores an unfinished signature draft", async () => {
  await expect(
    saveSignature(null, form({ signature: "unfinished", clear: "1" })),
  ).rejects.toThrow("redirect:/account/permissions?saved=signature#signature");
  expect(setSignature).toHaveBeenCalledWith(1, "");
});

test("signature validation failures remain available to the form", async () => {
  for (const error of ["too_long", "too_many_lines", "not_allowed"]) {
    setSignature.mockResolvedValue({ ok: false, error });
    expect(await saveSignature(null, form({ signature: "draft" }))).toEqual({
      error,
    });
  }
  expect(revalidatePath).not.toHaveBeenCalled();
});

test("existing detail actions still save and redirect to details", async () => {
  await expect(saveTitle(null, form({ reset: "1" }))).rejects.toThrow(
    "redirect:/account/details?saved=title",
  );
  expect(setTitle).toHaveBeenCalledWith(1, "");
  await expect(
    saveUsername(null, form({ username: "new-name", confirm: "on" })),
  ).rejects.toThrow("redirect:/account/details?saved=username");
  expect(changeUsername).toHaveBeenCalledWith(1, "new-name");
});
