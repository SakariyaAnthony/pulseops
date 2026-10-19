import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-lg border border-line bg-base/70 px-3 text-sm text-ink outline-none placeholder:text-mute focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
