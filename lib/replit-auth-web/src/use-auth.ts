import { useState, useEffect, useCallback } from "react";

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
  loginWithPassword: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (email: string, password: string, firstName?: string, lastName?: string) => Promise<{ ok: boolean; error?: string }>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = useCallback(() => {
    fetch("/api/auth/user", { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ user: AuthUser | null }>; })
      .then((data) => { setUser(data.user ?? null); setIsLoading(false); })
      .catch(() => { setUser(null); setIsLoading(false); });
  }, []);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  const login = useCallback(() => {
    const base = (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL?.replace(/\/+$/, "")) || "/";
    window.location.href = `/api/login?returnTo=${encodeURIComponent(base)}`;
  }, []);

  const logout = useCallback(() => { window.location.href = "/api/logout"; }, []);

  const loginWithPassword = useCallback(async (email: string, password: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await r.json();
      if (json.ok && json.user) { setUser(json.user); setIsLoading(false); return { ok: true }; }
      return { ok: false, error: json.error || "Login failed." };
    } catch { return { ok: false, error: "Network error. Please try again." }; }
  }, []);

  const register = useCallback(async (email: string, password: string, firstName?: string, lastName?: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, firstName, lastName }),
      });
      const json = await r.json();
      if (json.ok && json.user) { setUser(json.user); setIsLoading(false); return { ok: true }; }
      return { ok: false, error: json.error || "Registration failed." };
    } catch { return { ok: false, error: "Network error. Please try again." }; }
  }, []);

  return { user, isLoading, isAuthenticated: !!user, login, logout, loginWithPassword, register };
}
