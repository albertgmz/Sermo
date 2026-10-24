// What the editor of a post had in it when "More options" took the member to the edit page, kept in
// the tab for that page to open with, once. Storage can be refused (a private window): then the
// page opens with the post as it is saved.
export type EditDraft = { body: string; title?: string; prefixId?: string };

const draftKey = (postId: number) => `sermo-edit-draft:${postId}`;

export function keepEditDraft(postId: number, form: HTMLFormElement) {
  const data = new FormData(form);
  const text = (name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value : undefined;
  };
  const draft: EditDraft = {
    body: text("body") ?? "",
    title: text("title"),
    prefixId: text("prefixId"),
  };
  try {
    sessionStorage.setItem(draftKey(postId), JSON.stringify(draft));
  } catch {
    // Nothing is kept; the page opens with the saved post.
  }
}

export function takeEditDraft(postId: number): EditDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(postId));
    sessionStorage.removeItem(draftKey(postId));
    const draft: unknown = raw ? JSON.parse(raw) : null;
    return draft &&
      typeof draft === "object" &&
      typeof (draft as EditDraft).body === "string"
      ? (draft as EditDraft)
      : null;
  } catch {
    return null;
  }
}
