import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isChatOnly } from "@/lib/app-mode";

/**
 * Splash screen khusus mode MCM Chat.
 *
 * Tampil sekali per session saat aplikasi dibuka di mode chat, meniru
 * splash APK native supaya varian Chat terasa seperti aplikasi terpisah
 * dari MCM Storage. Otomatis hilang setelah ~1.4 detik dengan animasi
 * fade-out. Tidak tampil di mode "full".
 *
 * Konsistensi:
 *   - Guard `sessionStorage` + flag modul memastikan splash hanya
 *     sekali per session — StrictMode / navigasi klien tidak
 *     memicunya lagi.
 *   - Sessionkey ditandai setelah fade selesai, jadi kalau tab
 *     di-close saat splash masih tampil, reload berikutnya tetap
 *     memutar splash penuh.
 *   - Dirender lewat portal ke `document.body` supaya route
 *     transition tidak memengaruhi stacking / opacity fade.
 *   - Menghormati `prefers-reduced-motion`: fade langsung tanpa
 *     jeda animasi.
 */
const SESSION_KEY = "mcm.chat.splashShown";
// Durasi fade harus sama dengan `duration-500` di className supaya
// scheduler timeout dan transisi CSS selalu selaras.
const HOLD_MS = 1000;
const FADE_MS = 500;

// Flag modul supaya double-invoke `useEffect` (React StrictMode di dev)
// tidak menampilkan splash dua kali dalam satu mount siklus.
let shownThisSession = false;

export function ChatModeSplash() {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isChatOnly()) return;
    if (shownThisSession) return;
    try {
      if (window.sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      /* ignore */
    }
    shownThisSession = true;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = reduce ? 400 : HOLD_MS;
    const fade = reduce ? 0 : FADE_MS;
    setVisible(true);
    const t1 = window.setTimeout(() => setFading(true), hold);
    const t2 = window.setTimeout(() => {
      setVisible(false);
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* ignore */
      }
    }, hold + fade);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (!mounted || !visible) return null;
  const node = (
    <div
      role="status"
      aria-label="Memuat MCM Chat"
      aria-hidden={fading || undefined}
      className={
        "fixed inset-0 z-[100] flex flex-col items-center justify-center transition-opacity ease-out motion-reduce:transition-none " +
        (fading ? "opacity-0 pointer-events-none" : "opacity-100")
      }
      style={{
        background:
          "radial-gradient(circle at 50% 35%, #0a7a4a 0%, #064e3b 55%, #022c22 100%)",
        transitionDuration: `${FADE_MS}ms`,
      }}
    >
      <img
        src="/mcm-chat-icon.png"
        alt=""
        width={128}
        height={128}
        className="h-32 w-32 rounded-3xl shadow-2xl ring-1 ring-white/10"
        style={{ animation: "mcm-chat-splash-pop 700ms ease-out both" }}
      />
      <div className="mt-6 text-2xl font-semibold tracking-tight text-white">
        MCM Chat
      </div>
      <div className="mt-1 text-xs text-emerald-100/70">
        Pesan cepat & terhubung
      </div>
      <div className="mt-8 h-1 w-24 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full w-1/3 rounded-full bg-emerald-300"
          style={{ animation: "mcm-chat-splash-slide 1200ms ease-in-out infinite" }}
        />
      </div>
      <style>{`
        @keyframes mcm-chat-splash-pop {
          0% { transform: scale(0.6); opacity: 0; }
          60% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes mcm-chat-splash-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
  return createPortal(node, document.body);
}