# 까마귀 출결관리 - 웹앱 프로젝트

## 프로젝트 개요
간호학원 실습생 출퇴근 관리 웹앱.
학생이 직접 병원 현장에서 출퇴근 기록, 원장님 관리 화면 제공.

## 폴더 구조
- src/         HTML 파일들 (student-app, admin, superadmin)
- server/      GAS(Google Apps Script) 서버 코드
- firebase/    Firebase 설정 (admin-key.json 절대 GitHub 금지)
- assets/      이미지 base64 데이터
- docs/        설계 문서, 배포 URL
- utils/       개발 유틸리티 스크립트

## 핵심 파일
- src/student-app.html  학생용 메인 앱
- src/admin.html        원장님 관리 화면
- server/gas-main.gs    GAS 메인 서버

## 기술 스택
- Frontend: Vanilla HTML/CSS/JS
- Backend: Google Apps Script (GAS)
- Database: Firebase Firestore
- Auth: Kakao OAuth + WebAuthn

## 주의사항
- firebase/admin-key.json 은 절대 GitHub에 올리지 말 것
- GAS 배포 URL은 docs/deploy-url.txt 참고
