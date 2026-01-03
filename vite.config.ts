
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // 안드로이드 웹뷰에서 리소스를 상대 경로로 찾도록 설정
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
})
