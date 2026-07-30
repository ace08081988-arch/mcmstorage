import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Container halaman standar — satu-satunya sumber untuk padding, lebar maksimum,
 * dan jarak antar section di seluruh halaman. Pakai ini alih-alih menulis
 * `mx-auto w-full max-w-… p-… space-y-…` manual supaya alignment konsisten.
 */
const widthMap = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-4xl",
  xl: "max-w-5xl",
  full: "max-w-6xl",
} as const;

const gapMap = {
  tight: "space-ms-3",
  normal: "space-ms-4 sm:space-ms-5",
  loose: "space-ms-5 sm:space-ms-6",
} as const;

export type PageContainerProps = React.HTMLAttributes<HTMLElement> & {
  /** Lebar maksimum konten. Default `md` (max-w-3xl). */
  width?: keyof typeof widthMap;
  /** Jarak vertikal antar anak langsung. Default `normal`. */
  gap?: keyof typeof gapMap;
  /** Elemen HTML pembungkus. Default `main`. */
  as?: "main" | "div" | "section";
  /** Ruang bawah ekstra untuk action bar mobile. */
  bottomSafe?: boolean;
};

export const PageContainer = React.forwardRef<HTMLElement, PageContainerProps>(
  (
    { className, width = "md", gap = "normal", as = "main", bottomSafe = false, ...props },
    ref,
  ) => {
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref}
        className={cn(
          "mx-auto w-full px-ms-4 py-ms-4 sm:px-ms-6 sm:py-ms-6",
          widthMap[width],
          gapMap[gap],
          bottomSafe && "pb-24",
          className,
        )}
        {...props}
      />
    );
  },
);
PageContainer.displayName = "PageContainer";

export default PageContainer;