import { PageSlug } from "@sermo/core/contracts";
import { notFound } from "next/navigation";
import {
  StaticPage,
  staticPageMetadata,
} from "@/app/[locale]/(main)/(static)/static-page";

async function slugOf(params: PageProps<"/[locale]/pages/[slug]">["params"]) {
  const parsed = PageSlug.safeParse((await params).slug);
  if (!parsed.success) notFound();
  return parsed.data;
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/pages/[slug]">) {
  const slug = await slugOf(params);
  return staticPageMetadata(slug, `/pages/${slug}`);
}

export default async function Page({
  params,
}: PageProps<"/[locale]/pages/[slug]">) {
  const slug = await slugOf(params);
  return <StaticPage slug={slug} path={`/pages/${slug}`} />;
}
