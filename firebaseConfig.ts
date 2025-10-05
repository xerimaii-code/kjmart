/**
 * Firebase configuration object.
 * 
 * 중요: 이 파일의 YOUR_... 값들을 실제 Firebase 프로젝트 설정으로 교체해야 합니다.
 * Firebase 콘솔 -> 프로젝트 설정 -> 일반 탭에서 찾을 수 있습니다.
 * https://console.firebase.google.com/
 */
export const firebaseConfig = {
  apiKey: "AIzaSyAsfRMNBfG4GRVnQBdonpP2N2ykCZIDGtg",
  authDomain: "kjmart-8ff85.firebaseapp.com",
  databaseURL: "https://kjmart-8ff85-default-rtdb.firebaseio.com",
  projectId: "kjmart-8ff85",
  storageBucket: "kjmart-8ff85.appspot.com",
  messagingSenderId: "694281067109",
  appId: "1:694281067109:web:420c066bda06fe6c10c48c"
};

/**
 * Firebase 실시간 데이터베이스 보안 규칙 예시
 * 
 * Firebase 콘솔 -> Realtime Database -> 규칙 탭에서 아래 규칙을 설정하여
 * 앱이 데이터베이스에 자유롭게 읽고 쓸 수 있도록 허용할 수 있습니다.
 * 
 * {
 *   "rules": {
 *     ".read": "true",
 *     ".write": "true"
 *   }
 * }
 * 
 * 경고: 위 규칙은 인증 없이 누구나 데이터베이스에 접근할 수 있게 하므로
 * 개발 및 테스트용으로만 사용해야 합니다. 프로덕션 환경에서는
 * Firebase 인증을 구현하고 보안 규칙을 더 강화해야 합니다.
 */