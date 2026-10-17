import { forumTabsList, nodesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { staffTrail } from "../../../../trail";
import { FormSkeleton } from "../../../groups/skeletons";
import { NodeCreateForm } from "../../node-create-form";
import Loading from "./loading";

type Params = PageProps<"/[locale]/admin/forums/new/[type]">["params"];

// The screen answers for two words only: a new category and a new forum.
async function kindOf(params: Params) {
  const { type } = await params;
  if (type !== "category" && type !== "forum") notFound();
  return type;
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/forums/new/[type]">): Promise<Metadata> {
  const [t, type] = await Promise.all([
    getTranslations("adminForums.create"),
    kindOf(params),
  ]);
  return {
    title: type === "category" ? t("metaTitleCategory") : t("metaTitleForum"),
  };
}

async function NewNode({ params }: { params: Params }) {
  const [type, { items: nodes }, { items: tabs }] = await Promise.all([
    kindOf(params),
    read(nodesList, {}),
    read(forumTabsList, {}),
  ]);
  return <NodeCreateForm type={type} nodes={nodes} tabs={tabs} />;
}

async function NewNodeScreen({ params }: { params: Params }) {
  const [t, type] = await Promise.all([
    getTranslations("adminForums.create"),
    kindOf(params),
  ]);
  const category = type === "category";
  return (
    <ScreenFrame
      trail={staffTrail(`/admin/forums/new/${type}`)}
      heading={category ? t("pageHeadingCategory") : t("pageHeadingForum")}
      subtitle={category ? t("subtitleCategory") : t("subtitleForum")}
      label={t("loading")}
      fallback={<FormSkeleton rows={5} />}
    >
      <NewNode params={params} />
    </ScreenFrame>
  );
}

export default function NewNodePage({
  params,
}: PageProps<"/[locale]/admin/forums/new/[type]">) {
  return (
    <Suspense fallback={<Loading />}>
      <NewNodeScreen params={params} />
    </Suspense>
  );
}
