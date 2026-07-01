// Format durasi audio/voice-note yang konsisten di seluruh UI chat.
// Kontrak: selalu "mm:ss" dengan menit & detik dua digit (zero-padded).
// Input invalid (NaN, negatif, non-finite) → "00:00".
export function formatDurationMMSS(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec < 0) return "00:00";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}