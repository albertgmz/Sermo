import { PageSlug } from "@sermo/core/contracts";
import { notFound } from "next/navigation";
import {
  StaticPage,
  staticPageMetadata,
} from "@/app/(main)/(static)/static-page";

async function slugOf(params: PageProps<"/pages/[slug]">["params"]) {
  const parsed = PageSlug.safeParse((await params).slug);
  if (!parsed.success) notFound();
  return parsed.data;
}

export async function generateMetadata({ params }: PageProps<"/pages/[slug]">) {
  return staticPageMetadata(await slugOf(params));
}

export default async function Page({ params }: PageProps<"/pages/[slug]">) {
  const slug = await slugOf(params);
  return <StaticPage slug={slug} path={`/pages/${slug}`} />;
}
