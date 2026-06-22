import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    // Mematikan autocorrect / saran kata di semua text input agar input tidak
    // diubah otomatis oleh IME / keyboard (mis. "KRISTAL ST" → "Jalan Kristal").
    // Tetap bisa di-override per pemanggilan dengan menulis prop yang sama.
    const isTextLike =
      type === undefined ||
      type === "text" ||
      type === "search" ||
      type === "tel" ||
      type === "url" ||
      type === "email";
    const noAutoDefaults = isTextLike
      ? {
          autoComplete: "off" as const,
          autoCorrect: "off" as const,
          autoCapitalize: "off" as const,
          spellCheck: false,
        }
      : {};
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...noAutoDefaults}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
