-- Perketat akses tabel turnstile_config
-- RLS sudah membatasi ke admin, tapi kita cabut grant tabel dari anon dan
-- authenticated agar bahkan tanpa RLS pun tidak ada baris yang bocor.
-- Akses admin tetap jalan lewat service_role di server function.
REVOKE ALL ON public.turnstile_config FROM anon;
REVOKE ALL ON public.turnstile_config FROM authenticated;
GRANT ALL ON public.turnstile_config TO service_role;

-- Site key publik tetap dapat dibaca lewat SECURITY DEFINER RPC
-- get_turnstile_site_key() yang sudah ada.
COMMENT ON COLUMN public.turnstile_config.secret_key IS
  'Ciphertext AES-256-GCM (format: enc:v1:<nonce-b64>:<cipher+tag-b64>). '
  'Nilai plaintext lama akan otomatis diupgrade saat pertama kali dibaca server.';