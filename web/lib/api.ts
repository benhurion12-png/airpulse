import { AuthSession, Dashboard, HistoryPoint, User, UserRole } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ACCESS_TOKEN_KEY = "airpulse-access-token";
const REFRESH_TOKEN_KEY = "airpulse-refresh-token";

function getStoredToken(key: string) {
  return typeof window === "undefined" ? null : localStorage.getItem(key);
}

function saveSession(session: AuthSession) {
  localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
}

function clearSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function refreshSession(): Promise<boolean> {
  const refreshToken = getStoredToken(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  const response = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    clearSession();
    return false;
  }
  saveSession(await response.json() as AuthSession);
  return true;
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = true, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (authenticated) {
    const accessToken = getStoredToken(ACCESS_TOKEN_KEY);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init, headers });
  if (response.status === 401 && authenticated && retry && await refreshSession()) {
    return request<T>(path, init, authenticated, false);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: "Ошибка запроса" })) as { detail?: string | { msg?: string }[] };
    const detail = Array.isArray(payload.detail)
      ? payload.detail.map((item) => item.msg).filter(Boolean).join(". ")
      : payload.detail;
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export const api = {
  hasSession: () => Boolean(getStoredToken(ACCESS_TOKEN_KEY) || getStoredToken(REFRESH_TOKEN_KEY)),
  login: async (body: { email: string; password: string }) => {
    const session = await request<AuthSession>("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, false);
    saveSession(session);
    return session;
  },
  register: async (body: { name: string; email: string; password: string }) => {
    const session = await request<AuthSession>("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, false);
    saveSession(session);
    return session;
  },
  me: () => request<User>("/api/auth/me"),
  logout: clearSession,
  dashboard: () => request<Dashboard>("/api/dashboard"),
  history: (locationId: string) => request<{ points: HistoryPoint[] }>(`/api/locations/${locationId}/history?hours=24`),
  addSensor: (body: Record<string, string>) => request("/api/sensors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
  addLocation: (body: Record<string, string | number>) => request("/api/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
  users: () => request<User[]>("/api/users"),
  updateUserRole: (userId: string, role: UserRole) => request<User>(`/api/users/${userId}/role`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) }),
  updateUserActive: (userId: string, isActive: boolean) => request<User>(`/api/users/${userId}/active`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) }),
};

