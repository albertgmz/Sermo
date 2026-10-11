import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/app/(auth)/register/register-form";
import { Logo } from "@/components/layout/logo";
import { PageBackdrop } from "@/components/layout/page-backdrop";

export const metadata: Metadata = {
  title: "Create an account - forum/ui",
};

export default function RegisterPage() {
  return (
    <main className="relative isolate flex min-h-dvh flex-1 items-center justify-center px-4 py-8">
      <PageBackdrop />
      <div className="grid w-full max-w-5xl overflow-hidden rounded-lg border bg-background md:min-h-[36rem] md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-muted p-8 md:flex">
          <Logo />
          <figure className="space-y-4">
            <blockquote className="text-lg leading-snug text-pretty">
              “I came here for one answer and stayed for the conversations. The
              threads are focused, the people are generous, and I learn
              something every single week.”
            </blockquote>
            <figcaption className="text-sm font-medium">Elena Park</figcaption>
          </figure>
        </div>
        <div className="flex flex-col p-4 sm:p-8">
          <div className="flex items-center justify-between md:justify-end">
            <Logo className="md:hidden" />
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-md px-2 text-sm font-medium underline-offset-4 hover:underline"
            >
              Login
            </Link>
          </div>
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-6">
            <h1 className="text-center text-2xl font-bold tracking-tight">
              Create an account
            </h1>
            <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">
              Enter your email below to create your account
            </p>
            <RegisterForm />
          </div>
        </div>
      </div>
    </main>
  );
}
