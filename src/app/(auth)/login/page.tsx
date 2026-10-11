import type { Metadata } from "next";
import Link from "next/link";
import { AuthCollage } from "@/app/(auth)/login/auth-collage";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { LogoMark } from "@/components/layout/logo";
import { getUsers } from "@/lib/db";

export const metadata: Metadata = {
  title: "Log in - forum/ui",
};

export default async function LoginPage() {
  const [first, second] = await getUsers();

  return (
    <main className="grid min-h-dvh flex-1 md:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Link
            href="/"
            aria-label="forum/ui home"
            className="mx-auto flex size-12 items-center justify-center rounded-md"
          >
            <LogoMark className="size-9" />
          </Link>
          <h1 className="mt-3 mb-8 text-center text-3xl font-bold tracking-tight">
            Welcome back
          </h1>
          <LoginForm />
          <p className="mt-4 text-xs text-muted-foreground">
            Demo: log in as{" "}
            <span className="font-mono text-foreground">{first.username}</span>{" "}
            or{" "}
            <span className="font-mono text-foreground">{second.username}</span>{" "}
            with any password.
          </p>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            No account yet?{" "}
            <Link
              href="/register"
              className="inline-flex min-h-10 items-center font-medium text-foreground underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </div>
      </div>
      <AuthCollage className="hidden md:block" />
    </main>
  );
}
