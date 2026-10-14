"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Cuts a long body at a fixed height and links to the full message. Whether
// the text is really cut depends on the width, so it is measured before paint;
// `expectLong` is the server's guess for the first HTML.
export function ClampedBody({
  href,
  expectLong,
  children,
}: {
  href: string;
  expectLong: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("home.clampedBody");
  const box = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(expectLong);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () =>
      setCut(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        ref={box}
        className={cn(
          "mt-2 max-h-64 overflow-hidden md:max-h-40",
          cut &&
            "[mask-image:linear-gradient(to_bottom,black_13rem,transparent_16rem)] md:[mask-image:linear-gradient(to_bottom,black_7rem,transparent_10rem)]",
        )}
      >
        {children}
      </div>
      {cut && (
        <Link
          href={href}
          className="mt-1 inline-flex h-10 items-center text-sm font-medium text-primary-ink underline-offset-4 hover:underline md:h-8"
        >
          {t("readMore")}
        </Link>
      )}
    </>
  );
}
