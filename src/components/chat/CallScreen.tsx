import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  createPeerSession,
  startOffer,
  type CallKind,
  type PeerSession,
} from "@/lib/webrtc";
import {
  fetchCall,
  markAccepted,
  markEnded,
  formatCallDuration,
  type CallRow,
} from "@/lib/calls";
import { supabase } from "@/integrations/supabase/client";
import { getCallStatusVisual, type CallVisualStatus } from "@/lib/call-status-visual";

/**
 * Full-screen UI panggilan. Bertanggung jawab atas: setup peer, negosiasi
 * SDP, timer durasi, kontrol mute/kamera, dan update baris `chat_calls`
 * sesuai transisi status.
 */

type Props = {
  callId: string;
  meId: string;
  role: "caller" | "callee";
  kind: CallKind;
  peerName: string;
  onClose: () => void;
};

export function CallScreen({ callId, meId, role, kind, peerName, onClose }: Props) {
  const [phase, setPhase] = useState<"connecting" | "dialing" | "ringing" | "in-call" | "ended">(
    role === "caller" ? "dialing" : "connecting",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<
    "ended" | "declined" | "missed" | "cancelled" | "failed" | null
  >(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(kind === "video");
  const [remoteReady, setRemoteReady] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const sessionRef = useRef<PeerSession | null>(null);
  const acceptedAtRef = useRef<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const doneRef = useRef(false);

  const finalize = useCallback(
    async (status: "ended" | "declined" | "missed" | "cancelled" | "failed", reason?: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      setPhase("ended");
      setFinalStatus(status);
      try { sessionRef.current?.sendBye(reason); } catch { /* ignore */ }
      try { await sessionRef.current?.close(reason); } catch { /* ignore */ }
      try {
        await markEnded(callId, status, {
          acceptedAt: acceptedAtRef.current,
          reason,
        });
      } catch { /* ignore */ }
      onClose();
    },
    [callId, onClose],
  );

  // Setup peer + jalur negosiasi.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await createPeerSession({
          callId,
          meId,
          kind,
          handlers: {
            onRemoteStream: (stream) => {
              setRemoteReady(true);
              // Set srcObject di elemen video dan audio remote. Autoplay
              // dengan MediaStream sering diblokir kebijakan browser
              // (terutama Android WebView & iOS Safari) walau ada atribut
              // `autoPlay` — kita harus memanggil `.play()` eksplisit.
              const vid = remoteVideoRef.current;
              const aud = remoteAudioRef.current;
              if (vid && vid.srcObject !== stream) {
                vid.srcObject = stream;
                vid.muted = false;
                void vid.play().catch(() => { /* akan retry saat user tap */ });
              }
              if (aud && aud.srcObject !== stream) {
                aud.srcObject = stream;
                aud.muted = false;
                aud.volume = 1;
                void aud.play().catch(() => { /* akan retry saat user tap */ });
              }
            },
            onIceState: (s) => {
              if (s === "failed" || s === "disconnected") {
                void finalize("failed", `ice:${s}`);
              }
            },
            onError: (err) => {
              setErrorMsg(err.message);
            },
            onRingingAck: () => {
              // Callee sudah menampilkan dialog masuk — beralih dari
              // "Memanggil…" ke "Berdering…". Hanya berpengaruh saat
              // caller masih di fase awal.
              setPhase((p) => (p === "dialing" ? "ringing" : p));
            },
          },
        });
        if (cancelled) { void session.close(); return; }
        sessionRef.current = session;
        if (localVideoRef.current) localVideoRef.current.srcObject = session.localStream;

        if (role === "caller") {
          await startOffer(session);
        }
      } catch (e) {
        const msg = (e as { message?: string })?.message ?? "Gagal memulai panggilan";
        toast.error(msg);
        void finalize("failed", msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId, meId, kind, role, finalize]);

  // Callee: dengarkan perubahan status di DB (accepted by self, ended by caller).
  // Caller: dengarkan accepted/ended dari callee.
  useEffect(() => {
    const channel = supabase
      .channel(`call-row:${callId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_calls", filter: `id=eq.${callId}` },
        (payload) => {
          const row = payload.new as CallRow;
          if (row.status === "accepted" && !acceptedAtRef.current) {
            acceptedAtRef.current = row.accepted_at ?? new Date().toISOString();
            setPhase("in-call");
          }
          if (["ended", "declined", "cancelled", "missed", "failed"].includes(row.status)) {
            if (!doneRef.current) {
              doneRef.current = true;
              setPhase("ended");
              setFinalStatus(
                row.status as "ended" | "declined" | "missed" | "cancelled" | "failed",
              );
              void sessionRef.current?.close(row.status);
              onClose();
            }
          }
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [callId, onClose]);

  // Timer durasi
  useEffect(() => {
    if (phase !== "in-call") return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Callee menandai accepted di DB sekali peer session siap.
  useEffect(() => {
    if (role !== "callee") return;
    if (phase !== "connecting") return;
    if (!sessionRef.current) return;
    (async () => {
      try {
        await markAccepted(callId);
        acceptedAtRef.current = new Date().toISOString();
        setPhase("in-call");
      } catch (e) {
        toast.error("Gagal menerima panggilan");
        void finalize("failed", (e as { message?: string })?.message);
      }
    })();
  }, [role, phase, callId, finalize]);

  // Timeout ringing (caller) — 45 detik. Berlaku untuk fase dialing
  // maupun ringing supaya panggilan tidak menggantung tanpa jawaban.
  useEffect(() => {
    if (role !== "caller") return;
    if (phase !== "ringing" && phase !== "dialing") return;
    const t = setTimeout(() => {
      void finalize("missed", "no-answer");
    }, 45_000);
    return () => clearTimeout(t);
  }, [role, phase, finalize]);

  // Poll baris awal (untuk caller yang menunggu accepted_at).
  useEffect(() => {
    if (role !== "caller") return;
    let mounted = true;
    (async () => {
      const row = await fetchCall(callId).catch(() => null);
      if (mounted && row?.status === "accepted") {
        acceptedAtRef.current = row.accepted_at;
        setPhase("in-call");
      }
    })();
    return () => { mounted = false; };
  }, [callId, role]);

  // Retry `.play()` pada elemen remote setiap kali user menyentuh
  // layar panggilan — mengatasi autoplay yang diblokir sebelum ada
  // interaksi. Aman dipanggil berkali-kali (idempotent).
  const resumePlayback = useCallback(() => {
    const v = remoteVideoRef.current;
    const a = remoteAudioRef.current;
    if (v && v.paused && v.srcObject) void v.play().catch(() => { /* ignore */ });
    if (a && a.paused && a.srcObject) void a.play().catch(() => { /* ignore */ });
  }, []);

  // Pemetaan ikon/warna/label/hint terpusat — sama dengan halaman /panggilan.
  const visualKey: CallVisualStatus =
    phase === "connecting" || phase === "dialing" || phase === "ringing" || phase === "in-call"
      ? (phase as CallVisualStatus)
      : (finalStatus ?? "ended");
  const visual = useMemo(
    () => getCallStatusVisual(visualKey, { outgoing: role === "caller" }),
    [visualKey, role],
  );
  const StatusIcon = visual.Icon;
  const statusIconClass = visual.colorClass;
  const statusHint = visual.hint;

  const status = useMemo(() => {
    if (errorMsg && phase === "ended") return errorMsg;
    if (phase === "in-call") return formatCallDuration(seconds);
    return visual.label;
  }, [phase, seconds, errorMsg, visual.label]);

  // Ringback tone (nada tut-tut) untuk caller selama menunggu jawaban.
  // Pola tipe Indonesia: ~1 detik nada 425 Hz + ~4 detik hening,
  // sedikit dipersingkat supaya feedback terasa cepat.
  useEffect(() => {
    if (role !== "caller") return;
    if (phase !== "dialing" && phase !== "ringing") return;
    const Ctor =
      typeof window !== "undefined"
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (!Ctor) return;
    let ctx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    let gain: GainNode | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    try {
      ctx = new Ctor();
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 425;
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      // Beep panjang ~1s, jeda ~2s (dipercepat untuk feedback UX).
      const play = () => {
        if (!ctx || !gain) return;
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
        gain.gain.setValueAtTime(0.18, now + 1.0);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);
      };
      play();
      interval = setInterval(play, 3000);
    } catch {
      /* ignore — silent fallback */
    }
    return () => {
      if (interval) clearInterval(interval);
      try { osc?.stop(); } catch { /* ignore */ }
      try { void ctx?.close(); } catch { /* ignore */ }
    };
  }, [role, phase]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
      onPointerDown={resumePlayback}
    >
      {/* Remote video / avatar besar */}
      <div className="relative flex-1 overflow-hidden">
        {kind === "video" ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <audio ref={remoteAudioRef} autoPlay playsInline />
        )}
        {/* Elemen audio remote tambahan untuk mode video — beberapa
            browser (Android WebView) tidak selalu memutar audio track
            lewat <video>. Menyediakan sink audio terpisah menjamin
            suara terdengar. */}
        {kind === "video" ? (
          <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
        ) : null}
        {!remoteReady && kind === "video" ? (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-neutral-900 to-black">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="grid h-24 w-24 place-items-center rounded-full bg-white/10 text-3xl font-semibold uppercase">
                {peerName.trim().charAt(0) || "?"}
              </div>
              <p className="text-lg font-semibold">{peerName}</p>
              <p className="text-sm text-white/70">{status}</p>
            </div>
          </div>
        ) : null}
        {kind === "audio" ? (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-neutral-900 to-black">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="grid h-28 w-28 place-items-center rounded-full bg-white/10 text-4xl font-semibold uppercase">
                {peerName.trim().charAt(0) || "?"}
              </div>
              <p className="text-xl font-semibold">{peerName}</p>
              <p className="text-sm text-white/70">{status}</p>
            </div>
          </div>
        ) : null}

        {/* Preview lokal kecil di pojok */}
        {kind === "video" ? (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-4 right-4 h-32 w-24 rounded-lg border border-white/20 object-cover shadow-lg"
          />
        ) : null}

        {/* Status bar atas */}
        <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-4">
          <button
            type="button"
            onClick={() => toast.info(statusHint)}
            title={statusHint}
            aria-label={statusHint}
            className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 text-xs backdrop-blur hover:bg-black/60"
          >
            <StatusIcon className={`h-3.5 w-3.5 ${statusIconClass}`} />
            <span>{status}</span>
          </button>
          {phase === "connecting" || phase === "ringing" ? (
            <Loader2 className="h-4 w-4 animate-spin text-white/70" />
          ) : null}
        </div>
      </div>

      {/* Kontrol */}
      <div className="flex items-center justify-center gap-4 border-t border-white/10 bg-black/60 px-4 py-6">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={`h-14 w-14 rounded-full ${micOn ? "bg-white/10" : "bg-white/40 text-black"}`}
          onClick={() => {
            const next = !micOn;
            setMicOn(next);
            sessionRef.current?.toggleAudio(next);
          }}
          aria-label={micOn ? "Matikan mikrofon" : "Nyalakan mikrofon"}
        >
          {micOn ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
        </Button>

        {kind === "video" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`h-14 w-14 rounded-full ${camOn ? "bg-white/10" : "bg-white/40 text-black"}`}
            onClick={() => {
              const next = !camOn;
              setCamOn(next);
              sessionRef.current?.toggleVideo(next);
            }}
            aria-label={camOn ? "Matikan kamera" : "Nyalakan kamera"}
          >
            {camOn ? <VideoIcon className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
          </Button>
        ) : null}

        <Button
          type="button"
          size="icon"
          className="h-14 w-14 rounded-full bg-red-600 text-white hover:bg-red-700"
          onClick={() => {
            const status: "ended" | "cancelled" =
              phase === "ringing" ? "cancelled" : "ended";
            void finalize(status, "user-hangup");
          }}
          aria-label="Akhiri panggilan"
        >
          <PhoneOff className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
}