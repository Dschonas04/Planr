import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Im Entwicklungsbetrieb laeuft der Go-Server daneben; der Editor spricht
    // ihn ueber denselben Ursprung an, damit keine CORS-Ausnahmen noetig sind.
    proxy: { '/api': { target: 'http://localhost:8090' } },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
});
