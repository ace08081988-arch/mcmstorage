/**
 * Regresi: pemulihan panggilan setelah "network hiccup" (WiFi ↔ seluler).
 *
 * Bug asli: handler signal `answer` hanya menerima SDP saat
 * `pc.currentRemoteDescription` masih kosong, sehingga answer hasil ICE
 * restart (negosiasi kedua) dibuang. Caller tersangkut di
 * "have-local-offer" dengan kredensial ICE tidak cocok → panggilan gagal.
 *
 * Test ini memakai RTCPeerConnection tiruan yang meniru aturan state
 * machine WebRTC (answer hanya sah saat have-local-offer, rollback saat
 * glare) dan menyuntik signal lewat channel Supabase tiruan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Desc = RTCSessionDescriptionInit & { ufrag?: string };
type SignalHandler = (msg: { payload: unknown }) => void | Promise<void>;

const sent: unknown[] = [];
let signalHandler: SignalHandler | null = null;

const channelMock = {
  on: (_type: string, _filter: unknown, cb: SignalHandler) => {
    signalHandler = cb;
    return channelMock;
  },
  subscribe: (cb: (status: string) => void) => {
    cb("SUBSCRIBED");
    return channelMock;
  },
  send: (msg: unknown) => {
    sent.push(msg);
    return Promise.resolve("ok");
  },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => channelMock,
    removeChannel: () => Promise.resolve("ok"),
  },
}));

vi.mock("@/lib/calls.functions", () => ({
  getIceServers: async () => ({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    turnConfigured: false,
  }),
}));

/** RTCPeerConnection tiruan dengan aturan state machine yang relevan. */
class FakePC {
  signalingState: RTCSignalingState = "stable";
  iceConnectionState: RTCIceConnectionState = "new";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: Desc | null = null;
  currentRemoteDescription: Desc | null = null;
  pendingLocalDescription: Desc | null = null;
  ontrack: unknown = null;
  onicecandidate: unknown = null;
  oniceconnectionstatechange: (() => void) | null = null;
  private ufragSeq = 0;
  restarts = 0;

  addTrack() { return {}; }
  getSenders() { return []; }
  close() { this.connectionState = "closed"; }

  async createOffer(opts?: RTCOfferOptions): Promise<Desc> {
    if (opts?.iceRestart) this.restarts += 1;
    this.ufragSeq += 1;
    return { type: "offer", sdp: `offer-${this.ufragSeq}`, ufrag: `u${this.ufragSeq}` };
  }
  async createAnswer(): Promise<Desc> {
    const u = this.currentRemoteDescription?.ufrag ?? "u0";
    return { type: "answer", sdp: `answer-for-${u}`, ufrag: u };
  }
  async setLocalDescription(desc: Desc) {
    if (desc.type === "rollback") {
      if (this.signalingState !== "have-local-offer") {
        throw new Error("InvalidStateError: rollback tanpa local offer");
      }
      this.signalingState = "stable";
      this.localDescription = this.currentRemoteDescription ? this.localDescription : null;
      return;
    }
    this.localDescription = desc;
    this.signalingState = desc.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(desc: Desc) {
    if (desc.type === "answer" && this.signalingState !== "have-local-offer") {
      throw new Error("InvalidStateError: answer di state " + this.signalingState);
    }
    this.currentRemoteDescription = desc;
    this.signalingState = desc.type === "offer" ? "have-remote-offer" : "stable";
  }
  async addIceCandidate() { /* noop */ }
}

let pc: FakePC;

function installGlobals() {
  pc = new FakePC();
  vi.stubGlobal("RTCPeerConnection", function () { return pc; } as unknown as typeof RTCPeerConnection);
  vi.stubGlobal("MediaStream", class { getTracks() { return []; } getAudioTracks() { return []; } getVideoTracks() { return []; } addTrack() {} });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [],
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      }),
    },
  });
}

async function emit(payload: unknown) {
  if (!signalHandler) throw new Error("handler signal belum terpasang");
  await signalHandler({ payload });
}

function lastSignalOfType(t: string) {
  const found = [...sent]
    .reverse()
    .find((m) => (m as { payload?: { t?: string } })?.payload?.t === t);
  return (found as { payload?: Record<string, unknown> } | undefined)?.payload;
}

