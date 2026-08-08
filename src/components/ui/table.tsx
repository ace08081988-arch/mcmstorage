import * as React from "react";

import { cn } from "@/lib/utils";

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /** Class tambahan untuk container scroll (bukan elemen <table>). */
  containerClassName?: string;
  /**
   * Tinggi maksimum area scroll. Kalau diisi, body tabel bisa di-scroll
   * vertikal sementara header tetap menempel di atas (sticky).
   */
  maxHeight?: number | string;
};

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, maxHeight, style, ...props }, ref) => (
    // `overflow-auto` + momentum scrolling (`overflow-scrolling: touch` via
    // `[-webkit-overflow-scrolling:touch]`) supaya tabel lebar bisa digeser
    // halus di HP. `overscroll-contain` menahan gesture supaya tidak
    // memicu back-swipe browser saat sedang scroll horizontal.
    <div
      data-table-scroll=""
      className={cn(
        "relative w-full overflow-auto overscroll-contain scroll-smooth",
        "[-webkit-overflow-scrolling:touch] [scrollbar-width:thin]",
        "[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5",
        "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
        "[&::-webkit-scrollbar-track]:bg-transparent",
        containerClassName,
      )}
      style={maxHeight != null ? { maxHeight } : undefined}
    >
      <table
        ref={ref}
        className={cn(
          "w-full caption-bottom text-ms-sm leading-ms-normal [font-variant-numeric:tabular-nums]",
          className,
        )}
        style={style}
        {...props}
      />
    </div>
  ),
);
Table.displayName = "Table";

type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement> & {
  /** Header menempel di atas saat body di-scroll. Default: true. */
  sticky?: boolean;
};

const TableHeader = React.forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ className, sticky = true, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn(
        "[&_tr]:border-b [&_tr]:hover:bg-transparent",
        sticky &&
          "sticky top-0 z-20 depth-3d-bar bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 [&_tr]:border-b-0 [&_th]:after:absolute [&_th]:after:inset-x-0 [&_th]:after:bottom-0 [&_th]:after:h-px [&_th]:after:bg-border [&_th]:after:content-['']",
        className,
      )}
      {...props}
    />
  ),
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 text-ms-sm font-semibold [&>tr]:last:border-b-0",
      className,
    )}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "relative h-11 px-3 text-left align-middle text-ms-xs font-semibold uppercase tracking-[0.06em] leading-ms-snug text-muted-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] sm:h-10 sm:px-2",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-3 py-2.5 align-middle text-ms-sm leading-ms-normal [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] sm:p-2",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-ms-xs leading-ms-snug text-muted-foreground", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
