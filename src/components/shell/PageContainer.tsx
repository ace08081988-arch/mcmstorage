/**
 * Wrapper `<main>` untuk halaman "aplikasi" — satu sumber untuk max-width,
 * gutter, dan spacing vertikal antar section. Gutter/spacing didelegasikan
 * ke `@/components/layout/PageContainer` supaya nilainya identik dengan
 * container generik dan tidak ada dua skala padding yang bersaing.
 *
 * Nilai efektif:
 *   - mobile: max-w-3xl · px-ms-4 · py-ms-4 · space-ms-4
 *   - sm+   : px-ms-6 · py-ms-6 · space-ms-5
 *   - md+   : max-w-4xl
 */
import type { ReactNode } from "react";
import { PageContainer as BasePageContainer } from "@/components/layout/PageContainer";

export interface PageContainerProps {
  children: ReactNode;
  className?: string;
  /** aria-labelledby / aria-label opsional. */
  ariaLabel?: string;
}

export function PageContainer({ children, className, ariaLabel }: PageContainerProps) {
  return (
    <BasePageContainer
      aria-label={ariaLabel}
      width="md"
      className={`md:max-w-4xl ${className ?? ""}`}
    >
      {children}
    </BasePageContainer>
  );
}