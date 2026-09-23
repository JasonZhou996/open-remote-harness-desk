import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserSettings } from '../types';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../services/storage';
import { setUiLanguage } from '../i18n';

// Codex WebUI shared theme key: same origin, so parent shell and sibling iframes stay in sync via storage events.
const SHARED_THEME_KEY = 'codex-webui-theme';

interface SettingsContextType {
  settings: UserSettings;
  updateSettings: (newSettings: Partial<UserSettings>) => void;
  resetSettings: () => void;
  isCustomizeOpen: boolean;
  setIsCustomizeOpen: (open: boolean) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);

  useEffect(() => {
    saveSettings(settings);
    setUiLanguage(settings.language || 'zh');
    document.documentElement.lang = settings.language === 'en' ? 'en' : 'zh-CN';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('light', !dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);

  useEffect(() => {
    const follow = (value: string | null) => {
      if (value === 'light' || value === 'dark' || value === 'system')
        setSettings(prev => prev.theme === value ? prev : {...prev, theme:value});
    };
    follow(localStorage.getItem(SHARED_THEME_KEY));
    const onStorage = (event: StorageEvent) => { if(event.key === SHARED_THEME_KEY) follow(event.newValue || 'system'); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateSettings = (newSettings: Partial<UserSettings>) => {
    if(newSettings.language)setUiLanguage(newSettings.language);
    if (newSettings.theme) {
      try { localStorage.setItem(SHARED_THEME_KEY, newSettings.theme); } catch {}
    }
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  const resetSettings = () => {
    setUiLanguage(DEFAULT_SETTINGS.language);
    setSettings(DEFAULT_SETTINGS);
  };

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        resetSettings,
        isCustomizeOpen,
        setIsCustomizeOpen,
        isSettingsOpen: isCustomizeOpen,
        setIsSettingsOpen: setIsCustomizeOpen
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
