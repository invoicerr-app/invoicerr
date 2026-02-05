import { defineConfig } from 'vite'
import generouted from '@generouted/react-router/plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), generouted(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  server: {
    port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT) : 5173,
  },
})
