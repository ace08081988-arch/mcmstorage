import { Capacitor } from "@capacitor/core";

export type ImportedContact = {
  /** Stable id from device when available; else synthesized hash. */
  device_contact_id: string;
  name: string;
  phones: string[];
  emails: string[];
};

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function hashId(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "w_" + (h >>> 0).toString(36);
}

/**
 * Pick contacts from the device.
 * - Native (Android via @capacitor-community/contacts): meminta izin, lalu
 *   mengambil seluruh kontak dengan nomor/email.
 * - Web (Chrome Android): pakai Contact Picker API; jika tak tersedia,
 *   melempar error agar pemanggil bisa menampilkan pesan ramah.
 */
export async function pickDeviceContacts(): Promise<ImportedContact[]> {
  if (isNative()) {
    // Dynamic import keeps web bundle clean and SSR-safe.
    const mod = await import("@capacitor-community/contacts");
    const Contacts = (mod as any).Contacts;
    const perm = await Contacts.requestPermissions();
    const granted =
      perm?.contacts === "granted" ||
      perm?.granted === true ||
      perm?.contacts?.toLowerCase?.() === "granted";
    if (!granted) throw new Error("Izin akses kontak ditolak di perangkat.");
    const res = await Contacts.getContacts({
      projection: { name: true, phones: true, emails: true },
    });
    const list: any[] = res?.contacts ?? [];
    return list
      .map((c) => {
        const name =
          c?.name?.display ||
          [c?.name?.given, c?.name?.family].filter(Boolean).join(" ") ||
          c?.organization?.company ||
          c?.phones?.[0]?.number ||
          "(Tanpa nama)";
        const phones: string[] = (c?.phones ?? [])
          .map((p: any) => String(p?.number ?? "").trim())
          .filter((s: string) => s.length > 0);
        const emails: string[] = (c?.emails ?? [])
          .map((e: any) => String(e?.address ?? "").trim())
          .filter((s: string) => s.length > 0);
        const id = String(c?.contactId ?? c?.id ?? hashId(name + phones.join(",")));
        return { device_contact_id: id, name, phones, emails };
      })
      .filter((c) => c.phones.length > 0 || c.emails.length > 0);
  }

  // Web fallback: Chromium Android only.
  const nav = globalThis.navigator as any;
  if (!nav?.contacts?.select) {
    throw new Error(
      "Akses kontak perangkat tidak tersedia di browser ini. Buka aplikasi MCM Storage di Android.",
    );
  }
  const supported: string[] = (await nav.contacts.getProperties?.()) ?? [
    "name",
    "tel",
    "email",
  ];
  const props = ["name", "tel", "email"].filter((p) => supported.includes(p));
  const list: any[] = await nav.contacts.select(props, { multiple: true });
  return list
    .map((c) => {
      const name = (c?.name?.[0] as string) || (c?.tel?.[0] as string) || "(Tanpa nama)";
      const phones: string[] = (c?.tel ?? []).map((s: string) => s.trim()).filter(Boolean);
      const emails: string[] = (c?.email ?? []).map((s: string) => s.trim()).filter(Boolean);
      return {
        device_contact_id: hashId(name + "|" + phones.join(",") + "|" + emails.join(",")),
        name,
        phones,
        emails,
      };
    })
    .filter((c) => c.phones.length > 0 || c.emails.length > 0);
}

export function deviceContactsSupported(): "native" | "web" | "unsupported" {
  if (isNative()) return "native";
  const nav = globalThis.navigator as any;
  if (nav?.contacts?.select) return "web";
  return "unsupported";
}