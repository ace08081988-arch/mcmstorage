import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Fokus: ring 2px + offset supaya kelihatan di semua varian (termasuk
  // outline/ghost yang tanpa background). Active: sedikit scale + brightness
  // turun sebagai feedback taktil di perangkat sentuh (`:active` juga
  // ter-trigger saat tap di mobile, bukan cuma klik-tahan desktop).
  // Gunakan `transition-[transform,background-color,color,box-shadow,filter]`
  // supaya scale + warna sama-sama transisi tanpa mengganggu opacity disabled.
  // Tap-target floor: **44px absolut** di HP untuk semua ukuran tombol.
  // Sengaja pakai `min-h-[44px]` (bukan `min-h-11`) karena root
  // font-size app diskalakan via `--app-font-scale` / `html.compact`,
  // jadi satuan `rem` bisa turun di bawah 44px. Absolute px menjaga
  // Apple/Google guideline apapun preferensi ukuran teks user.
  // Dilepas mulai `sm:` supaya ukuran desktop (h-7/h-8/h-9) tetap.
  // Untuk icon button, `min-w-[44px]` menjaga area sentuh 44×44
  // walau className override memasang `h-7 w-7`.
  "inline-flex items-center justify-center gap-ms-2 whitespace-nowrap rounded-md text-ms-sm font-medium cursor-pointer select-none depth-lift transition-[transform,background-color,color,box-shadow,filter] duration-150 min-h-[44px] sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground depth-press depth-sheen hover:bg-primary/90 active:bg-primary/80",
        destructive: "bg-destructive text-destructive-foreground depth-press depth-sheen hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-input bg-background depth-press hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        secondary: "bg-secondary text-secondary-foreground depth-press depth-sheen hover:bg-secondary/80 active:bg-secondary/70",
        // Kanal WhatsApp/Ace — dipakai untuk semua aksi "kirim ke WA".
        wa: "bg-wa text-wa-foreground depth-press depth-sheen hover:bg-wa/90 active:bg-wa/80",
        waSoft:
          "border border-wa/30 bg-wa-soft text-wa-strong shadow-none hover:bg-wa/20 active:bg-wa/25",
        ghost: "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        // `link` di-render inline seperti teks, jadi floor tap-target
        // 44px yang kita pasang di base akan merusak alur baris. Reset
        // ke `min-h-0` supaya `link` tetap sebesar teks aslinya.
        link: "text-primary underline-offset-4 hover:underline [&:active]:transform-none [&:active]:filter-none min-h-0",
      },
      size: {
        default: "h-9 px-ms-4 py-ms-2",
        sm: "h-8 rounded-md px-ms-3 text-ms-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9 min-w-[44px] sm:min-w-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
