import type { AttachedFile } from "@/components/forum/attachment-field";

// What the editor of a post had in it when "More options" took the member to the edit page, kept in
// the tab for that page to open with, once: the text, the title row of an opening post, and the
// files as the editor listed them (uploaded, removed), so a file placed in the text is still the
// post's. Storage can be refused (a private window): then the page opens with the post as it is
// saved.
export type EditDraft = {
  body: string;
  title?: string;
  prefixId?: string;
  // Absent where the editor had no file list: the page opens with the post's saved files.
  attached?: AttachedFile[];
};

// One per post, for this tab only (the cookie policy lists it: `editDraft`).
const DRAFT_PREFIX = "sermo-edit-draft:";
const draftKey = (postId: number) => `${DRAFT_PREFIX}${postId}`;

export function keepEditDraft(
  postId: number,
  data: FormData,
  attached: AttachedFile[] | null,
) {
  const text = (name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const draft: EditDraft = {
    body: text("body") ?? "",
    title: text("title"),
    prefixId: text("prefixId"),
    attached: attached ?? undefined,
  };
  try {
    sessionStorage.setItem(`${DRAFT_PREFIX}${postId}`, JSON.stringify(draft));
  } catch {
    // Nothing is kept; the page opens with the saved post.
  }
}

const isFile = (file: unknown): file is AttachedFile =>
  typeof file === "object" &&
  file !== null &&
  typeof (file as AttachedFile).id === "number" &&
  typeof (file as AttachedFile).name === "string";

export function takeEditDraft(postId: number): EditDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(postId));
    sessionStorage.removeItem(draftKey(postId));
    const draft: unknown = raw ? JSON.parse(raw) : null;
    if (
      !draft ||
      typeof draft !== "object" ||
      typeof (draft as EditDraft).body !== "string"
    )
      return null;
    const { attached } = draft as EditDraft;
    // A list that is not one is no list: the page keeps the saved files.
    if (
      attached !== undefined &&
      !(Array.isArray(attached) && attached.every(isFile))
    )
      return { ...(draft as EditDraft), attached: undefined };
    return draft as EditDraft;
  } catch {
    return null;
  }
}
