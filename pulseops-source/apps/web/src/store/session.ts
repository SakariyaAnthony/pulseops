import { create } from "zustand";
import { persist } from "zustand/middleware";

type SessionState = {
  token: string | null;
  email: string | null;
  name: string | null;
  setSession: (session: { token: string; email: string; name: string }) => void;
  clear: () => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      email: null,
      name: null,
      setSession: (session) => set(session),
      clear: () => set({ token: null, email: null, name: null }),
    }),
    { name: "pulseops-session" },
  ),
);
