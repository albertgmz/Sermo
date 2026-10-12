"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const SECTIONS: Record<string, string> = {
  "#username": "/account/details",
  "#title": "/account/details",
  "#appearance": "/account/appearance",
  "#permissions": "/account/permissions",
  "#signature": "/account/permissions",
  "#devices": "/account/security",
};

export function LegacyAccountLinks() {
  const router = useRouter();

  useEffect(() => {
    const navigate = () => {
      const { hash, search } = window.location;
      const section = SECTIONS[hash];
      if (section) router.replace(`${section}${search}${hash}`);
    };
    navigate();
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, [router]);

  return null;
}
