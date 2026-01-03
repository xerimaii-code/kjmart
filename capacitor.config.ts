
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kjmart.app',
  appName: 'KJ Mart',
  webDir: 'dist',
  backgroundColor: '#00000000', // 네이티브 레벨 투명화
  server: {
    androidScheme: 'https',
    cleartext: true
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
