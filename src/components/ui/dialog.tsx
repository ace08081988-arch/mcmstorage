"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useScrollShadow } from "@/hooks/use-scroll-shadow";
import { useVisualViewportKeyboardInset } from "@/hooks/use-visual-viewport-inset";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  // Deteksi apakah body dialog sudah tergulir → dipakai untuk memunculkan
  // bayangan halus di bawah header secara konsisten di semua dialog.
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      setNode(node);
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref],
  );
  // `node` dipakai agar efek pemantau scroll berjalan ulang setelah elemen
  // benar-benar ter-mount (ref saja tidak memicu efek).
  React.useEffect(() => {
    innerRef.current = node;
  }, [node]);
  const { topShadow } = useScrollShadow(innerRef, node);

  // Saat soft-keyboard Android/iOS terbuka, layout viewport TIDAK mengecil di
  // banyak WebView. Dialog yang dipusatkan di `top-50%` karena itu bisa jatuh
  // persis di balik keyboard → layar hanya menampilkan overlay gelap/blur dan
  // fiturnya "hilang". Kita geser pusat dialog ke tengah area yang benar-benar
  // terlihat dan batasi tingginya ke sisa ruang tersebut.
  const kb = useVisualViewportKeyboardInset();

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setRefs}
        data-scrolled={topShadow ? "true" : "false"}
        style={
          kb > 0
            ? {
                top: `calc(50% - ${Math.round(kb / 2)}px)`,
                maxHeight: `calc(100dvh - ${kb}px - max(env(safe-area-inset-top), 0.5rem) - 0.5rem)`,
                ...(props.style ?? {}),
              }
            : props.style
        }
        className={cn(
        // Mobile: hindari dialog "melompat keluar" viewport dengan membatasi
        // tinggi ke `100dvh` dikurangi safe-area, dan menaruh konten dalam
        // flex column sehingga body bisa scroll sedangkan header/footer
        // tetap terlihat. Padding lebih kompak di HP, generous di ≥sm.
          // `scroll-pt-*`: saat fokus keyboard berpindah ke input/tombol yang
          // berada di luar layar, browser menggulirkannya ke bawah header
          // sticky — bukan tersembunyi di baliknya.
          "group/dialog fixed left-[50%] top-[50%] z-50 flex w-[calc(100%-1rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col gap-4 border bg-background p-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-lg overflow-y-auto overscroll-contain scroll-pt-24 scroll-pb-6 focus:outline-none [max-height:calc(100dvh-max(env(safe-area-inset-top),1rem)-max(env(safe-area-inset-bottom),1rem))] sm:w-full sm:p-6",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label="Tutup"
          className="absolute right-2 top-2 z-20 grid h-11 w-11 place-items-center rounded-md opacity-70 ring-offset-background cursor-pointer transition-[opacity,box-shadow,background-color] hover:opacity-100 hover:bg-accent focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground sm:right-4 sm:top-4 sm:h-8 sm:w-8"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Rata kiri konsisten di semua ukuran, sisakan ruang untuk tombol tutup
      // di kanan atas agar judul panjang tidak menabrak ikon X.
      "flex min-w-0 flex-col gap-1 pr-10 text-left sm:pr-8",
      // Tetap terlihat saat body digulir; bayangan & garis muncul mulus.
      "sticky top-0 z-10 border-b border-transparent bg-background pb-2 transition-[box-shadow,border-color] duration-200",
      // Tutup celah padding di atas & samping header agar konten yang digulir
      // tidak "mengintip" di sela-sela saat header menempel.
      "before:pointer-events-none before:absolute before:-left-4 before:-right-4 before:bottom-full before:h-4 before:bg-background sm:before:-left-6 sm:before:-right-6 sm:before:h-6",
      "group-data-[scrolled=true]/dialog:border-border group-data-[scrolled=true]/dialog:shadow-sm",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "min-w-0 text-ms-lg font-semibold leading-ms-snug tracking-[-0.01em] text-balance",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-ms-sm leading-ms-relaxed text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
