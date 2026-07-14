import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Komponen tipografi reusable untuk halaman detail ecer.
 *
 * Hirarki tetap (jangan ditimpa dengan utility ukuran/berat berbeda):
 * - <EcerTitle>     judul hero / nama judul ecer        text-ms-base sm:text-ms-xl font-bold
 * - <EcerSection>   judul kartu / section               text-ms-sm    font-semibold
 * - <EcerValue>     nilai utama baris detail (angka)    text-ms-sm    font-semibold
 * - <EcerBody>      paragraf / catatan                  text-ms-xs    leading-snug
 * - <EcerMeta>      sub-keterangan kecil di bawah nilai text-ms-2xs leading-snug muted
 * - <EcerLabel>     label kolom (ALL CAPS)              text-ms-2xs uppercase tracking-wider muted
 * - <EcerMono>      kode/ref/ID                         text-ms-2xs font-mono
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
  "break-words text-ms-base font-bold leading-snug sm:text-ms-xl",
);

export const EcerSection = makeText(
  "h3",
  "text-ms-sm font-semibold leading-snug",
);

export const EcerValue = makeText(
  "span",
  "text-ms-sm font-semibold leading-snug text-foreground",
);

export const EcerBody = makeText(
  "p",
  "text-ms-xs leading-snug text-foreground",
);

export const EcerMeta = makeText(
  "span",
  "text-ms-2xs leading-snug text-muted-foreground",
);

export const EcerLabel = makeText(
  "span",
  "text-ms-2xs font-medium uppercase leading-snug tracking-wider text-muted-foreground",
);

export const EcerMono = makeText(
  "span",
  "font-mono text-ms-2xs leading-snug",
);