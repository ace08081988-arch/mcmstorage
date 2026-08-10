-- Sprint 2 mencabut EXECUTE dari PUBLIC secara menyeluruh. Dua fungsi ini
-- murni fungsi teks (IMMUTABLE, tanpa akses tabel) dan dipakai oleh
-- pemeriksaan paritas klien-vs-database, jadi aman dibuka kembali.
GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_email(text) TO PUBLIC;