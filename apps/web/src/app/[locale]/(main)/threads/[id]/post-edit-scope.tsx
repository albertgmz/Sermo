"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EDITOR_BOX, editorPadding } from "@/components/forum/composer-box";
import { InPlaceEdit } from "@/components/forum/in-place-edit";
import { setItemState, useItemState } from "@/lib/item-state";

// The editor's box at rest, its bar's band and its text's height, while the editor and what it
// opens with are on their way: what takes the post's place does not move when they arrive.
export function EditorPlaceholder() {
  return (
    <div aria-busy="true" className={EDITOR_BOX}>
      <div className="rounded-t-[inherit] border-b bg-border p-1.5">
        <div className="h-[42px]" />
      </div>
      <div
        className={editorPadding(false)}
        style={{ minHeight: EDITOR_HEIGHT }}
      />
    </div>
  );
}

// XenForo's quick edit opens its editor 100 px tall.
export const EDITOR_HEIGHT = 100;

// The editor's code is no part of the thread's first load: it is fetched when Edit is reached
// for (a pointer over it, the focus on it) or pressed.
const loadEditor = () =>
  import("@/app/[locale]/(main)/threads/[id]/inline-post-editor");
const InlinePostEditor = dynamic(loadEditor, {
  loading: () => <EditorPlaceholder />,
});

// What a save answered with: the post's text and files and its edited mark, drawn on the server.
export type SavedPost = { body: React.ReactNode; edited: React.ReactNode };

const savedKey = (postId: number) => `post-edit:${postId}`;

const PostEditing = createContext<{
  threadId: number;
  postId: number;
  editing: boolean;
  close: (saved?: SavedPost) => void;
} | null>(null);

// A post of a thread that its viewer may edit, edited where it is read (XenForo's quick edit):
// Edit puts the editor in place of the text and the footer, Save draws the saved post there, and
// Cancel puts the post back as it was. Either gives the focus back to Edit.
export function PostEditScope({
  threadId,
  postId,
  children,
}: {
  threadId: number;
  postId: number;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLAnchorElement>(null);
  const closed = useRef(false);
  useEffect(() => {
    if (editing || !closed.current) return;
    closed.current = false;
    trigger.current?.focus();
  }, [editing]);
  const close = useCallback(
    (saved?: SavedPost) => {
      if (saved) setItemState(savedKey(postId), null, saved);
      closed.current = true;
      setEditing(false);
    },
    [postId],
  );
  const inPlace = useMemo(
    () => ({
      editing,
      open: () => setEditing(true),
      // Fetching it again only hands back the module already fetched.
      warm: () => void loadEditor().catch(() => {}),
      trigger,
    }),
    [editing],
  );
  const scope = useMemo(
    () => ({ threadId, postId, editing, close }),
    [threadId, postId, editing, close],
  );
  return (
    <InPlaceEdit value={inPlace}>
      <PostEditing value={scope}>{children}</PostEditing>
    </InPlaceEdit>
  );
}

// The post's text: the editor while it is edited, the saved text once it was (until the server
// draws the post again, with it), the text the page was drawn with before.
export function EditablePostBody(props: {
  postId: number;
  // The viewer may quote the post by selection: the saved text is drawn quotable too.
  canQuote: boolean;
  children: React.ReactNode;
}) {
  const scope = use(PostEditing);
  const saved = useItemState<SavedPost | null>(
    savedKey(props.postId),
    null,
    props,
  );
  if (scope?.editing) {
    return (
      <InlinePostEditor
        threadId={scope.threadId}
        postId={scope.postId}
        canQuote={props.canQuote}
        onClose={scope.close}
      />
    );
  }
  return saved ? saved.body : props.children;
}

// The post's edited mark, as the page drew it or as the last save answered.
export function EditedStamp(props: {
  postId: number;
  children: React.ReactNode;
}) {
  const saved = useItemState<SavedPost | null>(
    savedKey(props.postId),
    null,
    props,
  );
  return saved ? saved.edited : props.children;
}
