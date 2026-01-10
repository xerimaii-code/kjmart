
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
 * [운영용] Firebase 실시간 데이터베이스 보안 규칙 (관리자 전용)
 * 
 * 아래 규칙은 'xerimaii@gmail.com' 이메일로 로그인한 사용자만 데이터베이스를 읽고 쓸 수 있도록 제한합니다.
 * Firebase 콘솔 -> Realtime Database -> 규칙 탭에서 아래 규칙 전체를 복사하여 붙여넣으세요.
 * 
 * 중요: 
 * 1. Firebase 콘솔의 Authentication 메뉴에서 'xerimaii@gmail.com' 사용자를 미리 생성해야 합니다.
 * 2. 다른 관리자 이메일을 사용하려면 규칙 내의 이메일 주소를 변경해야 합니다.
 * 3. `orders` 규칙은 발주 내역을 'date' 필드로 효율적으로 조회하기 위해 필수적입니다.
 * 
{
  "rules": {
    ".read": "auth != null && auth.token.email === 'xerimaii@gmail.com'",
    ".write": "auth != null && auth.token.email === 'xerimaii@gmail.com'",
    "orders": {
      ".indexOn": "date"
    }
  }
}
 */
