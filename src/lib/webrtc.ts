/**
 * WebRTC helper untuk MCM Chat — panggilan 1‑ke‑1 (DM).
 *
 * Signaling berjalan lewat Supabase Realtime *broadcast* di channel
 * `call:<callId>`. Kedua peserta bergabung ke channel yang sama, pihak
 * yang membuat panggilan mengirim SDP offer, pihak yang menerima
 * mengirim SDP answer, keduanya saling menukar ICE candidate.
 *
 * Kebijakan penting:
 * - Simpan referensi channel & RTCPeerConnection agar bisa di-teardown
 *   sepenuhnya saat panggilan berakhir (mencegah leak stream & mic).
 * - Semua track lokal (mic/kamera) dihentikan di `close()` supaya
 *   indikator kamera OS ikut mati.
 */

import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getIceServers, type IceServerConfig } from "@/lib/calls.functions";

export type CallKind = "audio" | "video";

export type CallSignal =
  | { t: "offer"; sdp: RTCSessionDescriptionInit; from: string }
  | { t: "answer"; sdp: RTCSessionDescriptionInit; from: string }
  | { t: "ice"; candidate: RTCIceCandidateInit; from: string }
  | { t: "bye"; from: string; reason?: string }
  | { t: "ringing"; from: string; callId: string }
  | { t: "hello"; from: string; callId: string }
  | { t: "ring"; from: string; callId: string; kind: CallKind; conversationId: string; callerName?: string };

// Fallback STUN publik saat server function belum bisa dihubungi (mis.
// dev offline). Nilai "sesungguhnya" datang dari `getIceServers()` di
// bawah yang juga menyertakan TURN bila secret tersedia.
const FALLBACK_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

let cachedIce:
  | { servers: IceServerConfig[]; turnConfigured: boolean; at: number }
  | null = null;

/**
 * Ambil daftar ICE server (STUN + TURN) dari server function, dengan
 * cache 5 menit supaya panggilan berikutnya tidak menunggu round-trip
 * jaringan. Fallback ke STUN publik saat request gagal.
 */
export async function loadIceServers(): Promise<{
  servers: IceServerConfig[];
  turnConfigured: boolean;
}> {
  const now = Date.now();
  if (cachedIce && now - cachedIce.at < 5 * 60_000) {
    return { servers: cachedIce.servers, turnConfigured: cachedIce.turnConfigured };
  }
  try {
    const res = await getIceServers();
    cachedIce = {
      servers: res.iceServers,
      turnConfigured: res.turnConfigured,
      at: now,
    };
    return { servers: res.iceServers, turnConfigured: res.turnConfigured };
  } catch {
    return { servers: FALLBACK_ICE, turnConfigured: false };
  }
}

export function callChannelName(callId: string): string {
  return `call:${callId}`;
}

export function userInboxChannelName(userId: string): string {
  return `user-calls:${userId}`;
}

export type PeerHandlers = {
  onRemoteStream: (stream: MediaStream) => void;
  onIceState?: (state: RTCIceConnectionState) => void;
  onError?: (err: Error) => void;
  /** Callee sudah menerima ring & menampilkan dialog — caller boleh
   *  beralih dari "Memanggil…" ke "Berdering…". */
  onRingingAck?: () => void;
  /** Callee sudah subscribe channel `call:<id>` — caller boleh mengirim offer. */
  onPeerHello?: () => void;
  /** Diberitahu apakah TURN aktif; UI boleh menampilkan banner "atur TURN". */
  onTurnStatus?: (turnConfigured: boolean) => void;
};

export type PeerSession = {
  pc: RTCPeerConnection;
  channel: RealtimeChannel;
  localStream: MediaStream;
  callId: string;
  meId: string;
  close: (reason?: string) => Promise<void>;
  sendBye: (reason?: string) => void;
  sendRinging: () => void;
  toggleAudio: (enabled: boolean) => void;
  toggleVideo: (enabled: boolean) => void;
};

async function getLocalMedia(kind: CallKind): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video:
      kind === "video"
        ? {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          }
        : false,
  };
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Perangkat/browser tidak mendukung panggilan.");
  }
  return await navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * Buat RTCPeerConnection + gabung channel signaling. Tidak memulai
 * offer/answer secara otomatis — pemanggil menjalankan `startOffer`,
 * penerima menjalankan `acceptOffer`.
 */
