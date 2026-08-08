/**
 * Tautan "Lewati ke konten" — elemen fokus pertama di halaman sehingga
 * pengguna keyboard bisa langsung melompat ke <main id="konten-utama">
 * tanpa menekan Tab berulang kali melewati navigasi.
 * Tersembunyi secara visual sampai menerima fokus keyboard.
 */
export function SkipToContent({ targetId = "konten-utama" }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      onClick={(e) => {
        // Pindahkan fokus (bukan hanya scroll) supaya Tab berikutnya
        // melanjutkan dari dalam konten utama.
        const el = document.getElementById(targetId);
        if (!el) return;
        e.preventDefault();
        el.setAttribute("tabindex", "-1");
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "start", behavior: "smooth" });
      }}
      className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-2 focus-visible:top-2 focus-visible:z-[60] focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-ms-3 focus-visible:py-2 focus-visible:text-ms-sm focus-visible:font-medium focus-visible:text-primary-foreground focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      Lewati ke konten
    </a>
  );
}

export default SkipToContent;
