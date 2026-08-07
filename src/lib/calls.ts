/**
 * State machine + DB helper untuk panggilan Ace Chat.
 *
 * Sengaja tetap client-side (RLS) — user harus login sebagai peserta
 * konversasi untuk membuat/memperbarui row. Signaling media dipisah
 * di `webrtc.ts`.
 */

import { supabase } from "@/integrations/supabase/client";
import type { CallKind } from "@/lib/webrtc";

export type CallStatus =
  | "ringing"
  | "accepted"
  | "declined"
  | "missed"
  | "ended"
  | "cancelled"
  | "failed";

export type CallRow = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string | null;
  kind: CallKind;
  status: CallStatus;
  started_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  duration_sec: number;
  end_reason: string | null;
  created_at: string;
};

export async function createCallRow(opts: {
  conversationId: string;
  callerId: string;
  calleeId: string | null;
  kind: CallKind;
}): Promise<CallRow> {
  const { data, error } = await supabase
    .from("chat_calls")
    .insert({
      conversation_id: opts.conversationId,
      caller_id: opts.callerId,
      callee_id: opts.calleeId,
      kind: opts.kind,
      status: "ringing",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CallRow;
}

export async function markAccepted(callId: string): Promise<void> {
  const { error } = await supabase
    .from("chat_calls")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", callId);
  if (error) throw error;
}

export async function markEnded(
  callId: string,
  status: Extract<CallStatus, "ended" | "declined" | "missed" | "cancelled" | "failed">,
  opts: { acceptedAt?: string | null; reason?: string } = {},
): Promise<void> {
  const now = new Date();
  const accepted = opts.acceptedAt ? new Date(opts.acceptedAt) : null;
  const duration =
    accepted && status === "ended"
      ? Math.max(0, Math.floor((now.getTime() - accepted.getTime()) / 1000))
      : 0;
  const { error } = await supabase
    .from("chat_calls")
    .update({
      status,
      ended_at: now.toISOString(),
      duration_sec: duration,
      end_reason: opts.reason ?? null,
    })
    .eq("id", callId);
  if (error) throw error;
}

export async function fetchCall(callId: string): Promise<CallRow | null> {
  const { data, error } = await supabase
    .from("chat_calls")
    .select("*")
    .eq("id", callId)
    .maybeSingle();
  if (error) throw error;
  return (data as CallRow | null) ?? null;
}

export async function listMyCalls(limit = 50): Promise<CallRow[]> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return [];
  const [callsRes, hiddenRes] = await Promise.all([
    supabase
      .from("chat_calls")
      .select("*")
      .or(`caller_id.eq.${uid},callee_id.eq.${uid}`)
      .order("started_at", { ascending: false })
      .limit(limit),
    supabase.from("chat_call_hidden").select("call_id").eq("user_id", uid),
  ]);
  if (callsRes.error) throw callsRes.error;
  const hidden = new Set(
    ((hiddenRes.data ?? []) as { call_id: string }[]).map((h) => h.call_id),
  );
  return ((callsRes.data ?? []) as CallRow[]).filter((c) => !hidden.has(c.id));
}

/**
 * Sembunyikan (hapus) entri riwayat panggilan untuk user saat ini saja —
 * lawan bicara tetap punya salinan riwayatnya.
 */
export async function hideCalls(callIds: string[]): Promise<void> {
  if (callIds.length === 0) return;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error("Belum login");
  const { error } = await supabase
    .from("chat_call_hidden")
    .upsert(
      callIds.map((call_id) => ({ user_id: uid, call_id })),
      { onConflict: "user_id,call_id" },
    );
  if (error) throw error;
}

/** Kosongkan seluruh riwayat panggilan milik user saat ini. */
export async function hideAllCalls(): Promise<void> {
  const rows = await listMyCalls(500);
  await hideCalls(rows.map((r) => r.id));
}

export function formatCallDuration(sec: number): string {
  if (!sec) return "0 dtk";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s}dtk`;
  return `${s} dtk`;
}