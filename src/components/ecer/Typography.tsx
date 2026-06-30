import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Komponen tipografi reusable untuk halaman detail ecer.
 *
 * Hirarki tetap (jangan ditimpa dengan utility ukuran/berat berbeda):
 * - <EcerTitle>     judul hero / nama judul ecer        text-base sm:text-xl font-bold
 * - <EcerSection>   judul kartu / section               text-sm    font-semibold
 * - <EcerValue>     nilai utama baris detail (angka)    text-sm    font-semibold
 * - <EcerBody>      paragraf / catatan                  text-xs    leading-snug
 * - <EcerMeta>      sub-keterangan kecil di bawah nilai text-[11px] leading-snug muted
 * - <EcerLabel>     label kolom (ALL CAPS)              text-[11px] uppercase tracking-wider muted
 * - <EcerMono>      kode/ref/ID                         text-[11px] font-mono
 */

type TextProps<T extends React.ElementType> = {
  as?: T;
  className?: string;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

function makeText<DefaultTag extends React.ElementType>(
  defaultTag: DefaultTag,
  baseClass: string,
) {
  return function EcerText<T extends React.ElementType = DefaultTag>({
    as,
    className,
    children,
    ...rest
  }: TextProps<T>) {
    const Tag = (as ?? defaultTag) as React.ElementType;
    return (
      <Tag className={cn(baseClass, className)} {...rest}>
        {children}
      </Tag>
    );
  };
}

export const EcerTitle = makeText(
  "h2",
  "break-words text-base font-bold leading-tight sm:text-xl",
);

export const EcerSection = makeText(
  "h3",
  "text-sm font-semibold leading-snug",
);

export const EcerValue = makeText(
  "span",
  "text-sm font-semibold leading-snug text-foreground",
);

export const EcerBody = makeText(
  "p",
  "text-xs leading-snug text-foreground",
);

export const EcerMeta = makeText(
  "span",
  "text-[11px] leading-snug text-muted-foreground",
);

export const EcerLabel = makeText(
  "span",
  "text-[11px] font-medium uppercase leading-snug tracking-wider text-muted-foreground",
);

export const EcerMono = makeText(
  "span",
  "font-mono text-[11px] leading-snug",
);