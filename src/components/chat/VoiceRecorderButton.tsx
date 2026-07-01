import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, StopCircle, Trash2, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { uploadChatFile } from "@/lib/chat-attachments";
import { sendMessage } from "@/lib/chat.functions";
import { normalizeDurationSec } from "@/components/chat/VoiceNotePlayer";

/**
 * Voice note recorder untuk komposer chat.
 * - Klik mic → mulai rekam (MediaRecorder). Format container ditentukan
 *   browser (Chrome/Firefox → audio/webm, Safari/iOS → audio/mp4).
 * - Klik stop → tampilkan preview (durasi + audio element). Bisa kirim
 *   atau dibuang.
 * - Batas rekam 3 menit; otomatis stop di batas.
 */

const MAX_SECONDS = 180;

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const cands = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const c of cands) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch { /* ignore */ }
  }
  return "";
}

function extFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Props = {
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
};

export function VoiceRecorderButton({ conversationId, disabled, onSent }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "preview" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<string>("");

  const cleanupStream = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const resetAll = useCallback(() => {
    cleanupStream();
    if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch { /* ignore */ } }
    setPreviewUrl(null);
    setBlob(null);
    setSeconds(0);
    setState("idle");
  }, [cleanupStream, previewUrl]);

  // Bersihkan resource saat unmount.
  useEffect(() => {
    return () => {
      cleanupStream();
      if (previewUrl) { try { URL.revokeObjectURL(previewUrl); } catch { /* ignore */ } }
    };
  }, [cleanupStream, previewUrl]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    try { if (rec.state !== "inactive") rec.stop(); } catch { /* ignore */ }
  }, []);

  const start = useCallback(async () => {
    if (disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Perekam suara tidak didukung di perangkat/browser ini.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      mimeRef.current = mime;
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || mimeRef.current || "audio/webm";
        const b = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        cleanupStream();
        if (b.size === 0) { toast.error("Rekaman kosong."); setState("idle"); return; }
        setBlob(b);
        setPreviewUrl(URL.createObjectURL(b));
        setState("preview");
      };
      rec.start();
      setSeconds(0);
      setState("recording");
      tickRef.current = setInterval(() => {
        setSeconds((s) => {
          const next = s + 1;
          if (next >= MAX_SECONDS) {
            try { rec.stop(); } catch { /* ignore */ }
          }
          return next;
        });
      }, 1000);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "";
      toast.error("Mikrofon ditolak atau tidak tersedia.", { description: msg });
      cleanupStream();
      setState("idle");
    }
  }, [cleanupStream, disabled]);

  const send = useCallback(async () => {
    if (!blob) return;
    setState("sending");
    try {
      const mime = blob.type || "audio/webm";
      const ext = extFromMime(mime);
      const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mime });
      const up = await uploadChatFile({ conversationId, file });
      await sendMessage({
        data: {
          conversationId,
          attachmentPath: up.path,
          attachmentMime: up.mime,
          attachmentName: up.name,
          attachmentSize: up.size,
          attachmentDurationSec: normalizeDurationSec(seconds) ?? 1,
        },
      });
      onSent?.();
      resetAll();
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Gagal mengirim voice note.";
      toast.error(msg);
      setState("preview");
    }
  }, [blob, conversationId, onSent, resetAll, seconds]);

  if (state === "idle") {
    return (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => void start()}
        disabled={disabled}
        aria-label="Rekam voice note"
        className="shrink-0"
      >
        <Mic className="h-5 w-5" />
      </Button>
    );
  }

  if (state === "recording") {
    return (
      <div className="flex items-center gap-2 rounded-full border bg-destructive/10 px-2 py-1">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-destructive" aria-hidden />
        <span className="text-xs tabular-nums text-destructive-foreground/80">{fmt(seconds)}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={resetAll}
          aria-label="Batalkan rekaman"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          className="h-7 w-7"
          onClick={stop}
          aria-label="Hentikan rekaman"
        >
          <StopCircle className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  // preview / sending
  return (
    <div className="flex items-center gap-2 rounded-full border bg-accent/40 px-2 py-1">
      <span className="text-xs tabular-nums text-muted-foreground">{fmt(seconds)}</span>
      {previewUrl ? (
        <audio src={previewUrl} controls preload="metadata" className="h-8 max-w-[10rem]" />
      ) : null}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={resetAll}
        disabled={state === "sending"}
        aria-label="Buang rekaman"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        className="h-7 w-7"
        onClick={() => void send()}
        disabled={state === "sending"}
        aria-label="Kirim voice note"
      >
        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>
    </div>
  );
}