import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line bg-elevated transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet data-[state=checked]:border-violet data-[state=checked]:bg-violet",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 translate-x-0.5 rounded-full bg-ink transition-transform data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
