import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const BACKEND_URL = "https://hm-pdf-backend.onrender.com";
const API_BASE = (import.meta as any).env?.VITE_BACKEND_URL || BACKEND_URL;
const TOKEN_KEY = "hm_auth_token";

type AuthUser = {
  id: string;
  username: string;
  email?: string | null;
  role: string;
  is_active: boolean;
};

type AuthContextType = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchMe(token: string): Promise<AuthUser> {
  const resp = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error("No autorizado");
  }
  return resp.json();
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    if (!token) {
      setLoading(false);
      return;
    }
    fetchMe(token)
      .then((data) => {
        if (!active) return;
        setUser(data);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const login = async (username: string, password: string) => {
    const resp = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      throw new Error("Credenciales invalidas");
    }
    const data = await resp.json();
    localStorage.setItem(TOKEN_KEY, data.access_token);
    setToken(data.access_token);
    const profile = await fetchMe(data.access_token);
    setUser(profile);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, token, loading, login, logout }),
    [user, token, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
