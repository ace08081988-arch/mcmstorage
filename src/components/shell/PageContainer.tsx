/**
 * Wrapper `<main>` untuk halaman "aplikasi" — memastikan max-width,
 * gutter, dan spacing vertikal antar section KONSISTEN di seluruh
 * halaman. Nilai default:
 *   - mobile: max-w-3xl · px-ms-4 · py-ms-5 · space-ms-5
 *   - md+  : max-w-4xl · p-ms-6
 *
 * Semua halaman aplikasi yang punya header sticky di atas wajib
 * memakai PageContainer supaya tidak drift saat pindah tab/halaman.
 */
import type { ReactNode } from "react";

export interface PageContainerProps {
  children: ReactNode;
  className?: string;
  /** aria-labelledby / aria-label opsional. */
  ariaLabel?: string;
}

export function PageContainer({ children, className, ariaLabel }: PageContainerProps) {
  return (
    <main
      aria-label={ariaLabel}
      className={`mx-auto max-w-3xl space-ms-5 px-ms-4 py-ms-5 md:max-w-4xl md:p-ms-6 ${className ?? ""}`}
    >
      {children}
    </main>
  );
}