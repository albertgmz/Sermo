"use client";

import { useEffect } from "react";
import { registerWorker } from "@/lib/pwa-register";

// Registers the service worker once the page has loaded and the browser is idle, so that it
// never competes with the page for the first paint.
export function WorkerRegistration() {
  useEffect(() => {
    const register = () =>
      registerWorker({
        production: process.env.NODE_ENV === "production",
        secure: window.isSecureContext,
        workers: navigator.serviceWorker,
      });
    const whenIdle = () =>
      "requestIdleCallback" in window
        ? window.requestIdleCallback(register, { timeout: 5000 })
        : setTimeout(register, 1000);
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
    return () => window.removeEventListener("load", whenIdle);
  }, []);
  return null;
}
