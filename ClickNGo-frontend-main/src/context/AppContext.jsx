import { createContext, useContext, useState, useEffect } from "react";
import { useToast } from "../hooks/useToast";
import { useLocation } from "../hooks/useLocation";
import { API_BASE_URL, fetchWithAuth } from "../utils/api";

const STORAGE_KEY = "clickngo_user";

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { msg: toastMsg, show } = useToast();
  const [user, setUserState] = useState(null);
  const [authHydrated, setAuthHydrated] = useState(false);
  const [location, setLocation] = useState("Street 133, Times Square, NYC");
  const [coords, setCoords] = useState(null);

  useLocation(setLocation, setCoords);

  // Load user from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === "object" && parsed.name) {
          setUserState(parsed);
        }
      }
    } catch (e) {
      console.warn("Failed to load user from localStorage", e);
    }
  }, []);

  // Persist user to localStorage on change
  const setUser = (u) => {
    setUserState(u);
    if (u) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
      } catch (e) {
        console.warn("Failed to save user to localStorage", e);
      }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('token');
      } catch (e) {}
    }
  };

  const loginFn = async (email, password) => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Login failed");

    localStorage.setItem('token', data.token);
    const userData = data.user || null;
    setUser(userData);
    return userData;
  };

  const adminLoginFn = async (email, password, adminCode) => {
    const response = await fetch(`${API_BASE_URL}/auth/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, adminCode }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Admin login failed");

    localStorage.setItem("token", data.token);
    const userData = data.user || null;
    setUser(userData);
    return userData;
  };

  const googleAuthFn = async ({ credential, role = "CUSTOMER", phone = "" }) => {
    const response = await fetch(`${API_BASE_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential, role, phone }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Google authentication failed");

    localStorage.setItem("token", data.token);
    const userData = data.user || null;
    setUser(userData);
    return userData;
  };

  const registerFn = async (name, email, password, role, phone) => {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, role, phone })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Registration failed");
      return data.user;
  };

  const loadCurrentUser = async () => {
    const token = localStorage.getItem('token');
    if (!token) return null;
    const { data } = await fetchWithAuth('/auth/me');
    setUser(data.user);
    return data.user;
  };

  // Resolve JWT session before role-based UI (avoids flicker)
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setAuthHydrated(true);
      return;
    }
    loadCurrentUser()
      .catch(() => {})
      .finally(() => setAuthHydrated(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logoutFn = () => {
    setUser(null);
  };

  const value = {
    user,
    authHydrated,
    setUser,
    loginFn,
    adminLoginFn,
    googleAuthFn,
    registerFn,
    loadCurrentUser,
    logoutFn,
    location,
    setLocation,
    coords,
    showToast: show,
    toastMsg,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return ctx;
}
