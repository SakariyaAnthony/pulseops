import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0A0B14",
        surface: "#10121F",
        elevated: "#171A2C",
        line: "#232741",
        ink: "#EEF0FF",
        dim: "#9AA0C3",
        mute: "#5E6490",
        violet: { DEFAULT: "#7C5CFF" },
        cyan: { DEFAULT: "#22D3EE" },
        pink: { DEFAULT: "#F472B6" },
        success: "#34D399",
        warning: "#FBBF24",
        danger: "#F43F5E",
        info: "#60A5FA",
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 32px -6px rgba(124,92,255,.45)",
        card: "0 1px 0 rgba(255,255,255,.05) inset, 0 8px 24px -12px rgba(0,0,0,.6)",
      },
      borderRadius: { xl2: "12px" },
      keyframes: {
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(52,211,153,.55)" },
          "70%": { boxShadow: "0 0 0 8px rgba(52,211,153,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(52,211,153,0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        indeterminate: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
      },
      animation: {
        indeterminate: "indeterminate 1.4s ease-in-out infinite",
        pulseRing: "pulseRing 1.8s ease-out infinite",
        shimmer: "shimmer 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
