import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";
import { queryClient } from "@/app/query-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { probeApi } from "@/lib/api/client";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    void probeApi();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#171A2C",
              border: "1px solid #232741",
              color: "#EEF0FF",
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
