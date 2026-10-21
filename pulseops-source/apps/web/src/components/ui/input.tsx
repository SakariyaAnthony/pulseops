import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 transition-colors hover:border-white/20 text-sm text-ink outline-none placeholder:text-mute focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
