import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { SettingsProvider } from './context/SettingsContext';
import { ChatProvider } from './context/ChatContext';
import { AuthProvider } from './context/AuthContext';
import './assets/fonts/fonts.css';
import 'katex/dist/katex.min.css';
import './index.css';

try { localStorage.setItem('codex-webui-last-product', 'claude'); } catch { /* Storage may be disabled. */ }
// Exchange the gateway login for its persistent HttpOnly browser session.
fetch('/api/auth/status', {cache: 'no-store'}).catch(() => {});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <SettingsProvider>
        <ChatProvider>
          <App />
        </ChatProvider>
      </SettingsProvider>
    </AuthProvider>
  </React.StrictMode>
);
