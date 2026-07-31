/**
 * Utilitas kontrol output audio in-call:
 * - `listOutputDevices()` daftar `audiooutput` dari enumerateDevices.
 * - `applyAudioSink(el, deviceId)` alihkan output via setSinkId.
 * - `guessDeviceKind(label)` heuristik Speaker/Earpiece/Bluetooth.
 * - Volume in-call disimpan di localStorage.
 */

export type AudioOutputKind = "speaker" | "earpiece" | "headset" | "bluetooth" | "unknown";

export type OutputDevice = {
  deviceId: string;
  label: string;
  kind: AudioOutputKind;
};

const VOL_STORAGE_KEY = "mcm:call-volume";

function hasSetSinkId(el: HTMLMediaElement): el is HTMLMediaElement & {
  setSinkId: (id: string) => Promise<void>;
} {
  return typeof (el as unknown as { setSinkId?: unknown }).setSinkId === "function";
}

export function isOutputSelectionSupported(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.createElement("audio");
  return hasSetSinkId(el);
}

export function guessDeviceKind(label: string): AudioOutputKind {
  const s = label.toLowerCase();
  if (/bluetooth|bt\b|airpod|soundcore|jbl|beats|wf-|wh-/.test(s)) return "bluetooth";
  if (/head(set|phone)|earbud|earphone|wired/.test(s)) return "headset";
  if (/earpiece|receiver|handset/.test(s)) return "earpiece";
  if (/speaker|louds?peaker/.test(s)) return "speaker";
  return "unknown";
}

export async function listOutputDevices(): Promise<OutputDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audiooutput")
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || "Perangkat audio",
      kind: guessDeviceKind(d.label || ""),
    }));
}

export async function applyAudioSink(
  el: HTMLMediaElement | null,
  deviceId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!el) return { ok: false, reason: "no-element" };
  if (!hasSetSinkId(el)) return { ok: false, reason: "unsupported" };
  try {
    await el.setSinkId(deviceId);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export function loadPersistedVolume(): number {
  if (typeof localStorage === "undefined") return 1;
  const raw = localStorage.getItem(VOL_STORAGE_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

export function persistVolume(volume: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(VOL_STORAGE_KEY, String(Math.max(0, Math.min(1, volume))));
  } catch {
    /* ignore */
  }
}

export function labelForKind(kind: AudioOutputKind): string {
  switch (kind) {
    case "speaker": return "Speaker";
    case "earpiece": return "Earpiece";
    case "headset": return "Headset";
    case "bluetooth": return "Bluetooth";
    default: return "Output audio";
  }
}

export function iconForKind(kind: AudioOutputKind): string {
  switch (kind) {
    case "speaker": return "🔊";
    case "earpiece": return "👂";
    case "headset":
    case "bluetooth": return "🎧";
    default: return "🔉";
  }
}