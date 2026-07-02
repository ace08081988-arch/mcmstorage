import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video as VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { callChannelName, userInboxChannelName, type CallKind, type CallSignal } from "@/lib/webrtc";
import { fetchCall, markEnded } from "@/lib/calls";
import { CallScreen } from "@/components/chat/CallScreen";

/**
 * Host global untuk semua panggilan. Mount sekali di layout
 * `_authenticated` — bertugas:
 *  1. Dengarkan channel inbox pribadi (`user-calls:<uid>`) via Realtime
 *     broadcast. Saat ada `ring`, tampilkan dialog terima/tolak.
 *  2. Terima permintaan panggilan keluar dari komponen lain via
 *     `window.dispatchEvent(new CustomEvent("mcm:start-call", { detail }))`
 *     supaya chat header/tombol dari mana saja bisa memicu tanpa perlu
 *     provider React.
 */

type ActiveCall = {
  callId: string;
  role: "caller" | "callee";
  kind: CallKind;
  peerName: string;
};

type IncomingRing = {
  callId: string;
  kind: CallKind;
  callerName: string;
  conversationId: string;
  callerId: string;
};

export type StartCallDetail = {
  callId: string;
  kind: CallKind;
  peerName: string;
};

const START_CALL_EVENT = "mcm:start-call";

export function dispatchStartCall(detail: StartCallDetail): void {
  window.dispatchEvent(new CustomEvent(START_CALL_EVENT, { detail }));
}

export function CallHost() {
  const [meId, setMeId] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [incoming, setIncoming] = useState<IncomingRing | null>(null);
  const ringingRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setMeId(data.user?.id ?? null);
    });
    return () => { mounted = false; };
  }, []);

  // Inbox: dengarkan ring masuk.
  useEffect(() => {
    if (!meId) return;
    const ch = supabase.channel(userInboxChannelName(meId), {
      config: { broadcast: { self: false, ack: false } },
    });
    ch.on("broadcast", { event: "signal" }, ({ payload }) => {
      const sig = payload as CallSignal;
      if (!sig || sig.t !== "ring") return;
      // Abaikan jika sedang dalam panggilan lain.
      setIncoming((prev) => prev ?? {
        callId: sig.callId,
        kind: sig.kind,
        callerName: sig.callerName || "Pemanggil",
        conversationId: sig.conversationId,
        callerId: sig.from,
      });
    });
    ch.subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [meId]);

  // Outbound: mulai panggilan dari mana saja.
  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<StartCallDetail>).detail;
      if (!detail) return;
      setActive({
        callId: detail.callId,
        role: "caller",
        kind: detail.kind,
        peerName: detail.peerName,
      });
    };
    window.addEventListener(START_CALL_EVENT, onStart as EventListener);
    return () => window.removeEventListener(START_CALL_EVENT, onStart as EventListener);
  }, []);

  // Ringtone sederhana pakai WebAudio (tanpa aset).
  useEffect(() => {
    if (!incoming) return;
    let ctx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    let gain: GainNode | null = null;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 480;
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      // Pola dering: 0.4s on, 0.6s off.
      let on = false;
      const interval = setInterval(() => {
        on = !on;
        if (gain) gain.gain.value = on ? 0.15 : 0;
      }, 500);
      return () => {
        clearInterval(interval);
        try { osc?.stop(); } catch { /* ignore */ }
        try { void ctx?.close(); } catch { /* ignore */ }
      };
    } catch {
      return;
    }
  }, [incoming]);

  // Ack "berdering" ke caller: begitu dialog incoming muncul, callee
  // gabung sebentar ke channel `call:<id>` dan broadcast signal
  // `ringing` supaya CallScreen di sisi caller beralih dari
  // "Memanggil…" → "Berdering…". Diulang beberapa kali untuk mengatasi
  // race saat caller belum sempat subscribe channel-nya.
  useEffect(() => {
    if (!incoming || !meId) return;
    let closed = false;
    const ch = supabase.channel(callChannelName(incoming.callId), {
      config: { broadcast: { self: false, ack: false } },
    });
    const payload: CallSignal = { t: "ringing", from: meId, callId: incoming.callId };
    let ticks = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED" || closed) return;
      void ch.send({ type: "broadcast", event: "signal", payload });
      interval = setInterval(() => {
        ticks += 1;
        void ch.send({ type: "broadcast", event: "signal", payload });
        // Berhenti setelah ±15 detik; caller sudah pasti tahu, atau
        // sudah timeout sendiri.
        if (ticks >= 10) {
          if (interval) clearInterval(interval);
          interval = null;
        }
      }, 1500);
    });
    return () => {
      closed = true;
      if (interval) clearInterval(interval);
      try { void supabase.removeChannel(ch); } catch { /* ignore */ }
    };
  }, [incoming, meId]);

  const acceptIncoming = useCallback(() => {
    if (!incoming) return;
    setActive({
      callId: incoming.callId,
      role: "callee",
      kind: incoming.kind,
      peerName: incoming.callerName,
    });
    setIncoming(null);
  }, [incoming]);

  const declineIncoming = useCallback(async () => {
    if (!incoming) return;
    try {
      const row = await fetchCall(incoming.callId);
      if (row && ["ringing", "accepted"].includes(row.status)) {
        await markEnded(incoming.callId, "declined", { reason: "user-decline" });
      }
    } catch { /* ignore */ }
    setIncoming(null);
  }, [incoming]);

  return (
    <>
      {active ? (
        <CallScreen
          callId={active.callId}
          meId={meId ?? ""}
          role={active.role}
          kind={active.kind}
          peerName={active.peerName}
          onClose={() => setActive(null)}
        />
      ) : null}
      {incoming && !active ? (
        <div className="fixed inset-x-0 top-4 z-[110] mx-auto flex max-w-sm items-center gap-3 rounded-2xl border bg-card p-4 shadow-2xl">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            {incoming.kind === "video" ? <VideoIcon className="h-6 w-6" /> : <Phone className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{incoming.callerName}</div>
            <div className="text-[11px] text-muted-foreground">
              Panggilan {incoming.kind === "video" ? "video" : "suara"} masuk…
            </div>
          </div>
          <Button
            size="icon"
            variant="destructive"
            className="h-10 w-10 rounded-full"
            onClick={() => void declineIncoming()}
            aria-label="Tolak"
          >
            <PhoneOff className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-10 w-10 rounded-full bg-emerald-600 hover:bg-emerald-700"
            onClick={acceptIncoming}
            aria-label="Terima"
          >
            <Phone className="h-4 w-4" />
          </Button>
          <audio ref={ringingRef} />
        </div>
      ) : null}
    </>
  );
}