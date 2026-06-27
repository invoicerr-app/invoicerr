import './index.css'
import './lib/i18n'

import { QueryClientProvider } from '@tanstack/react-query'
import { Routes } from '@generouted/react-router'
import { ThemeProvider } from './components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { createRoot } from 'react-dom/client'
import { queryClient } from './lib/query-client'

async function loadRuntimeConfig() {
    try {
        const res = await fetch('/config.json', { cache: 'no-store' })
        if (res.ok) {
            ; (window as any).__APP_CONFIG__ = await res.json()
            return
        }
    } catch (e) {
        // ignore, fallback to empty config
    }
    ; (window as any).__APP_CONFIG__ = {}
}

async function bootstrap() {
    await loadRuntimeConfig()

    createRoot(document.getElementById('root')!).render(
        <ThemeProvider defaultTheme='system' storageKey='vite-ui-theme'>
            <QueryClientProvider client={queryClient}>
                <Routes />
                <Toaster richColors position='top-right' />
            </QueryClientProvider>
        </ThemeProvider>
    )
}

bootstrap()
