import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

export type UploadedAttachment = {
  path: string;
  mime: string;
  name: string;
  size: number;
};

const MAX_BYTES = 30 * 1024 * 1024; // 30 MB per file

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file";
}

export async function uploadChatFile(opts: {
  conversationId: string;
  file: File | Blob;
  filename?: string;
  mime?: string;
}): Promise<UploadedAttachment> {
  const { conversationId, file } = opts;
  const mime = opts.mime || (file as File).type || "application/octet-stream";
  const baseName = opts.filename || (file as File).name || `file_${Date.now()}`;
  const size = (file as File).size ?? (file as Blob).size ?? 0;
  if (size > MAX_BYTES) throw new Error("File terlalu besar (maks 30MB).");

  const ext = baseName.includes(".") ? baseName.split(".").pop() : (mime.split("/")[1] ?? "bin");
  const safe = sanitize(baseName.replace(/\.[^.]+$/, ""));
  const path = `${conversationId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}.${ext}`;

  const { error } = await supabase.storage
    .from("chat-attachments")
    .upload(path, file, { contentType: mime, upsert: false });
  if (error) throw error;

  return { path, mime, name: baseName, size };
}

export async function signedChatUrl(path: string, expiresInSec = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrl(path, expiresInSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Capture a photo / video from camera or gallery via Capacitor when available. */
export async function pickFromCamera(opts: { video?: boolean } = {}): Promise<File | null> {
  if (!Capacitor.isNativePlatform()) {
    return pickViaInput({ accept: opts.video ? "video/*" : "image/*", capture: true });
  }
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const res = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 80,
    });
    if (!res.webPath) return null;
    const r = await fetch(res.webPath);
    const blob = await r.blob();
    const ext = res.format || "jpg";
    return new File([blob], `camera_${Date.now()}.${ext}`, { type: blob.type || `image/${ext}` });
  } catch (e) {
    if ((e as { message?: string })?.message?.toLowerCase().includes("cancel")) return null;
    throw e;
  }
}

export function pickViaInput(opts: { accept: string; multiple?: boolean; capture?: boolean }): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = opts.accept;
    if (opts.multiple) inp.multiple = true;
    if (opts.capture) inp.setAttribute("capture", "environment");
    inp.onchange = () => {
      const f = inp.files?.[0] ?? null;
      resolve(f);
    };
    inp.oncancel = () => resolve(null);
    inp.click();
  });
}

export function pickMultipleViaInput(opts: { accept: string }): Promise<File[]> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = opts.accept;
    inp.multiple = true;
    inp.onchange = () => resolve(Array.from(inp.files ?? []));
    inp.oncancel = () => resolve([]);
    inp.click();
  });
}