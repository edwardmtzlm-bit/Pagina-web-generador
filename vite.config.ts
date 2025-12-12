
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // No environment variables are needed anymore
      },
      resolve: {
        alias: {
          '@': path.resolve('.'),
        }
      }
    };
});
