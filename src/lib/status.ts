import { supabase } from "@/integrations/supabase/client";

export const STATUS_BUCKET = "statuses";

export type StatusRow = {
  id: string;
  user_id: string;
  media_url: string;
  media_path: string;
  media_type: "image" | "video" | "text";
  caption: string | null;
  bg_color: string | null;
  created_at: string;
  expires_at: string;
};

export type StatusCommentRow = {
  id: string;
  status_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export async function statusSignedUrl(
  path: string,
  expiresIn = 60 * 60 * 6,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from(STATUS_BUCKET)
    .createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

/** Upload media (image/video) untuk status. */
export async function uploadStatusMedia(
  userId: string,
  file: Blob,
  ext: string,
): Promise<string | null> {
  const path = `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage
    .from(STATUS_BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) {
    console.error("[status] upload failed", error);
    return null;
  }
  return path;
}

export async function listActiveStatuses(): Promise<StatusRow[]> {
  const { data, error } = await supabase
    .from("statuses")
    .select("*")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[status] list failed", error);
    return [];
  }
  return (data ?? []) as StatusRow[];
}

export async function getStatus(id: string): Promise<StatusRow | null> {
  const { data, error } = await supabase
    .from("statuses")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[status] get failed", error);
    return null;
  }
  return (data as StatusRow) ?? null;
}

export async function insertStatus(row: {
  media_url: string;
  media_path: string;
  media_type: StatusRow["media_type"];
  caption?: string | null;
  bg_color?: string | null;
}): Promise<StatusRow | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("statuses")
    .insert({
      user_id: uid,
      media_url: row.media_url,
      media_path: row.media_path,
      media_type: row.media_type,
      caption: row.caption ?? null,
      bg_color: row.bg_color ?? null,
    })
    .select("*")
    .single();
  if (error) {
    console.error("[status] insert failed", error);
    return null;
  }
  return data as StatusRow;
}

export async function deleteStatus(id: string, path: string): Promise<boolean> {
  const { error } = await supabase.from("statuses").delete().eq("id", id);
  if (error) {
    console.error("[status] delete failed", error);
    return false;
  }
  await supabase.storage.from(STATUS_BUCKET).remove([path]).catch(() => undefined);
  return true;
}

// ============ Likes ============
export async function getLikeCounts(
  statusIds: string[],
): Promise<Map<string, number>> {
  if (statusIds.length === 0) return new Map();
  const { data } = await supabase
    .from("status_likes")
    .select("status_id")
    .in("status_id", statusIds);
  const m = new Map<string, number>();
  for (const r of data ?? []) {
    m.set(r.status_id as string, (m.get(r.status_id as string) ?? 0) + 1);
  }
  return m;
}

export async function hasLiked(statusId: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return false;
  const { data } = await supabase
    .from("status_likes")
    .select("status_id")
    .eq("status_id", statusId)
    .eq("user_id", uid)
    .maybeSingle();
  return !!data;
}

export async function toggleLike(statusId: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return false;
  const already = await hasLiked(statusId);
  if (already) {
    await supabase
      .from("status_likes")
      .delete()
      .eq("status_id", statusId)
      .eq("user_id", uid);
    return false;
  }
  await supabase.from("status_likes").insert({ status_id: statusId, user_id: uid });
  return true;
}

// ============ Comments ============
export async function listComments(statusId: string): Promise<StatusCommentRow[]> {
  const { data, error } = await supabase
    .from("status_comments")
    .select("*")
    .eq("status_id", statusId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) {
    console.error("[status] comments failed", error);
    return [];
  }
  return (data ?? []) as StatusCommentRow[];
}

export async function addComment(
  statusId: string,
  body: string,
): Promise<StatusCommentRow | null> {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("status_comments")
    .insert({ status_id: statusId, user_id: uid, body: trimmed })
    .select("*")
    .single();
  if (error) {
    console.error("[status] add comment failed", error);
    return null;
  }
  return data as StatusCommentRow;
}

export async function deleteComment(id: string): Promise<boolean> {
  const { error } = await supabase.from("status_comments").delete().eq("id", id);
  return !error;
}

/** Unduh media status ke perangkat via anchor download. */
export async function downloadStatus(
  path: string,
  filenameHint?: string,
): Promise<boolean> {
  const { data, error } = await supabase.storage
    .from(STATUS_BUCKET)
    .download(path);
  if (error || !data) {
    console.error("[status] download failed", error);
    return false;
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameHint || path.split("/").pop() || "status";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}