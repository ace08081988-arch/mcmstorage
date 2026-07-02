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

export type CallKind = "audio" | "video";

export type CallSignal =
  | { t: "offer"; sdp: RTCSessionDescriptionInit; from: string }
  | { t: "answer"; sdp: RTCSessionDescriptionInit; from: string }
  | { t: "ice"; candidate: RTCIceCandidateInit; from: string }
  | { t: "bye"; from: string; reason?: string }
  | { t: "ringing"; from: string; callId: string }
  | { t: "ring"; from: string; callId: string; kind: CallKind; conversationId: string; callerName?: string };

// STUN publik Google — cukup untuk 90% kasus di jaringan seluler /
// Wi-Fi rumah. TURN belum dikonfigurasi; jika NAT simetris, panggilan
// bisa gagal — UI akan menampilkan status "Gagal terhubung".
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

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
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
      }
    } catch (e) {
      handlers.onError?.(e as Error);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Signaling timeout")), 8000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
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

/** Pemanggil: buat SDP offer & kirim. */
export async function startOffer(session: PeerSession): Promise<void> {
  const offer = await session.pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await session.pc.setLocalDescription(offer);
  session.channel.send({
    type: "broadcast",
    event: "signal",
    payload: { t: "offer", from: session.meId, sdp: offer } satisfies CallSignal,
  });
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