"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
  $getNodeByKey,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalEditor,
  type NodeKey,
  stopLexicalPropagation,
} from "lexical";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useRef } from "react";
import {
  type Block,
  type Inline,
  type Mark,
  parseBb,
} from "@/components/forum/bb-parse";
import { quoteParts } from "@/components/forum/bb-quote";
import { ICON_BUTTON, OWN_EVENTS } from "@/components/forum/image-view";
import { prose } from "@/components/forum/prose";
import { cn } from "@/lib/utils";

// The text of a quote as the editor shows text: the formatting it holds, and every other tag as the
// text it is. Nothing here can be edited.

const MARKS = {
  bold: ["strong", prose.strong],
  italic: ["em", prose.em],
  underline: ["u", prose.u],
  strikethrough: ["del", prose.del],
  code: ["code", prose.code],
} as const;

// Text inside the tags of its formats, outermost first.
function Marked({
  marks,
  children,
}: {
  marks: readonly Mark[];
  children: string;
}): React.ReactNode {
  const [mark, ...inner] = marks;
  if (!mark) return children;
  const [Tag, className] = MARKS[mark];
  return (
    <Tag className={className}>
      <Marked marks={inner}>{children}</Marked>
    </Tag>
  );
}

function Inlines({ items }: { items: Inline[] }) {
  return items.map((item, index) => {
    // The text is drawn once and never reordered, so a position is a fine key.
    const key = `${index}`;
    if (item.t === "br") return <br key={key} />;
    if (item.t === "image") return <Fragment key={key}>{item.raw}</Fragment>;
    if (item.t === "link") {
      return (
        <span key={key} className={prose.a}>
          <Inlines items={item.kids} />
        </span>
      );
    }
    return (
      <Marked key={key} marks={item.marks}>
        {item.text}
      </Marked>
    );
  });
}

function List({ list }: { list: Extract<Block, { t: "list" }> }) {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag className={list.ordered ? prose.ol : prose.ul}>
      {list.items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the items are drawn once and never reordered
        <li key={index} className={prose.li}>
          <Inlines items={item.kids} />
          {item.nested.map((nested, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the lists are drawn once and never reordered
            <List key={at} list={nested} />
          ))}
        </li>
      ))}
    </Tag>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.t) {
    case "p":
      return (
        <p>
          <Inlines items={block.kids} />
        </p>
      );
    case "h":
      return (
        <p className={prose[`h${block.level}`]}>
          <Inlines items={block.kids} />
        </p>
      );
    case "quote":
      return <QuoteBody raw={block.raw} />;
    case "code":
      return <pre className={prose.pre}>{block.text}</pre>;
    case "list":
      return <List list={block} />;
  }
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((block, index) => {
    const key = `${index}`;
    return <BlockView key={key} block={block} />;
  });
}

// The quote as a post draws it: the name of who is quoted (linked to the post, when it names one)
// and "said:", then the text.
export function QuoteBody({ raw }: { raw: string }) {
  const { author, href, inner } = quoteParts(raw);
  return (
    <blockquote className={cn(prose.blockquote, "space-y-1.5")}>
      {author && (
        <cite className="bb-quote-author">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className={prose.a}>
              {author}
            </a>
          ) : (
            author
          )}
        </cite>
      )}
      <Blocks blocks={parseBb(inner)} />
    </blockquote>
  );
}

// The × of a quote: takes the whole quote out, and the caret back into the text.
export function removeQuote(editor: LexicalEditor, key: NodeKey) {
  editor.update(() => $getNodeByKey(key)?.remove(), { discrete: true });
  editor.focus();
}

// The block of a `QuoteBlockNode`: selectable with a click or the arrow keys, removed with the ×,
// or with Backspace or Delete once selected.
export function QuoteView({ nodeKey, raw }: { nodeKey: NodeKey; raw: string }) {
  const t = useTranslations("editor.editor.quote");
  const [editor] = useLexicalComposerContext();
  const [selected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(
    () =>
      editor.registerCommand(
        CLICK_COMMAND,
        (event) => {
          const target = event.target;
          if (!(target instanceof Node) || !box.current?.contains(target))
            return false;
          if (!event.shiftKey) clearSelection();
          setSelected(true);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, clearSelection, setSelected],
  );

  // Native listeners: the editor listens on its root, under which this is drawn, before React does,
  // and a press on the button is not typing in the text.
  useEffect(() => {
    const target = button.current;
    if (!target) return;
    for (const name of OWN_EVENTS)
      target.addEventListener(name, stopLexicalPropagation);
    return () => {
      for (const name of OWN_EVENTS)
        target.removeEventListener(name, stopLexicalPropagation);
    };
  });

  return (
    <div
      ref={box}
      className={cn(
        "bb-content relative rounded-sm pr-9",
        selected && "ring-2 ring-ring ring-offset-2 ring-offset-card",
      )}
      style={{ "--bb-said": JSON.stringify(t("said")) } as React.CSSProperties}
    >
      <QuoteBody raw={raw} />
      <button
        ref={button}
        type="button"
        aria-label={t("remove")}
        className={cn(ICON_BUTTON, "absolute top-0 right-0")}
        onClick={() => removeQuote(editor, nodeKey)}
      >
        <X />
      </button>
    </div>
  );
}
