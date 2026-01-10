
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kjmart.app',
  appName: 'KJ Mart',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true
  },
  plugins: {
    // 필요한 경우 플러그인 설정 추가
  }
};

export default config;