describe("webrtc — ICE restart setelah network hiccup", () => {
  beforeEach(() => {
    sent.length = 0;
    signalHandler = null;
    installGlobals();
  });

  it("caller: answer hasil ICE restart diterima meski sudah ada remote description dari negosiasi pertama", async () => {
    const { createPeerSession, startOffer, restartIce } = await import("@/lib/webrtc");
    const session = await createPeerSession({
      callId: "call-1",
      meId: "me",
      kind: "audio",
      handlers: { onRemoteStream: () => {} },
    });

    // Negosiasi pertama: offer → answer.
    await startOffer(session);
    const offer1 = lastSignalOfType("offer") as { sdp: Desc };
    expect(pc.signalingState).toBe("have-local-offer");
    await emit({ t: "answer", from: "peer", sdp: { type: "answer", sdp: "answer-1", ufrag: offer1.sdp.ufrag } });
    expect(pc.signalingState).toBe("stable");
    expect(pc.currentRemoteDescription?.sdp).toBe("answer-1");

    // Hiccup jaringan → ICE restart.
    await restartIce(session);
    expect(pc.restarts).toBe(1);
    expect(pc.signalingState).toBe("have-local-offer");
    const offer2 = lastSignalOfType("offer") as { sdp: Desc };
    expect(offer2.sdp.ufrag).not.toBe(offer1.sdp.ufrag);

    // Answer kedua WAJIB diterima (regresi: dulu dibuang oleh guard
    // `currentRemoteDescription`).
    await emit({ t: "answer", from: "peer", sdp: { type: "answer", sdp: "answer-2", ufrag: offer2.sdp.ufrag } });
    expect(pc.signalingState).toBe("stable");
    expect(pc.currentRemoteDescription?.sdp).toBe("answer-2");
    expect(pc.currentRemoteDescription?.ufrag).toBe(offer2.sdp.ufrag);
  });

  it("callee: offer ICE restart saat stable dijawab dengan answer baru", async () => {
    const { createPeerSession } = await import("@/lib/webrtc");
    await createPeerSession({
      callId: "call-2",
      meId: "me",
      kind: "audio",
      handlers: { onRemoteStream: () => {} },
    });

    await emit({ t: "offer", from: "peer", sdp: { type: "offer", sdp: "offer-a", ufrag: "uA" } });
    expect(lastSignalOfType("answer")).toMatchObject({ t: "answer" });
    expect(pc.signalingState).toBe("stable");

    // Offer kedua (restart) setelah hiccup.
    await emit({ t: "offer", from: "peer", sdp: { type: "offer", sdp: "offer-b", ufrag: "uB" } });
    const answer = lastSignalOfType("answer") as { sdp: Desc };
    expect(answer.sdp.sdp).toBe("answer-for-uB");
    expect(pc.signalingState).toBe("stable");
  });

  it("glare: offer restart yang datang saat kita punya local offer di-rollback, bukan error", async () => {
    const errors: Error[] = [];
    const { createPeerSession, restartIce } = await import("@/lib/webrtc");
    const session = await createPeerSession({
      callId: "call-3",
      meId: "me",
      kind: "audio",
      handlers: { onRemoteStream: () => {}, onError: (e) => errors.push(e) },
    });

    await restartIce(session);
    expect(pc.signalingState).toBe("have-local-offer");

    await emit({ t: "offer", from: "peer", sdp: { type: "offer", sdp: "offer-glare", ufrag: "uG" } });
    expect(errors).toHaveLength(0);
    expect(pc.signalingState).toBe("stable");
    const answer = lastSignalOfType("answer") as { sdp: Desc };
    expect(answer.sdp.sdp).toBe("answer-for-uG");
  });

  it("restartIce tidak melakukan apa-apa saat koneksi sudah ditutup", async () => {
    const { createPeerSession, restartIce } = await import("@/lib/webrtc");
    const session = await createPeerSession({
      callId: "call-4",
      meId: "me",
      kind: "audio",
      handlers: { onRemoteStream: () => {} },
    });
    pc.connectionState = "closed";
    await restartIce(session);
    expect(pc.restarts).toBe(0);
    expect(lastSignalOfType("offer")).toBeUndefined();
  });
});