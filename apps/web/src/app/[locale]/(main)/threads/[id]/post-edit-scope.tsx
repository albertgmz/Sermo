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
import {
  type EditTarget,
  savedKey,
} from "@/app/[locale]/(main)/threads/[id]/edit-target";
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

const PostEditing = createContext<{
  target: EditTarget;
  editing: boolean;
  close: (saved?: SavedPost) => void;
} | null>(null);

// A post of a thread or a message of a conversation that its viewer may edit, edited where it is
// read (XenForo's quick edit): Edit puts the editor in place of the text and the footer, Save
// draws the saved post there, and Cancel puts the post back as it was. Either gives the focus
// back to Edit.
export function PostEditScope({
  target,
  children,
}: {
  target: EditTarget;
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
  const key = savedKey(target);
  const close = useCallback(
    (saved?: SavedPost) => {
      if (saved) setItemState(key, null, saved);
      closed.current = true;
      setEditing(false);
    },
    [key],
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
    () => ({ target, editing, close }),
    [target, editing, close],
  );
  return (
    <InPlaceEdit value={inPlace}>
      <PostEditing value={scope}>{children}</PostEditing>
    </InPlaceEdit>
  );
}

// The post's text: the editor while it is edited, the saved text once it was (until the server
// draws the post again, with it), the text the page was drawn with before.
// Inside its `PostEditScope`.
export function EditablePostBody(props: {
  // The viewer may quote the post by selection: the saved text is drawn quotable too.
  canQuote: boolean;
  children: React.ReactNode;
}) {
  const scope = use(PostEditing);
  const saved = useSaved(props);
  if (scope?.editing) {
    return (
      <InlinePostEditor
        target={scope.target}
        canQuote={props.canQuote}
        onClose={scope.close}
      />
    );
  }
  return saved ? saved.body : props.children;
}

// The post's edited mark, as the page drew it or as the last save answered; inside its
// `PostEditScope`.
export function EditedStamp(props: { children: React.ReactNode }) {
  const saved = useSaved(props);
  return saved ? saved.edited : props.children;
}

// The last save of the item of the scope around, told how old the page's drawing is by `props`.
function useSaved(props: object) {
  const scope = use(PostEditing);
  return useItemState<SavedPost | null>(
    scope ? savedKey(scope.target) : "",
    null,
    props,
  );
}