export async function createPeerSession(opts: {
  callId: string;
  meId: string;
  kind: CallKind;
  handlers: PeerHandlers;
}): Promise<PeerSession> {
  const { callId, meId, kind, handlers } = opts;
  const localStream = await getLocalMedia(kind);
  const ice = await loadIceServers();
  handlers.onTurnStatus?.(ice.turnConfigured);
  const pc = new RTCPeerConnection({ iceServers: ice.servers });
  const remote = new MediaStream();

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.ontrack = (ev) => {
    ev.streams[0]?.getTracks().forEach((t) => {
      if (!remote.getTracks().some((x) => x.id === t.id)) remote.addTrack(t);
    });
    handlers.onRemoteStream(remote);
  };

  pc.oniceconnectionstatechange = () => {
    handlers.onIceState?.(pc.iceConnectionState);
  };

  const channel = supabase.channel(callChannelName(callId), {
    config: { broadcast: { self: false, ack: false } },
  });

  const send = (payload: CallSignal) => {
    try {
      void channel.send({ type: "broadcast", event: "signal", payload });
    } catch (e) {
      handlers.onError?.(e as Error);
    }
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      send({ t: "ice", from: meId, candidate: ev.candidate.toJSON() });
    }
  };

  channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
    const sig = payload as CallSignal;
    if (!sig || sig.from === meId) return;
    try {
      if (sig.t === "offer") {
        await pc.setRemoteDescription(sig.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ t: "answer", from: meId, sdp: answer });
      } else if (sig.t === "answer") {
        if (!pc.currentRemoteDescription) await pc.setRemoteDescription(sig.sdp);
      } else if (sig.t === "ice") {
        try { await pc.addIceCandidate(sig.candidate); } catch { /* candidate stale */ }
      } else if (sig.t === "bye") {
        handlers.onError?.(new Error(sig.reason ?? "Panggilan diakhiri"));
      } else if (sig.t === "ringing") {
        handlers.onRingingAck?.();
      } else if (sig.t === "hello") {
        handlers.onPeerHello?.();
      }
    } catch (e) {
      handlers.onError?.(e as Error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Signaling timeout")), 8000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        // Umumkan kehadiran diri di channel supaya sisi lain bisa
        // memicu resend offer / update state tanpa bergantung DB polling.
        try {
          send({ t: "hello", from: meId, callId });
        } catch { /* ignore */ }
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer); reject(new Error("Signaling gagal"));
      }
    });
  });

  const close = async (reason?: string) => {
    try { send({ t: "bye", from: meId, reason }); } catch { /* ignore */ }
    try { pc.getSenders().forEach((s) => { try { s.track?.stop(); } catch { /* ignore */ } }); } catch { /* ignore */ }
    try { localStream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { pc.close(); } catch { /* ignore */ }
    try { await supabase.removeChannel(channel); } catch { /* ignore */ }
  };

  return {
    pc,
    channel,
    localStream,
    callId,
    meId,
    close,
    sendBye: (reason?: string) => send({ t: "bye", from: meId, reason }),
    /** Callee: kirim ack "sedang berdering" ke channel panggilan. */
    sendRinging: () => send({ t: "ringing", from: meId, callId }),
    toggleAudio: (enabled: boolean) => {
      localStream.getAudioTracks().forEach((t) => { t.enabled = enabled; });
    },
    toggleVideo: (enabled: boolean) => {
      localStream.getVideoTracks().forEach((t) => { t.enabled = enabled; });
    },
  };
}

/**
 * Pemanggil: buat SDP offer & kirim, lalu resend ulang selama callee
 * belum menjawab (maks 3× tiap 2 detik). Idempoten — panggilan berulang
 * setelah SDP sudah di-set aman karena kita cek `signalingState`.
 */
export async function startOffer(session: PeerSession): Promise<void> {
  const { pc, channel, meId } = session;
  if (pc.signalingState !== "stable" && pc.localDescription) {
    // Sudah ada offer lokal — cukup resend payload terakhir sekali lagi.
    void channel.send({
      type: "broadcast",
      event: "signal",
      payload: {
        t: "offer",
        from: meId,
        sdp: pc.localDescription as RTCSessionDescriptionInit,
      } satisfies CallSignal,
    });
    return;
  }
  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await pc.setLocalDescription(offer);
  const payload: CallSignal = { t: "offer", from: meId, sdp: offer };
  const sendOffer = () => {
    try {
      void channel.send({ type: "broadcast", event: "signal", payload });
    } catch {
      /* ignore */
    }
  };
  sendOffer();
  // Resend beberapa kali untuk menutup race saat callee baru subscribe
  // setelah menerima panggilan; berhenti begitu remote description sudah
  // masuk (answer diterima) atau maksimum percobaan tercapai.
  let tries = 0;
  const interval = setInterval(() => {
    tries += 1;
    if (
      pc.signalingState !== "have-local-offer" ||
      pc.currentRemoteDescription ||
      tries >= 3
    ) {
      clearInterval(interval);
      return;
    }
    sendOffer();
  }, 2000);
}

/** Kirim ring ke inbox pribadi callee agar UI global memunculkan dialog. */
export async function ringUser(opts: {
  calleeId: string;
  callId: string;
  callerId: string;
  kind: CallKind;
  conversationId: string;
  callerName?: string;
}): Promise<void> {
  const ch = supabase.channel(userInboxChannelName(opts.calleeId), {
    config: { broadcast: { self: false, ack: false } },
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Ring timeout")), 5000);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timer); reject(new Error("Ring gagal"));
      }
    });
  });
  await ch.send({
    type: "broadcast",
    event: "signal",
    payload: {
      t: "ring",
      from: opts.callerId,
      callId: opts.callId,
      kind: opts.kind,
      conversationId: opts.conversationId,
      callerName: opts.callerName,
    } satisfies CallSignal,
  });
  // Beri waktu payload ke server sebelum ditutup di sisi caller.
  setTimeout(() => { void supabase.removeChannel(ch); }, 1500);
}