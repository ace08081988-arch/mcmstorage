import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

// Type minimal untuk global turnstile API.
type TurnstileGlobal = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: (code: string) => void;
      "expired-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
      appearance?: "always" | "execute" | "interaction-only";
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    return new Promise((resolve) => {
      if (window.turnstile) resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Gagal memuat script Turnstile"));
    document.head.appendChild(s);
  });
}

export type TurnstileWidgetProps = {
  siteKey: string;
  onToken: (token: string | null) => void;
  onError?: (code: string) => void;
};

export type TurnstileWidgetHandle = {
  /** Reset widget: buang token lama & tampilkan challenge baru. */
  reset: () => void;
};

/**
 * Widget Cloudflare Turnstile. Memanggil onToken(token) saat verifikasi
 * sukses, dan onToken(null) saat token kedaluwarsa / gagal.
 */
export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ siteKey, onToken, onError }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        try {
          if (widgetIdRef.current && window.turnstile) {
            window.turnstile.reset(widgetIdRef.current);
          }
        } catch {
          /* ignore */
        }
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled) return;
        if (!hostRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(hostRef.current, {
          sitekey: siteKey,
          callback: (t) => onToken(t),
          "expired-callback": () => onToken(null),
          "error-callback": (code) => {
            onToken(null);
            onError?.(code);
          },
          theme: "auto",
        });
      })
      .catch((e) => {
        onError?.(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch {
        /* ignore */
      }
    };
  }, [siteKey, onToken, onError]);

  return <div ref={hostRef} className="flex justify-center" />;
});

/**
 * Site key publik untuk Turnstile. Boleh berada di kode klien (memang publik).
 * Kosong = fitur signup dinonaktifkan sementara sampai admin mengaturnya.
 */
export const TURNSTILE_SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";