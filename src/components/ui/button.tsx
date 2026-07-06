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
  // Tap-target floor: `min-h-11` (44px) di HP untuk semua ukuran tombol,
  // dilepas mulai `sm:` supaya ukuran desktop (h-7 / h-8 / h-9) tetap
  // seperti aslinya. Untuk icon button, `min-w-11` menjaga area sentuh
  // 44×44 walau className override memasang `h-7 w-7`. Ini menutup audit
  // tap-target lintas rute tanpa harus mengedit tiap tombol satu-satu.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer select-none transition-[transform,background-color,color,box-shadow,filter] duration-150 min-h-11 sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] active:brightness-95 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:active:brightness-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90 active:bg-primary/80",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 active:bg-secondary/70",
        ghost: "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        // `link` di-render inline seperti teks, jadi floor tap-target
        // 44px yang kita pasang di base akan merusak alur baris. Reset
        // ke `min-h-0` supaya `link` tetap sebesar teks aslinya.
        link: "text-primary underline-offset-4 hover:underline active:scale-100 active:brightness-100 min-h-0",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9 min-w-11 sm:min-w-0",
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
