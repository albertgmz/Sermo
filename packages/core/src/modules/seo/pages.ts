import type { BreadcrumbList, DiscussionForumPosting, ProfilePage, WithContext } from "schema-dts";
import type { Actor } from "../../actor";
import { GUEST } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { NotFoundError } from "../../errors";
import { can, getNodeTree, permissionsOf } from "../../permissions";
import { mayViewProfile, type ProfileAccess, profileAccess } from "../profiles/shared";
import { canonicalUrl, resolveCanonical } from "./paths";

export interface SeoTemplates {
  siteName: string;
  nodeTitle?: string;
  threadTitle?: string;
  profileTitle?: string;
  nodeDescription?: string;
  threadDescription?: string;
  profileDescription?: string;
}

export interface SeoPage {
  title: string;
  description: string;
  canonical: string;
  robots: "index,follow" | "noindex,follow";
  redirect: boolean;
  jsonLd: (
    | WithContext<DiscussionForumPosting>
    | WithContext<ProfilePage>
    | WithContext<BreadcrumbList>
  )[];
}

type Thread = {
  id: number;
  node_id: number;
  user_id: number;
  title: string;
  state: string;
  created_at: number;
  last_post_at: number;
  content_updated_at: number | null;
  excerpt: string;
  reply_count: number;
  view_count: number;
  first_post_id: number | null;
};
type Post = {
  id: number;
  user_id: number;
  position: number;
  body_source: string;
  created_at: number;
  edited_at: number | null;
  username: string;
};
type Profile = {
  id: number;
  username: string;
  about: string;
  created_at: number;
  content_updated_at: number | null;
  post_count: number;
  has_public_wall: number;
};

const iso = (ms: number) => new Date(ms).toISOString();
const fill = (template: string, values: Record<string, string>) =>
  template
    .replace(
      /\{(site|siteName|title|username|description)\}/g,
      (_, key: string) => values[key === "site" ? "siteName" : key] ?? "",
    )
    .trim();
const person = (baseURL: string, id: number, username: string) => ({
  "@type": "Person" as const,
  name: username,
  url: canonicalUrl(baseURL, "profile", id, username),
});

export function nodeSeo(
  ctx: Ctx,
  actor: Actor,
  baseURL: string,
  id: number,
  requestedPath: string,
  templates: SeoTemplates,
): SeoPage {
  const node = getNodeTree(ctx).get(id);
  if (!node || !can(ctx, actor, "node.view", { nodeId: id })) throw new NotFoundError();
  const canonical = resolveCanonical(requestedPath, baseURL, "node", id, node.title);
  const ancestors = [...getNodeTree(ctx).ancestors(id), node];
  const breadcrumb: WithContext<BreadcrumbList> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: ancestors.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.title,
      item: canonicalUrl(baseURL, "node", item.id, item.title),
    })),
  };
  const values = {
    siteName: templates.siteName,
    title: node.title,
    description: node.description,
    username: "",
  };
  return {
    title: fill(templates.nodeTitle ?? "{title} | {siteName}", values),
    description: fill(templates.nodeDescription ?? "{description}", values),
    canonical: canonical.canonical,
    redirect: canonical.redirect,
    robots: can(ctx, GUEST, "node.view", { nodeId: id }) ? "index,follow" : "noindex,follow",
    jsonLd: [breadcrumb],
  };
}

