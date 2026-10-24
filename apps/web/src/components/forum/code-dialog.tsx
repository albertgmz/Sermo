"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  COMMON_LANGUAGES,
  OTHER_LANGUAGES,
} from "@/components/forum/code-languages";
import { selectClass } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CodeDialogProps = {
  // The language of the code block the caret is in ("" for General code), or null when the dialog
  // puts a new code block in.
  current: string | null;
  onInsert: (language: string, text: string) => void;
  onChange: (language: string) => void;
  onRemove: () => void;
  onClose: () => void;
  // Puts the focus back in the text, as the caret was left.
  onRestoreFocus: () => void;
};

const known = (language: string) =>
  [...COMMON_LANGUAGES, ...OTHER_LANGUAGES].some(({ id }) => id === language);

// What closing the dialog does with the focus, however it is closed (a choice, Cancel, Escape, the
// X): it goes back to the text at the caret, not to the button that opened the dialog.
export const textFocus = (restore: () => void) => () => {
  restore();
  return false;
};

// XenForo's "Insert code" dialog: the language to pick (General code first, then the common
// languages, then the others) and the code itself. Over a code block that is already there it
// changes the block's language instead. Its code is no part of the editor's first load
// (`Toolbar` fetches it on the first press of the code button).
export default function CodeDialog(props: CodeDialogProps) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => !isOpen && props.onClose()}
    >
      <DialogContent
        className="sm:max-w-lg"
        finalFocus={textFocus(props.onRestoreFocus)}
      >
        <CodeDialogBody
          current={props.current}
          onInsert={props.onInsert}
          onChange={props.onChange}
          onRemove={props.onRemove}
          onFinish={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

// What the dialog holds (apart from the box that keeps it over the page).
export function CodeDialogBody({
  current,
  onInsert,
  onChange,
  onRemove,
  onFinish,
}: Pick<CodeDialogProps, "current" | "onInsert" | "onChange" | "onRemove"> & {
  onFinish: () => void;
}) {
  const t = useTranslations("editor.editor");
  const changing = current !== null;
  const [language, setLanguage] = useState(current ?? "");
  const [text, setText] = useState("");
  const field = useId();
  const choose = () => {
    if (changing) onChange(language);
    else onInsert(language, text);
    onFinish();
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(changing ? "codeChangeTitle" : "codeInsertTitle")}
        </DialogTitle>
        {!changing && <DialogDescription>{t("codeHelp")}</DialogDescription>}
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={`${field}-language`}>{t("codeLanguageLabel")}</Label>
        <select
          id={`${field}-language`}
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className={selectClass}
        >
          <option value="">{t("codeGeneral")}</option>
          {changing && current !== "" && !known(current) && (
            <optgroup label={t("codeCurrentLanguage")}>
              <option value={current}>{current}</option>
            </optgroup>
          )}
          <optgroup label={t("codeCommonLanguages")}>
            {COMMON_LANGUAGES.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("codeOtherLanguages")}>
            {OTHER_LANGUAGES.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {!changing && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${field}-code`}>{t("codeLabel")}</Label>
          <Textarea
            id={`${field}-code`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="max-h-64 font-mono"
          />
        </div>
      )}
      <DialogFooter>
        {changing && (
          <Button
            type="button"
            variant="outline"
            className="sm:mr-auto"
            onClick={() => {
              onRemove();
              onFinish();
            }}
          >
            {t("codeRemove")}
          </Button>
        )}
        <DialogClose render={<Button type="button" variant="outline" />}>
          {t("codeCancel")}
        </DialogClose>
        <Button type="button" onClick={choose}>
          {t(changing ? "codeApply" : "codeInsert")}
        </Button>
      </DialogFooter>
    </>
  );
}
