"use client";

import { ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type RefObject, useRef, useState } from "react";
import type { WallState } from "@/app/[locale]/(main)/members/actions";
import {
  POST_ATTACH,
  POST_LINE,
  POST_PILL,
} from "@/app/[locale]/(main)/members/post-composer-line";
import { ComposerForm, ComposerSheet } from "@/components/forum/composer";
import { findMentions } from "@/components/forum/mention-find";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type WallAction = (
  previous: WallState,
  formData: FormData,
) => Promise<WallState>;

// The form of a wall post, inside a dialog: the shared composer with the member's name above the
// text. The page's composer and the Create button's both draw it. `avatar` is drawn by the caller:
// the avatar is a Server Component.
export function WallPostForm({
  action,
  placeholder,
  avatar,
  name,
  formRef,
  titled = true,
  grow = false,
}: {
  action: WallAction;
  placeholder: string;
  avatar?: React.ReactNode;
  name: string;
  formRef?: RefObject<HTMLFormElement | null>;
  // False inside a dialog that names itself.
  titled?: boolean;
  // Inside a dialog that is the whole screen: the text takes what is left of it.
  grow?: boolean;
}) {
  const t = useTranslations("members.postComposer");
  const { state, pending, onSubmit } = useKeptForm(action);
  return (
    <ComposerForm
      formRef={formRef}
      onSubmit={onSubmit}
      frame={{
        kind: "dialog",
        heading: titled ? t("title") : undefined,
        grow,
      }}
      submitLabel={t("post")}
      pending={pending}
      placeholder={placeholder}
      findMembers={findMentions}
      error={state.error}
      top={
        <div className="flex items-center gap-3 px-3 pt-3">
          {avatar}
          <span className="truncate text-sm font-semibold">{name}</span>
        </div>
      }
    />
  );
}

export type PostComposerProps = {
  action: WallAction;
  placeholder: string;
  // Drawn by the page: the avatar is a Server Component.
  avatar: React.ReactNode;
  name: string;
  className?: string;
};

// The composer of a wall post. On the page it is a line: the avatar, a pill that opens the
// composer and a button that opens it; none of it loads the editor. Opened, it is the shared
// composer in its sheet (`components/forum/composer`). The pages draw `LazyPostComposer`, which
// loads this when the line is first reached for.
//
// The composer stays in the page while it is closed, so closing it loses nothing: the text and
// the files are there when it is opened again. A refused post keeps them too.
export function PostComposer({
  action,
  placeholder,
  avatar,
  name,
  className,
  opened = false,
}: PostComposerProps & {
  // Mounted open: the member reached for the closed line (`LazyPostComposer`) and this arrived.
  opened?: boolean;
}) {
  const t = useTranslations("members.postComposer");
  const [open, setOpen] = useState(opened);
  const form = useRef<HTMLFormElement>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className={cn(POST_LINE, className)}>
        <div className="mr-1">{avatar}</div>
        <DialogTrigger render={<button type="button" className={POST_PILL} />}>
          {placeholder}
        </DialogTrigger>
        <button
          type="button"
          aria-label={t("aria.attach")}
          title={t("aria.attach")}
          className={POST_ATTACH}
          onClick={() => {
            setOpen(true);
            // The composer's own file field, which is in the page while the composer is closed.
            form.current
              ?.querySelector<HTMLInputElement>('input[type="file"]')
              ?.click();
          }}
        >
          <ImagePlus />
        </button>
      </div>
      <ComposerSheet open={open} formRef={form}>
        <WallPostForm
          formRef={form}
          action={action}
          placeholder={placeholder}
          avatar={avatar}
          name={name}
        />
      </ComposerSheet>
    </Dialog>
  );
}

// What `LazyPostComposer` loads when the closed line is first reached for.
export default function OpenedPostComposer(props: PostComposerProps) {
  return <PostComposer {...props} opened />;
}
