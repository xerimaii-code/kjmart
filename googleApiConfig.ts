/**
 * Google API and Identity Services Configuration.
 * 
 * 중요: 이 파일의 값들을 실제 Google Cloud 프로젝트의 사용자 인증 정보로 교체해야 합니다.
 * 1. Google Cloud Console에 접속하여 프로젝트를 생성하거나 선택합니다.
 * 2. 'API 및 서비스' -> '사용자 인증 정보'로 이동합니다.
 * 3. '사용자 인증 정보 만들기' -> 'API 키'를 선택하여 API 키를 생성합니다.
 * 4. '사용자 인증 정보 만들기' -> 'OAuth 클라이언트 ID'를 선택합니다.
 *    - 애플리케이션 유형: 웹 애플리케이션
 *    - 승인된 자바스크립트 원본: 앱을 실행하는 URL (예: http://localhost:3000, https://your-app-domain.com)
 *    - 클라이언트 ID를 생성하여 아래에 붙여넣습니다.
 * 5. '라이브러리' 메뉴에서 'Google Drive API'와 'Google Picker API'를 검색하여 '사용 설정'합니다.
 */
export const GOOGLE_API_CONFIG = {
  // 생성한 API 키를 여기에 입력하세요.
  API_KEY: "AIzaSyAVIEfLpml9u_DZGoj6Jld2jmM9G8WtwlU",
  
  // 생성한 OAuth 2.0 클라이언트 ID를 여기에 입력하세요.
  CLIENT_ID: "304937094555-hmms808rp0ruu7a9dot0a1cun647sunb.apps.googleusercontent.com",
  
  // 앱이 요청할 권한 범위입니다. 
  // drive.file: 사용자가 선택한 파일에만 접근
  // drive.readonly: Google Picker API 사용에 필요
  SCOPES: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly",
};
