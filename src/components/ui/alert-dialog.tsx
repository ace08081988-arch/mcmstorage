import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  useVisualViewportBox,
  visualViewportDialogStyle,
} from "@/hooks/use-visual-viewport-inset";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, style, ...props }, ref) => {
  // Lihat catatan di `dialog.tsx`: keyboard bisa menutupi dialog yang
  // dipusatkan pada layout viewport. Geser & batasi tinggi ke area terlihat.
  const box = useVisualViewportBox();
  const vvStyle = visualViewportDialogStyle(box);
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        style={vvStyle ? { ...vvStyle, ...(style ?? {}) } : style}
        className={cn(
        // Struktur sama dengan `dialog.tsx`: kolom flex, judul menempel di
        // atas, tombol menempel di bawah, hanya isi yang menggulir.
        "group/alert fixed left-[50%] top-[50%] z-50 flex w-[calc(100%-1rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col gap-4 rounded-lg border bg-background p-4 depth-3d-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:w-full sm:p-6",
        // Bisa digulir saat keyboard muncul; fokus tidak tersembunyi di balik tepi.
        "max-h-[calc(var(--app-vh-visible,var(--app-vh,100dvh))-max(var(--app-safe-top,var(--app-safe-top, env(safe-area-inset-top, 0px))),1rem)-max(var(--app-safe-bottom,var(--app-safe-bottom, env(safe-area-inset-bottom, 0px))),1rem))] overflow-y-auto overscroll-contain scroll-pt-20 scroll-pb-6 focus:outline-none",
        className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex min-w-0 flex-col gap-1 text-left",
      "sticky top-0 z-10 bg-background pb-2",
      "before:pointer-events-none before:absolute before:-left-4 before:right-0 before:bottom-full before:h-4 before:bg-background sm:before:-left-6 sm:before:h-6",
      className,
    )}
    {...props}
  />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      "sticky bottom-0 z-10 mt-auto bg-background pt-2",
      "after:pointer-events-none after:absolute after:-left-4 after:right-0 after:top-full after:h-4 after:bg-background sm:after:-left-6 sm:after:h-6",
      className,
    )}
    {...props}
  />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("min-w-0 text-base font-semibold leading-tight tracking-tight sm:text-lg", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-relaxed text-muted-foreground", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline" }), "mt-2 sm:mt-0", className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
