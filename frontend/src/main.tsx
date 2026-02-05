import './index.css';
import './lib/i18n';

import { Routes } from '@generouted/react-router';
import { createRoot } from 'react-dom/client';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from './components/theme-provider';

async function loadRuntimeConfig() {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (res.ok) {
      (window as any).__APP_CONFIG__ = await res.json();
      return;
    }
  } catch (_e) {
    // ignore, fallback to empty config
  }
  (window as any).__APP_CONFIG__ = {};
}

async function bootstrap() {
  await loadRuntimeConfig();

  createRoot(document.getElementById('root')!).render(
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <Routes />
      <Toaster richColors position="top-right" />
    </ThemeProvider>,
  );
}

bootstrap();
