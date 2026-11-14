import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // Наборы L и S — данные библиотеки, каждый грузится отдельным чанком по требованию.
  build: { chunkSizeWarningLimit: 800 },
});