export function threadSeo(
  ctx: Ctx,
  actor: Actor,
  baseURL: string,
  id: number,
  requestedPath: string,
  templates: SeoTemplates,
  page = 1,
  pageSize = 20,
): SeoPage {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1)
    throw new RangeError("Invalid thread page");
  const requestedId = id;
  for (let hops = 0; hops < 16; hops++) {
    const merged = prepared(ctx, "seo.mergedTarget", () =>
      ctx.sqlite.prepare<{ merged_into_id: number | null }, [number]>(
        "SELECT merged_into_id FROM threads WHERE id = ?1",
      ),
    ).get(id);
    if (!merged?.merged_into_id) break;
    id = merged.merged_into_id;
  }
  const thread = prepared(ctx, "seo.thread", () =>
    ctx.sqlite.prepare<Thread, [number]>(
      "SELECT id,node_id,user_id,title,state,created_at,last_post_at,content_updated_at,excerpt,reply_count,view_count,first_post_id FROM threads WHERE id=?1",
    ),
  ).get(id);
  if (!thread || !can(ctx, actor, "node.view", { nodeId: thread.node_id }))
    throw new NotFoundError();
  const viewer = permissionsOf(ctx, actor);
  if (
    thread.state !== "visible" &&
    !(actor.kind !== "guest" && actor.userId === thread.user_id) &&
    !(
      thread.state === "moderated" && viewer.can("forum.viewModerated", { nodeId: thread.node_id })
    ) &&
    !(thread.state === "deleted" && viewer.can("forum.viewDeleted", { nodeId: thread.node_id }))
  )
    throw new NotFoundError();
  const node = getNodeTree(ctx).get(thread.node_id);
  if (!node) throw new NotFoundError();
  const baseCanonical = canonicalUrl(baseURL, "thread", id, thread.title);
  const pageCanonical = page === 1 ? baseCanonical : `${baseCanonical}?page=${page}`;
  const requested = new URL(requestedPath, baseURL);
  const rows = prepared(ctx, "seo.threadPosts", () =>
    ctx.sqlite.prepare<Post, [number, number, number]>(
      "SELECT p.id,p.user_id,p.position,b.body_source,p.created_at,p.edited_at,u.username FROM posts p JOIN post_bodies b ON b.post_id=p.id JOIN users u ON u.id=p.user_id WHERE p.thread_id=?1 AND p.position BETWEEN ?2 AND ?3 AND p.state='visible' ORDER BY p.position",
    ),
  ).all(id, (page - 1) * pageSize, page * pageSize - 1);
  const first =
    page === 1
      ? rows.find((row) => row.id === thread.first_post_id)
      : prepared(ctx, "seo.firstPost", () =>
          ctx.sqlite.prepare<Post, [number]>(
            "SELECT p.id,p.user_id,p.position,b.body_source,p.created_at,p.edited_at,u.username FROM posts p JOIN post_bodies b ON b.post_id=p.id JOIN users u ON u.id=p.user_id WHERE p.id=?1 AND p.state='visible'",
          ),
        ).get(thread.first_post_id ?? 0);
  const guestVisible =
    thread.state === "visible" && can(ctx, GUEST, "node.view", { nodeId: thread.node_id });
  const indexable =
    guestVisible && rows.length >= (page === 1 ? 1 : Math.min(pageSize, 2)) && !!first;
  const description = thread.excerpt || first?.body_source.slice(0, 200) || "";
  const values = { siteName: templates.siteName, title: thread.title, description, username: "" };
  const breadcrumb: WithContext<BreadcrumbList> = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [...getNodeTree(ctx).ancestors(node.id), node].map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.title,
      item: canonicalUrl(baseURL, "node", item.id, item.title),
    })),
  };
  const posting: WithContext<DiscussionForumPosting> | null =
    first && indexable
      ? {
          "@context": "https://schema.org",
          "@type": "DiscussionForumPosting",
          "@id": `${baseCanonical}#post-${first.id}`,
          url: baseCanonical,
          mainEntityOfPage: baseCanonical,
          headline: thread.title,
          text: first.body_source,
          author: person(baseURL, first.user_id, first.username),
          datePublished: iso(first.created_at),
          dateModified: iso(thread.content_updated_at ?? first.edited_at ?? first.created_at),
          commentCount: thread.reply_count,
          interactionStatistic: {
            "@type": "InteractionCounter",
            interactionType: { "@type": "ViewAction" },
            userInteractionCount: thread.view_count + (ctx.views.get(id) ?? 0),
          },
          comment: rows
            .filter((row) => row.id !== first.id)
            .map((row) => ({
              "@type": "Comment" as const,
              "@id": `${baseCanonical}#post-${row.id}`,
              text: row.body_source,
              author: person(baseURL, row.user_id, row.username),
              datePublished: iso(row.created_at),
              ...(row.edited_at ? { dateModified: iso(row.edited_at) } : {}),
            })),
        }
      : null;
  return {
    title: fill(templates.threadTitle ?? "{title} | {siteName}", values),
    description: fill(templates.threadDescription ?? "{description}", values),
    canonical: pageCanonical,
    redirect: requestedId !== id || (requestedPath.length > 0 && requested.href !== pageCanonical),
    robots: indexable ? "index,follow" : "noindex,follow",
    jsonLd: posting ? [posting, breadcrumb] : [],
  };
}

export function profileSeo(
  ctx: Ctx,
  actor: Actor,
  baseURL: string,
  id: number,
  requestedPath: string,
  templates: SeoTemplates,
  access?: ProfileAccess,
): SeoPage {
  if (!can(ctx, actor, "profile.view")) throw new NotFoundError();
  const relation = access ?? profileAccess(ctx, actor, id);
  if (!mayViewProfile(ctx, actor, id, relation)) throw new NotFoundError();
  const profile = prepared(ctx, "seo.profile", () =>
    ctx.sqlite.prepare<Profile, [number]>(
      "SELECT id,username,about,created_at,content_updated_at,post_count,EXISTS(SELECT 1 FROM profile_posts WHERE profile_user_id=users.id AND state='visible' LIMIT 1) AS has_public_wall FROM users WHERE id=?1",
    ),
  ).get(id);
  if (!profile) throw new NotFoundError();
  const canonical = resolveCanonical(requestedPath, baseURL, "profile", id, profile.username);
  const indexable =
    can(ctx, GUEST, "profile.view") &&
    relation.profile_view_privacy === "everyone" &&
    (profile.has_public_wall === 1 || profile.about.trim().length > 0);
  const values = {
    siteName: templates.siteName,
    title: profile.username,
    username: profile.username,
    description: profile.about,
  };
  const jsonLd: WithContext<ProfilePage> = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: canonical.canonical,
    mainEntity: {
      "@type": "Person",
      name: profile.username,
      identifier: String(profile.id),
      url: canonical.canonical,
      description: profile.about || undefined,
    },
    dateCreated: iso(profile.created_at),
    ...(profile.content_updated_at ? { dateModified: iso(profile.content_updated_at) } : {}),
  };
  return {
    title: fill(templates.profileTitle ?? "{username} | {siteName}", values),
    description: fill(templates.profileDescription ?? "{description}", values),
    canonical: canonical.canonical,
    redirect: canonical.redirect,
    robots: indexable ? "index,follow" : "noindex,follow",
    jsonLd: indexable ? [jsonLd] : [],
  };
}

export function searchSeo(): Pick<SeoPage, "robots" | "jsonLd"> {
  return { robots: "noindex,follow", jsonLd: [] };
}
