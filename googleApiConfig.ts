/**
 * !!! 중요: Google Cloud Console에서 API 키와 OAuth 2.0 클라이언트 ID를 생성하여 아래 값을 채워야 합니다. !!!
 * 
 * 1. Google Cloud Console 프로젝트 생성 또는 선택: https://console.cloud.google.com/
 * 2. API 및 서비스 > 라이브러리에서 다음 API를 활성화합니다:
 *    - Google Drive API
 *    - Google Picker API
 *    - Google Sheets API
 * 3. API 및 서비스 > 사용자 인증 정보에서 다음을 생성합니다:
 *    - API 키: 생성 후 아래 API_KEY에 붙여넣습니다.
 *    - OAuth 2.0 클라이언트 ID:
 *        - 애플리케이션 유형: 웹 애플리케이션
 *        - 승인된 자바스크립트 원본: 앱을 실행하는 URL (예: http://localhost:3000, https://your-app-domain.com)
 *        - 생성 후 클라이언트 ID를 아래 CLIENT_ID에 붙여넣습니다.
 */

export const API_KEY = 'AIzaSyAsfRMNBfG4GRVnQBdonpP2N2ykCZIDGtg'; // 여기에 API 키를 입력하세요.
export const CLIENT_ID = '694281067109-r15c52lg5otlkn3njv3cldprjietjbdl.apps.googleusercontent.com'; // 여기에 클라이언트 ID를 입력하세요.

// Google Drive 파일에 대한 읽기 전용 액세스 권한
export const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';
