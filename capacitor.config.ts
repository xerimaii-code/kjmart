import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kjmart.app',
  appName: 'KJ Mart',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;