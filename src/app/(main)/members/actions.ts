"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getClientInfo } from "@/lib/client";
import {
  createProfileComment,
  createProfilePost,
  getProfilePosts,
  getUserById,
  toggleFollow,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

const MAX_BODY_LENGTH = 5000;

async function requireMember() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

function readBody(formData: FormData) {
  const body = String(formData.get("body") ?? "").trim();
  return body && body.length <= MAX_BODY_LENGTH ? body : null;
}

async function wallPostExists(profileUserId: number, profilePostId: number) {
  const posts = await getProfilePosts(profileUserId, null);
  return posts.some((post) => post.id === profilePostId);
}

function revalidateWalls() {
  revalidatePath("/");
  revalidatePath("/members/[id]", "page");
}

export async function postToWall(profileUserId: number, formData: FormData) {
  const user = await requireMember();
  const body = readBody(formData);
  if (!body || !(await getUserById(profileUserId))) return;
  await createProfilePost({
    profileUserId,
    authorId: user.id,
    body,
    client: await getClientInfo(),
  });
  revalidateWalls();
}

export async function commentOnWallPost(
  profileUserId: number,
  profilePostId: number,
  formData: FormData,
) {
  const user = await requireMember();
  const body = readBody(formData);
  if (!body || !(await wallPostExists(profileUserId, profilePostId))) return;
  await createProfileComment({
    profilePostId,
    authorId: user.id,
    body,
    client: await getClientInfo(),
  });
  revalidateWalls();
}

export async function followMember(userId: number) {
  const user = await requireMember();
  if (user.id === userId || !(await getUserById(userId))) return;
  await toggleFollow(user.id, userId);
  revalidateWalls();
}
