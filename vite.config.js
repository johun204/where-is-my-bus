import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 로컬: `python api/_local.py` 로 띄운 API 서버로 /api 프록시
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
});
