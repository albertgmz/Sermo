import { $isCodeNode } from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  mergeRegister,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import {
  $applyLink,
  $insertCode,
  $insertText,
  $removeFormatting,
  $setBlock,
  $setCodeLanguage,
  $wrapSelection,
  type BlockKind,
} from "@/components/forum/editor-commands";
import { TEXT_FORMATS } from "@/components/forum/editor-toolbar";
import type {
  ToolbarAction,
  ToolbarState,
  ToolbarTarget,
} from "@/components/forum/toolbar-context";

// The formatting bar's hold on the editor (`ToolbarTarget`): what a press does to the text, and
// what the bar shows of where the caret is.

function $caretBlock(): BlockKind {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return "paragraph";
  const top = selection.anchor.getNode().getTopLevelElement();
  if ($isHeadingNode(top)) return "heading";
  if ($isQuoteNode(top)) return "quote";
  if ($isCodeNode(top)) return "code";
  if ($isListNode(top))
    return top.getListType() === "number" ? "number" : "bullet";
  return "paragraph";
}

function $caretState(): Partial<ToolbarState> | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = selection.anchor.getNode();
  const top = anchor.getTopLevelElement();
  return {
    formats: TEXT_FORMATS.filter((format) => selection.hasFormat(format)),
    block: $caretBlock(),
    link: $isLinkNode(anchor) || $isLinkNode(anchor.getParent()),
    codeLanguage: $isCodeNode(top) ? (top.getLanguage() ?? "") : undefined,
  };
}

function toggleList(editor: LexicalEditor, list: "bullet" | "number") {
  if (editor.getEditorState().read($caretBlock) === list) {
    editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
  } else if (list === "bullet") {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  } else {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  }
}

function run(
  editor: LexicalEditor,
  toggleSource: () => void,
  action: ToolbarAction,
) {
  if ("format" in action) {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, action.format);
  } else if ("block" in action) {
    editor.update(() => $setBlock($caretBlock(), action.block));
  } else if ("code" in action) {
    editor.update(() => $insertCode(action.code.language, action.code.text));
  } else if ("codeLanguage" in action) {
    editor.update(() => $setCodeLanguage(action.codeLanguage));
  } else if ("list" in action) {
    toggleList(editor, action.list);
  } else if ("link" in action) {
    const url = action.link;
    if (url === null) editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    else editor.update(() => $applyLink(url));
  } else if ("insert" in action) {
    editor.update(() => $insertText(action.insert));
  } else if ("wrap" in action) {
    editor.update(() => $wrapSelection(...action.wrap));
  } else if (action.run === "removeFormatting") {
    editor.update(() => $removeFormatting());
  } else if (action.run === "source") {
    toggleSource();
  } else if (action.run === "focus") {
    editor.focus();
  } else {
    editor.dispatchCommand(
      action.run === "undo" ? UNDO_COMMAND : REDO_COMMAND,
      undefined,
    );
  }
}

export function toolbarTarget(
  editor: LexicalEditor,
  toggleSource: () => void,
): ToolbarTarget {
  return {
    ready: true,
    run: (action) => run(editor, toggleSource, action),
    watch: (show) =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => {
          const next = editorState.read($caretState);
          if (next) show(next);
        }),
        editor.registerCommand(
          CAN_UNDO_COMMAND,
          (canUndo) => {
            show({ canUndo });
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_REDO_COMMAND,
          (canRedo) => {
            show({ canRedo });
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    form: () => editor.getRootElement()?.closest("form") ?? null,
  };
}

// Applies the presses kept while the editor was on its way, in order, once each.
export function replay(target: ToolbarTarget, pressed: ToolbarAction[]) {
  for (const action of pressed.splice(0)) target.run(action);
}
