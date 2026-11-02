import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@/lib/echarts-theme";
import { ensureAuroraTheme } from "@/lib/echarts-theme";
import { App } from "@/app/app";
import "@/styles/globals.css";

ensureAuroraTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
