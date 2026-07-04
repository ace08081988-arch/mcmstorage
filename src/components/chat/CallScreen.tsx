import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Loader2,
  Volume2, VolumeX, Volume1, ChevronDown, AlertTriangle, Maximize2, ArrowLeftRight, Maximize, Minimize, Crop, Scan, Signal, SwitchCamera, Move,
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
import {
  applyAudioSink,
  guessDeviceKind,
  iconForKind,
  isOutputSelectionSupported,
  labelForKind,
  listOutputDevices,
  loadPersistedVolume,
  persistVolume,
  type OutputDevice,
  type AudioOutputKind,
} from "@/lib/audio-output";
import { getNativeAudioRoute } from "@/lib/native-audio-route";
import { describeCallError } from "@/lib/call-errors";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

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
  const [volume, setVolume] = useState<number>(loadPersistedVolume());
  const [outputs, setOutputs] = useState<OutputDevice[]>([]);
  const [activeSinkId, setActiveSinkId] = useState<string>("default");
  const [outputSheetOpen, setOutputSheetOpen] = useState(false);
  const [turnConfigured, setTurnConfigured] = useState<boolean | null>(null);
  const outputSupported = isOutputSelectionSupported();

  // PiP (preview kecil) — user dapat swap besar/kecil, ubah ukuran, dan geser posisi.
  // Ukuran + pojok di-persist agar konsisten antar panggilan / antar layar.
  const PIP_SIZE_KEY = "mcm.call.pipSize";
  const PIP_CORNER_KEY = "mcm.call.pipCorner";
  const VIDEO_FIT_KEY = "mcm.call.videoFit";
  const [swapped, setSwapped] = useState(false);
  const [pipSize, setPipSize] = useState<"sm" | "md" | "lg">(() => {
    if (typeof window === "undefined") return "md";
    const v = window.localStorage.getItem(PIP_SIZE_KEY);
    return v === "sm" || v === "md" || v === "lg" ? v : "md";
  });
  const [pipCorner, setPipCorner] = useState<"tl" | "tr" | "bl" | "br">(() => {
    if (typeof window === "undefined") return "br";
    const v = window.localStorage.getItem(PIP_CORNER_KEY);
    return v === "tl" || v === "tr" || v === "bl" || v === "br" ? v : "br";
  });
  useEffect(() => {
    try { window.localStorage.setItem(PIP_SIZE_KEY, pipSize); } catch { /* ignore */ }
  }, [pipSize]);
  useEffect(() => {
    try { window.localStorage.setItem(PIP_CORNER_KEY, pipCorner); } catch { /* ignore */ }
  }, [pipCorner]);
  // Aspect ratio: "cover" (crop, isi penuh) atau "contain" (fit, tanpa terpotong).
  const [videoFit, setVideoFit] = useState<"cover" | "contain">(() => {
    if (typeof window === "undefined") return "cover";
    const v = window.localStorage.getItem(VIDEO_FIT_KEY);
    return v === "contain" ? "contain" : "cover";
  });
  useEffect(() => {
    try { window.localStorage.setItem(VIDEO_FIT_KEY, videoFit); } catch { /* ignore */ }
  }, [videoFit]);
  const toggleVideoFit = useCallback(() => {
    setVideoFit((f) => (f === "cover" ? "contain" : "cover"));
  }, []);
  const videoFitClass = videoFit === "cover" ? "object-cover" : "object-contain";
  // Pan/posisi crop — hanya berlaku saat mode "cover" (Crop). Mengontrol
  // CSS `object-position` supaya bagian penting frame tidak terpotong.
  type VideoPos = "center" | "top" | "bottom" | "left" | "right";
  const VIDEO_POS_KEY = "mcm.call.videoPos";
  const [videoPos, setVideoPos] = useState<VideoPos>(() => {
    if (typeof window === "undefined") return "center";
    const v = window.localStorage.getItem(VIDEO_POS_KEY);
    return v === "top" || v === "bottom" || v === "left" || v === "right" || v === "center"
      ? v
      : "center";
  });
  useEffect(() => {
    try { window.localStorage.setItem(VIDEO_POS_KEY, videoPos); } catch { /* ignore */ }
  }, [videoPos]);
  const cycleVideoPos = useCallback(() => {
    setVideoPos((p) =>
      p === "center" ? "top"
      : p === "top" ? "right"
      : p === "right" ? "bottom"
      : p === "bottom" ? "left"
      : "center",
    );
  }, []);
  const videoPosCss =
    videoPos === "center" ? "50% 50%"
    : videoPos === "top" ? "50% 0%"
    : videoPos === "bottom" ? "50% 100%"
    : videoPos === "left" ? "0% 50%"
    : "100% 50%";
  const videoPosLabel =
    videoPos === "center" ? "Tengah"
    : videoPos === "top" ? "Atas"
    : videoPos === "bottom" ? "Bawah"
    : videoPos === "left" ? "Kiri"
    : "Kanan";
  // Kualitas video keluar — auto (biarkan browser adaptif) atau paksa preset
  // resolusi/bitrate untuk stabilitas di jaringan lemah.
  const VIDEO_QUALITY_KEY = "mcm.call.videoQuality";
  type VideoQuality = "auto" | "low" | "medium" | "high";
  const [videoQuality, setVideoQuality] = useState<VideoQuality>(() => {
    if (typeof window === "undefined") return "auto";
    const v = window.localStorage.getItem(VIDEO_QUALITY_KEY);
    return v === "low" || v === "medium" || v === "high" || v === "auto" ? v : "auto";
  });
  useEffect(() => {
    try { window.localStorage.setItem(VIDEO_QUALITY_KEY, videoQuality); } catch { /* ignore */ }
  }, [videoQuality]);
  const cycleVideoQuality = useCallback(() => {
    setVideoQuality((q) =>
      q === "auto" ? "low" : q === "low" ? "medium" : q === "medium" ? "high" : "auto",
    );
  }, []);
  const videoQualityLabel =
    videoQuality === "auto" ? "Auto"
    : videoQuality === "low" ? "Rendah"
    : videoQuality === "medium" ? "Sedang"
    : "Tinggi";
  const videoQualityHint =
    videoQuality === "auto" ? "Otomatis mengikuti jaringan"
    : videoQuality === "low" ? "320p · hemat data, stabil di sinyal lemah"
    : videoQuality === "medium" ? "480p · seimbang"
    : "720p · kualitas tinggi (butuh koneksi baik)";
  // Kamera depan/belakang — dipersist supaya panggilan berikutnya membuka
  // kamera yang sama. Nilai default "user" (kamera depan) untuk video call.
  const FACING_MODE_KEY = "mcm.call.facingMode";
  const [facingMode, setFacingMode] = useState<"user" | "environment">(() => {
    if (typeof window === "undefined") return "user";
    const v = window.localStorage.getItem(FACING_MODE_KEY);
    return v === "environment" ? "environment" : "user";
  });
  useEffect(() => {
    try { window.localStorage.setItem(FACING_MODE_KEY, facingMode); } catch { /* ignore */ }
  }, [facingMode]);
  const [flipping, setFlipping] = useState(false);
  // Bertambah tiap kali kamera dibalik — dipakai untuk memaksa Crop/Fit &
  // kualitas video di-apply ulang begitu track lokal baru terpasang.
  const [cameraSwapNonce, setCameraSwapNonce] = useState(0);
  // Indikator kualitas jaringan dari `RTCPeerConnection.getStats()`.
  // - rttMs: round-trip time dari candidate-pair aktif
  // - lossPct: rasio paket hilang inbound (audio+video) selama window terakhir
  // - tier: derivasi kualitas (good/fair/poor/unknown)
  type NetTier = "unknown" | "good" | "fair" | "poor";
  const [netStats, setNetStats] = useState<{
    rttMs: number | null;
    lossPct: number | null;
    tier: NetTier;
  }>({ rttMs: null, lossPct: null, tier: "unknown" });
  const pipSizeClass =
    pipSize === "sm" ? "h-24 w-20" : pipSize === "lg" ? "h-48 w-36" : "h-32 w-24";
  const pipCornerClass =
    pipCorner === "tl" ? "top-16 left-4"
    : pipCorner === "tr" ? "top-16 right-4"
    : pipCorner === "bl" ? "bottom-28 left-4"
    : "bottom-28 right-4";
  const cyclePipSize = useCallback(() => {
    setPipSize((s) => (s === "sm" ? "md" : s === "md" ? "lg" : "sm"));
  }, []);
  // Drag state — offset visual selama drag (transform), lalu snap ke pojok
  // terdekat + clamp di dalam bounds container saat pointer dilepas.
  const [pipOffset, setPipOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const pipDragRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    moved: boolean;
    boxRect: DOMRect;
    parentRect: DOMRect;
  } | null>(null);
  const onPipPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget as HTMLDivElement;
    const parent = box.parentElement;
    if (!parent) return;
    pipDragRef.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      boxRect: box.getBoundingClientRect(),
      parentRect: parent.getBoundingClientRect(),
    };
    box.setPointerCapture(e.pointerId);
  }, []);
  const onPipPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = pipDragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 8) d.moved = true;
    if (!d.moved) return;
    // Clamp supaya preview tidak keluar dari container.
    const minX = d.parentRect.left - d.boxRect.left;
    const maxX = d.parentRect.right - d.boxRect.right;
    const minY = d.parentRect.top - d.boxRect.top;
    const maxY = d.parentRect.bottom - d.boxRect.bottom;
    setPipOffset({
      x: Math.min(Math.max(dx, minX), maxX),
      y: Math.min(Math.max(dy, minY), maxY),
    });
  }, []);
  const onPipPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = pipDragRef.current;
    pipDragRef.current = null;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
    if (!d) {
      setPipOffset({ x: 0, y: 0 });
      return;
    }
    if (!d.moved) {
      setPipOffset({ x: 0, y: 0 });
      return;
    }
    // Pilih pojok terdekat berdasarkan pusat preview setelah drag.
    const finalCx = d.boxRect.left + d.boxRect.width / 2 + (e.clientX - d.startX);
    const finalCy = d.boxRect.top + d.boxRect.height / 2 + (e.clientY - d.startY);
    const parentCx = d.parentRect.left + d.parentRect.width / 2;
    const parentCy = d.parentRect.top + d.parentRect.height / 2;
    const isLeft = finalCx < parentCx;
    const isTop = finalCy < parentCy;
    setPipCorner(isTop ? (isLeft ? "tl" : "tr") : (isLeft ? "bl" : "br"));
    setPipOffset({ x: 0, y: 0 });
  }, []);
  const pipStyle = pipOffset.x !== 0 || pipOffset.y !== 0
    ? { transform: `translate(${pipOffset.x}px, ${pipOffset.y}px)` }
    : undefined;

  const sessionRef = useRef<PeerSession | null>(null);
  const acceptedAtRef = useRef<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(false);
  const helloReceivedRef = useRef(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      if (!document.fullscreenElement) {
        await root.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch (err) {
      console.warn("[call] fullscreen toggle gagal", err);
      toast.error("Gagal mengaktifkan layar penuh di perangkat ini.");
    }
  }, []);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {
          /* ignore */
        });
      }
    };
  }, []);

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
                vid.volume = volume;
                void vid.play().catch(() => { /* akan retry saat user tap */ });
              }
              if (aud && aud.srcObject !== stream) {
                aud.srcObject = stream;
                aud.muted = false;
                aud.volume = volume;
                void aud.play().catch(() => { /* akan retry saat user tap */ });
              }
              // Label perangkat baru terbuka penuh setelah izin media
              // diberikan — segarkan daftar output audio.
              void listOutputDevices().then(setOutputs);
            },
            onIceState: (s) => {
              if (s === "failed" || s === "disconnected") {
                void finalize("failed", `ice:${s}`);
              }
            },
            onError: (err) => {
              const info = describeCallError(err, kind === "video" ? "video" : "audio");
              setErrorMsg(`${info.title}. ${info.hint}`);
              toast.error(info.title, { description: info.hint });
            },
            onRingingAck: () => {
              // Callee sudah menampilkan dialog masuk — beralih dari
              // "Memanggil…" ke "Berdering…". Hanya berpengaruh saat
              // caller masih di fase awal.
              setPhase((p) => (p === "dialing" ? "ringing" : p));
            },
            onPeerHello: () => {
              helloReceivedRef.current = true;
              // Callee sudah subscribe channel — resend offer supaya
              // pesan tidak hilang karena race di broadcast Realtime.
              if (role === "caller" && sessionRef.current) {
                void startOffer(sessionRef.current);
              }
            },
            onTurnStatus: (ok) => setTurnConfigured(ok),
          },
        });
        if (cancelled) { void session.close(); return; }
        sessionRef.current = session;
        if (localVideoRef.current) localVideoRef.current.srcObject = session.localStream;

        if (role === "caller") {
          // Tunggu "hello" dari callee maks 4 detik; setelah itu tetap
          // kirim offer sebagai fallback.
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 4000);
            const iv = setInterval(() => {
              if (helloReceivedRef.current) {
                clearInterval(iv);
                clearTimeout(t);
                resolve();
              }
            }, 100);
          });
          await startOffer(session);
        }
      } catch (e) {
        const info = describeCallError(e, kind === "video" ? "video" : "audio");
        setErrorMsg(`${info.title}. ${info.hint}`);
        toast.error(info.title, { description: info.hint, duration: 8000 });
        void finalize("failed", info.title);
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

  // Toast rekomendasi turunkan kualitas saat jaringan buruk berkepanjangan.
  // Hanya muncul sekali sampai jaringan pulih agar tidak spam.
  const poorNoticedRef = useRef(false);
  useEffect(() => {
    if (phase !== "in-call") return;
    if (netStats.tier === "poor" && videoQuality !== "low" && !poorNoticedRef.current) {
      poorNoticedRef.current = true;
      toast.warning("Jaringan lemah", {
        description: "Coba turunkan kualitas video ke Rendah agar panggilan lebih stabil.",
        action: {
          label: "Turunkan",
          onClick: () => setVideoQuality("low"),
        },
      });
    }
    if (netStats.tier === "good") {
      poorNoticedRef.current = false;
    }
  }, [netStats.tier, phase, videoQuality]);

  // Polling statistik jaringan tiap 2 detik selama panggilan aktif.
  // Menghitung RTT dari candidate-pair terpilih & packet loss inbound
  // (audio+video) dari selisih antar sampel, lalu derivasi tier kualitas.
  useEffect(() => {
    if (phase !== "in-call") return;
    const session = sessionRef.current;
    if (!session) return;
    let cancelled = false;
    let prev: { lost: number; recv: number } | null = null;
    const tick = async () => {
      try {
        const report = await session.pc.getStats();
        let rttMs: number | null = null;
        let lost = 0;
        let recv = 0;
        report.forEach((s: unknown) => {
          const r = s as {
            type?: string;
            nominated?: boolean;
            selected?: boolean;
            state?: string;
            currentRoundTripTime?: number;
            packetsLost?: number;
            packetsReceived?: number;
            kind?: string;
          };
          if (
            r.type === "candidate-pair" &&
            (r.nominated || r.selected) &&
            r.state === "succeeded" &&
            typeof r.currentRoundTripTime === "number"
          ) {
            rttMs = Math.round(r.currentRoundTripTime * 1000);
          }
          if (
            r.type === "inbound-rtp" &&
            (r.kind === "audio" || r.kind === "video") &&
            typeof r.packetsLost === "number" &&
            typeof r.packetsReceived === "number"
          ) {
            lost += r.packetsLost;
            recv += r.packetsReceived;
          }
        });
        let lossPct: number | null = null;
        if (prev) {
          const dLost = Math.max(0, lost - prev.lost);
          const dRecv = Math.max(0, recv - prev.recv);
          const total = dLost + dRecv;
          lossPct = total > 0 ? (dLost / total) * 100 : 0;
        }
        prev = { lost, recv };
        let tier: NetTier = "unknown";
        if (rttMs !== null || lossPct !== null) {
          const rttBad = rttMs !== null && rttMs > 400;
          const rttMid = rttMs !== null && rttMs > 200;
          const lossBad = lossPct !== null && lossPct > 5;
          const lossMid = lossPct !== null && lossPct > 2;
          tier = rttBad || lossBad ? "poor" : rttMid || lossMid ? "fair" : "good";
        }
        if (!cancelled) setNetStats({ rttMs, lossPct, tier });
      } catch {
        /* getStats bisa gagal di beberapa browser — abaikan */
      }
    };
    void tick();
    const iv = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [phase]);

  // Terapkan preset kualitas video ke track lokal + parameter encoder
  // sender. "auto" melepas batasan dan menyerahkan adaptasi ke browser.
  useEffect(() => {
    if (kind !== "video") return;
    const session = sessionRef.current;
    if (!session) return;
    const preset: Record<
      Exclude<VideoQuality, "auto">,
      { width: number; height: number; frameRate: number; maxBitrate: number; scale: number }
    > = {
      low: { width: 320, height: 240, frameRate: 15, maxBitrate: 150_000, scale: 4 },
      medium: { width: 640, height: 480, frameRate: 24, maxBitrate: 500_000, scale: 2 },
      high: { width: 1280, height: 720, frameRate: 30, maxBitrate: 1_500_000, scale: 1 },
    };
    let cancelled = false;
    (async () => {
      try {
        const videoTrack = session.localStream.getVideoTracks()[0];
        if (videoTrack) {
          try {
            if (videoQuality === "auto") {
              await videoTrack.applyConstraints({
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30 },
              });
            } else {
              const p = preset[videoQuality];
              await videoTrack.applyConstraints({
                width: { ideal: p.width, max: p.width },
                height: { ideal: p.height, max: p.height },
                frameRate: { ideal: p.frameRate, max: p.frameRate },
              });
            }
          } catch (err) {
            console.warn("[call] applyConstraints gagal", err);
          }
        }
        const sender = session.pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          if (videoQuality === "auto") {
            for (const enc of params.encodings) {
              delete (enc as { maxBitrate?: number }).maxBitrate;
              delete (enc as { scaleResolutionDownBy?: number }).scaleResolutionDownBy;
              delete (enc as { maxFramerate?: number }).maxFramerate;
            }
          } else {
            const p = preset[videoQuality];
            for (const enc of params.encodings) {
              enc.maxBitrate = p.maxBitrate;
              (enc as { maxFramerate?: number }).maxFramerate = p.frameRate;
              (enc as { scaleResolutionDownBy?: number }).scaleResolutionDownBy = p.scale;
            }
          }
          try {
            await sender.setParameters(params);
          } catch (err) {
            console.warn("[call] setParameters gagal", err);
          }
        }
      } catch (err) {
        if (!cancelled) console.warn("[call] apply video quality gagal", err);
      }
    })();
    return () => { cancelled = true; };
  }, [videoQuality, kind, phase, remoteReady, cameraSwapNonce]);

  // Terapkan ulang aspect ratio Crop/Fit ke elemen <video> lokal setiap
  // kali track lokal berubah (mis. setelah tukar kamera front/back).
  // Kelas Tailwind sudah reaktif via className, tapi beberapa Chromium di
  // Android kadang mempertahankan sisa layout saat srcObject diganti —
  // menyentuh `style.objectFit` eksplisit memastikan setelan langsung berlaku.
  useEffect(() => {
    if (kind !== "video") return;
    const v = localVideoRef.current;
    if (v) v.style.objectFit = videoFit;
    const rv = remoteVideoRef.current;
    if (rv) rv.style.objectFit = videoFit;
  }, [videoFit, kind, cameraSwapNonce, remoteReady]);

  // Tukar kamera depan/belakang tanpa menutup panggilan: buka stream baru
  // dengan facingMode target, ganti track pada sender via `replaceTrack`,
  // lalu perbarui MediaStream lokal & elemen preview. Setelah selesai,
  // effect kualitas + Crop/Fit di atas akan otomatis re-apply karena
  // `cameraSwapNonce` di-increment.
  const flipCamera = useCallback(async () => {
    if (kind !== "video") return;
    const session = sessionRef.current;
    if (!session) return;
    if (flipping) return;
    setFlipping(true);
    const next: "user" | "environment" = facingMode === "user" ? "environment" : "user";
    let newStream: MediaStream | null = null;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: next } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) throw new Error("Track kamera tidak tersedia");
      newTrack.enabled = camOn;
      const sender = session.pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(newTrack);
      }
      // Ganti track pada MediaStream lokal supaya preview mengikuti.
      const oldTrack = session.localStream.getVideoTracks()[0];
      if (oldTrack) {
        try { session.localStream.removeTrack(oldTrack); } catch { /* ignore */ }
        try { oldTrack.stop(); } catch { /* ignore */ }
      }
      session.localStream.addTrack(newTrack);
      // Re-bind srcObject supaya <video> memuat frame baru + memicu paint;
      // pakai stream yang sama agar identitasnya stabil untuk React.
      const v = localVideoRef.current;
      if (v) {
        v.srcObject = session.localStream;
        void v.play().catch(() => { /* akan retry saat user tap */ });
      }
      setFacingMode(next);
      setCameraSwapNonce((n) => n + 1);
    } catch (err) {
      console.warn("[call] flip camera gagal", err);
      toast.error("Gagal menukar kamera", {
        description: "Perangkat ini mungkin hanya memiliki satu kamera.",
      });
      try { newStream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    } finally {
      setFlipping(false);
    }
  }, [kind, facingMode, camOn, flipping]);

  // Terapkan volume ke elemen remote setiap kali berubah + persist.
  useEffect(() => {
    const v = remoteVideoRef.current;
    const a = remoteAudioRef.current;
    if (v) v.volume = volume;
    if (a) a.volume = volume;
    persistVolume(volume);
  }, [volume]);

  // Refresh daftar output audio saat mount dan saat perangkat berubah
  // (headset/Bluetooth disambung/dilepas).
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const list = await listOutputDevices();
      if (!cancelled) setOutputs(list);
    };
    void refresh();
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    if (md && "addEventListener" in md) {
      md.addEventListener("devicechange", refresh);
      return () => {
        cancelled = true;
        md.removeEventListener("devicechange", refresh);
      };
    }
    return () => { cancelled = true; };
  }, []);

  // Terapkan sink pilihan ke elemen media aktif.
  useEffect(() => {
    const target = kind === "video" ? remoteVideoRef.current : remoteAudioRef.current;
    if (!target) return;
    void applyAudioSink(target, activeSinkId);
  }, [activeSinkId, kind, remoteReady]);

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

  const activeDevice = useMemo<OutputDevice | null>(() => {
    if (outputs.length === 0) return null;
    return (
      outputs.find((d) => d.deviceId === activeSinkId) ??
      outputs.find((d) => d.deviceId === "default") ??
      outputs[0]
    );
  }, [outputs, activeSinkId]);
  const activeKind: AudioOutputKind = activeDevice?.kind ?? "unknown";

  const toggleSpeakerphone = useCallback(async () => {
    const speakerDev = outputs.find((d) => d.kind === "speaker");
    const nonSpeakerDev =
      outputs.find((d) => d.kind !== "speaker") ??
      outputs.find((d) => d.deviceId === "default");
    if (speakerDev && nonSpeakerDev) {
      const next =
        activeKind === "speaker" ? nonSpeakerDev.deviceId : speakerDev.deviceId;
      setActiveSinkId(next);
      return;
    }
    const bridge = await getNativeAudioRoute();
    if (bridge.available) {
      const nextOn = activeKind !== "speaker";
      await bridge.setSpeakerOn(nextOn);
      toast.info(nextOn ? "Speaker keras aktif" : "Speaker keras nonaktif");
      return;
    }
    toast.info("Ubah output dari kontrol sistem perangkat");
  }, [outputs, activeKind]);

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
      ref={rootRef}
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
            className={
              swapped
                ? `absolute ${pipCornerClass} ${pipSizeClass} rounded-lg border border-white/20 ${videoFitClass} shadow-lg z-10 bg-black`
                : `absolute inset-0 h-full w-full ${videoFitClass} bg-black`
            }
          />
        ) : (
          <audio ref={remoteAudioRef} autoPlay playsInline />
        )}
        {/* Elemen audio remote untuk mode video — beberapa browser
            (Android WebView) tidak selalu memutar audio track lewat
            <video>. Sink audio terpisah menjamin suara terdengar dan
            memungkinkan setSinkId dipakai konsisten. Menggunakan satu
            ref yang sama supaya volume/sink dapat dikontrol serentak. */}
        {kind === "video" ? (
          <audio
            ref={(el) => {
              remoteAudioRef.current = el;
            }}
            autoPlay
            playsInline
            className="hidden"
          />
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

        {/* Preview lokal — dapat di-swap besar/kecil, diubah ukurannya, dan digeser */}
        {kind === "video" ? (
          <div
            className={
              swapped
                ? "absolute inset-0 z-0"
                : `absolute ${pipCornerClass} ${pipSizeClass} z-10 touch-none`
            }
            style={swapped ? undefined : pipStyle}
            onPointerDown={swapped ? undefined : onPipPointerDown}
            onPointerMove={swapped ? undefined : onPipPointerMove}
            onPointerUp={swapped ? undefined : onPipPointerUp}
            onPointerCancel={swapped ? undefined : onPipPointerUp}
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={
                swapped
                  ? `absolute inset-0 h-full w-full ${videoFitClass} bg-black`
                  : `h-full w-full rounded-lg border border-white/20 ${videoFitClass} shadow-lg bg-black`
              }
            />
            {!swapped ? (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 rounded-b-lg bg-black/50 px-1.5 py-1 backdrop-blur">
                <button
                  type="button"
                  aria-label="Tukar video besar/kecil"
                  title="Tukar besar/kecil"
                  onClick={() => setSwapped((s) => !s)}
                  className="rounded p-1 text-white/90 hover:bg-white/10"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Ubah ukuran preview"
                  title={`Ukuran: ${pipSize.toUpperCase()}`}
                  onClick={cyclePipSize}
                  className="flex items-center gap-1 rounded p-1 text-[10px] font-semibold text-white/90 hover:bg-white/10"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span>{pipSize.toUpperCase()}</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {swapped && kind === "video" ? (
          <button
            type="button"
            aria-label="Kembalikan tampilan video"
            title="Tukar besar/kecil"
            onClick={() => setSwapped(false)}
            className="absolute bottom-28 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1.5 text-xs text-white backdrop-blur hover:bg-black/70"
          >
            <ArrowLeftRight className="mr-1 inline h-3.5 w-3.5" /> Tukar
          </button>
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
          <div className="flex items-center gap-2">
            {phase === "in-call" && netStats.tier !== "unknown" ? (
              <span
                data-testid="call-net-quality"
                data-tier={netStats.tier}
                title={
                  `Jaringan: ${
                    netStats.tier === "good" ? "Baik"
                    : netStats.tier === "fair" ? "Sedang"
                    : "Buruk"
                  }` +
                  (netStats.rttMs !== null ? ` · ping ${netStats.rttMs} ms` : "") +
                  (netStats.lossPct !== null ? ` · loss ${netStats.lossPct.toFixed(1)}%` : "")
                }
                aria-label={
                  `Kualitas jaringan ${
                    netStats.tier === "good" ? "baik"
                    : netStats.tier === "fair" ? "sedang"
                    : "buruk"
                  }` +
                  (netStats.rttMs !== null ? `, ping ${netStats.rttMs} milidetik` : "") +
                  (netStats.lossPct !== null ? `, packet loss ${netStats.lossPct.toFixed(1)} persen` : "")
                }
                className={
                  "flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-[11px] backdrop-blur " +
                  (netStats.tier === "good"
                    ? "text-emerald-300"
                    : netStats.tier === "fair"
                      ? "text-amber-300"
                      : "text-red-300")
                }
              >
                <Signal className="h-3.5 w-3.5" />
                <span className="tabular-nums">
                  {netStats.rttMs !== null ? `${netStats.rttMs}ms` : "–"}
                  {netStats.lossPct !== null ? ` · ${netStats.lossPct.toFixed(1)}%` : ""}
                </span>
              </span>
            ) : null}
            {activeDevice && phase === "in-call" ? (
              <span
                data-testid="call-active-device"
                className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-[11px] text-white/80 backdrop-blur"
                title={activeDevice.label}
              >
                <span aria-hidden>{iconForKind(activeKind)}</span>
                <span className="max-w-[9rem] truncate">{activeDevice.label}</span>
              </span>
            ) : null}
            {phase === "connecting" || phase === "ringing" ? (
              <Loader2 className="h-4 w-4 animate-spin text-white/70" />
            ) : null}
            {kind === "video" ? (
              <button
                type="button"
                onClick={toggleVideoFit}
                aria-label={videoFit === "cover" ? "Ubah ke Fit (tanpa terpotong)" : "Ubah ke Crop (isi penuh)"}
                aria-pressed={videoFit === "contain"}
                title={videoFit === "cover" ? "Mode: Crop — ketuk untuk Fit" : "Mode: Fit — ketuk untuk Crop"}
                data-testid="call-fit-toggle"
                className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1.5 text-[11px] text-white/90 backdrop-blur hover:bg-black/60"
              >
                {videoFit === "cover" ? (
                  <Crop className="h-3.5 w-3.5" />
                ) : (
                  <Scan className="h-3.5 w-3.5" />
                )}
                <span>{videoFit === "cover" ? "Crop" : "Fit"}</span>
              </button>
            ) : null}
            {kind === "video" ? (
              <button
                type="button"
                onClick={cycleVideoQuality}
                aria-label={`Kualitas video: ${videoQualityLabel}. ${videoQualityHint}. Ketuk untuk ubah.`}
                title={`Kualitas: ${videoQualityLabel} — ${videoQualityHint}`}
                data-testid="call-quality-toggle"
                data-quality={videoQuality}
                className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-1.5 text-[11px] text-white/90 backdrop-blur hover:bg-black/60"
              >
                <Signal className="h-3.5 w-3.5" />
                <span>{videoQualityLabel}</span>
              </button>
            ) : null}
            {kind === "video" ? (
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                aria-label={isFullscreen ? "Keluar layar penuh" : "Layar penuh"}
                aria-pressed={isFullscreen}
                title={isFullscreen ? "Keluar layar penuh" : "Layar penuh"}
                data-testid="call-fullscreen-toggle"
                className="rounded-full bg-black/40 p-1.5 text-white/90 backdrop-blur hover:bg-black/60"
              >
                {isFullscreen ? (
                  <Minimize className="h-4 w-4" />
                ) : (
                  <Maximize className="h-4 w-4" />
                )}
              </button>
            ) : null}
          </div>
        </div>

        {turnConfigured === false && phase !== "ended" ? (
          <div
            role="note"
            data-testid="call-turn-warning"
            className="absolute inset-x-4 top-14 flex items-start gap-2 rounded-md bg-amber-500/15 px-3 py-2 text-[11px] text-amber-100 backdrop-blur"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              TURN server belum diatur — panggilan bisa gagal di jaringan
              seluler / Wi-Fi kantor. Atur TURN_URL, TURN_USERNAME, dan
              TURN_CREDENTIAL pada Backend.
            </span>
          </div>
        ) : null}
      </div>

      {/* Kontrol */}
      <div className="flex flex-col gap-3 border-t border-white/10 bg-black/60 px-4 py-4">
        {/* Baris kontrol audio: output picker · speakerphone · volume */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="call-output-picker"
            onClick={() => setOutputSheetOpen(true)}
            disabled={!outputSupported && outputs.length === 0}
            aria-label={
              activeDevice
                ? `Perangkat output aktif: ${activeDevice.label}. Ketuk untuk mengganti.`
                : "Pilih perangkat output audio"
            }
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20 disabled:opacity-50"
          >
            <span aria-hidden>{iconForKind(activeKind)}</span>
            <span className="max-w-[7rem] truncate">
              {activeDevice ? labelForKind(activeKind) : "Output"}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>
          <button
            type="button"
            data-testid="call-speakerphone-toggle"
            onClick={() => void toggleSpeakerphone()}
            aria-pressed={activeKind === "speaker"}
            aria-label={
              activeKind === "speaker"
                ? "Matikan speaker keras"
                : "Nyalakan speaker keras"
            }
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${
              activeKind === "speaker"
                ? "bg-white text-black"
                : "bg-white/10 hover:bg-white/20"
            }`}
          >
            <span aria-hidden>🔊</span>
            <span>Speaker</span>
          </button>
          <div className="flex flex-1 items-center gap-2 px-2">
            {volume === 0 ? (
              <VolumeX className="h-4 w-4 text-white/70" />
            ) : volume < 0.5 ? (
              <Volume1 className="h-4 w-4 text-white/70" />
            ) : (
              <Volume2 className="h-4 w-4 text-white/70" />
            )}
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(Number(e.target.value) / 100)}
              data-testid="call-volume-slider"
              aria-label="Volume dalam panggilan"
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-white"
            />
          </div>
        </div>

        <div className="flex items-center justify-center gap-4">
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

        {kind === "video" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-14 w-14 rounded-full bg-white/10"
            onClick={() => void flipCamera()}
            disabled={flipping || !camOn}
            aria-label={facingMode === "user" ? "Tukar ke kamera belakang" : "Tukar ke kamera depan"}
            data-testid="call-flip-camera"
            data-facing={facingMode}
          >
            {flipping ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <SwitchCamera className="h-6 w-6" />
            )}
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

      <Sheet open={outputSheetOpen} onOpenChange={setOutputSheetOpen}>
        <SheetContent side="bottom" className="bg-black text-white">
          <SheetHeader className="text-left">
            <SheetTitle className="text-white">Pilih output audio</SheetTitle>
            <SheetDescription className="text-white/60">
              {outputSupported
                ? "Ketuk perangkat untuk mengalihkan suara panggilan."
                : "Peramban ini tidak mendukung pemilihan output — ubah dari kontrol sistem."}
            </SheetDescription>
          </SheetHeader>
          <ul className="mt-4 space-y-1">
            {outputs.length === 0 ? (
              <li className="rounded-md px-3 py-2 text-sm text-white/60">
                Tidak ada perangkat terdeteksi.
              </li>
            ) : (
              outputs.map((d) => (
                <li key={d.deviceId}>
                  <button
                    type="button"
                    data-testid={`call-output-option-${d.kind}`}
                    onClick={() => {
                      setActiveSinkId(d.deviceId);
                      setOutputSheetOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-white/10 ${
                      d.deviceId === activeSinkId ? "bg-white/10" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{iconForKind(guessDeviceKind(d.label))}</span>
                      <span className="truncate">{d.label}</span>
                    </span>
                    <span className="text-[11px] text-white/50">
                      {labelForKind(d.kind)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}