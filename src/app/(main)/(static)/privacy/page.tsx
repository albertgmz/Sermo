import type { Metadata } from "next";
import { StaticPage } from "@/app/(main)/(static)/static-page";

export const metadata: Metadata = {
  title: "Privacy - forum/ui",
};

const CONTENT = `
This policy is placeholder text for a demo forum. It lists the kind of information a community site typically handles.

## What is collected

- **Account details**: username, email address and the profile fields you choose to fill in.
- **Content**: threads, posts, profile messages and conversations you write.
- **Technical data**: browser and operating system, shown next to your posts and in your list of devices.

## How it is used

The information is used to run the forum: to show your content, to keep your account secure and to prevent abuse. It is not sold.

## Cookies

A single cookie keeps you signed in. No advertising or tracking cookies are set.

## Your choices

You can edit your profile at any time from your [account](/account). To have your account and personal data removed, use the [contact page](/contact).

## Retention

Posts stay visible after an account is closed unless their removal is requested. Technical data is kept only as long as it is needed.
`;

export default function PrivacyPage() {
  return (
    <StaticPage
      href="/privacy"
      title="Privacy policy"
      updated="September 1, 2026"
      content={CONTENT}
    />
  );
}
