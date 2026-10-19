import { useId } from "react";

export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="4" y1="6" x2="28" y2="26">
          <stop stopColor="#7C5CFF" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#171A2C" />
      <path d="M5 18c2.4-7 4.6-7 7 0s4.6 7 7 0 4.6-7 7 0" fill="none" stroke={`url(#${id})`} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
