/** Tipe baris buku alamat, dipisah agar bisa di-import tanpa menarik klien Supabase. */
export type AddressBookRow = {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  phone_norm: string | null;
  email: string | null;
  email_norm: string | null;
  source: "device" | "manual" | "app";
  device_contact_id: string | null;
  linked_user_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
