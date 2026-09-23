import {t} from '../i18n';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthUser } from '../types';
import { backend } from '../services/backend';

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, password?: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<AuthUser>) => void;
}

const STORAGE_KEY = 'claude_auth_session';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {

  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: AuthUser = JSON.parse(saved);
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
          localStorage.removeItem(STORAGE_KEY);
          return null;
        }
        return parsed;
      }
    } catch (e) {
      console.error('Failed to parse auth session:', e);
    }
    // Backend runs in platform mode (no auth) — always enter logged in.
    return {
      id: 'local-user',
      name: 'Local user',
      email: '',
      plan: 'max',
      role: 'admin',
      provider: 'email',
      createdAt: Date.now(),
      expiresAt: null,
      durationLabel: 'Unlimited'
    };
  });

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
        localStorage.removeItem('claude_has_logged_out');
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.error('Failed to save auth session:', e);
    }
  }, [user]);

  const loginWithGoogle = async () => {
    // Real backend has no OAuth — the email form is the only door.
    throw new Error(t("Sign in with email to connect to the local backend"));
  };

  const loginWithEmail = async (email: string, password?: string) => {
    setIsLoading(true);
    const username = email.trim() || 'local-user';
    const pass = (password || '').trim();
    try {
      let res;
      try {
        res = await backend.auth.login(username, pass);
      } catch (err: any) {
        // First run: the local DB has no user yet — register it.
        const status = await backend.auth.status().catch(() => null);
        if (status?.needsSetup) {
          res = await backend.auth.register(username, pass);
        } else {
          throw err;
        }
      }
      backend.setToken(res.token);
      const authUser: AuthUser = {
        id: username,
        name: username,
        email: username,
        plan: 'max',
        role: 'admin',
        provider: 'email',
        createdAt: Date.now(),
        expiresAt: null,
        durationLabel: 'Unlimited'
      };
      setUser(authUser);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.setItem('claude_has_logged_out', 'true');
    localStorage.removeItem(STORAGE_KEY);
    backend.setToken(null);
  };

  const updateUser = (updates: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : null));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        loginWithGoogle,
        loginWithEmail,
        logout,
        updateUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
