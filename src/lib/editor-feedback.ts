// Feedback halus untuk editor: haptic (getar pendek) + bunyi klik singkat.
// Aman di semua platform: kalau API tidak tersedia, gagal senyap.

let ctx: AudioContext | null = null;
let muted = false;
try {
  if (typeof window !== "undefined") {
    muted = window.localStorage?.getItem("editor.feedback.muted") === "1";
  }
} catch { /* noop */ }

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
  } catch { ctx = null; }
  return ctx;
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(pattern);
    }
  } catch { /* noop */ }
}

function beep(freq: number, durationMs: number, gain = 0.04) {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") { void c.resume(); }
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const now = c.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(g).connect(c.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  } catch { /* noop */ }
}

export const editorFeedback = {
  isMuted(): boolean { return muted; },
  setMuted(next: boolean) {
    muted = next;
    try { window.localStorage?.setItem("editor.feedback.muted", next ? "1" : "0"); } catch { /* noop */ }
  },
  // Ganti tool: getar sangat singkat + nada tinggi pendek.
  toolSwitch() {
    vibrate(10);
    beep(880, 60, 0.03);
  },
  // Aksi selesai / commit di kanvas (tempel stiker, teks, bentuk, coretan).
  commit() {
    vibrate([12, 30, 12]);
    beep(660, 70, 0.045);
  },
};
