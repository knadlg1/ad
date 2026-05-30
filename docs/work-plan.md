============================================================
까마귀 프로젝트 작업계획서
생성일: 2026-05-16
============================================================

[배경]
GAS 재배포로 새 URL 발급됨
새 URL: https://script.google.com/macros/s/AKfycbzOGDthNKozJV9j3RIRqgsipHfvYhj_YJ3YZG42RRIdSPRAv51F-pDTu2VHhC2qSMY25Q/exec
구 URL: https://script.google.com/macros/s/AKfycbyoAnovdhUkm5Q6UZJs69-U-hR3QndY5pPK-lbXlj5wQTRn_b3coewDpAPbH8CoNuWsTw/exec

============================================================
PHASE 1: GAS URL 최신화
============================================================

[✅ 완료] 1-1. htmlllllllllllllllllll.txt URL 확인
  → 이미 새 URL 적용됨 (line 918)

[✅ 완료] 1-2. admin.html GAS_URL 업데이트
  파일: admin.html, line 568
  변경: 구 URL → 새 URL

[✅ 완료] 1-3. admin-mobile.html GAS_URL 업데이트
  파일: admin-mobile.html, line 304
  변경: 구 URL → 새 URL

============================================================
PHASE 2: QA 코드 검토 (/qa-only)
============================================================

[✅ 완료] 2-1. htmlllllllllllllllllll.txt (메인 환자 HTML) 코드 분석
[✅ 완료] 2-2. admin.html 코드 분석
[✅ 완료] 2-3. admin-mobile.html 코드 분석
[✅ 완료] 2-4. superadmin.html 코드 분석
[✅ 완료] 2-5. gas-final.gs.txt (GAS 백엔드) 코드 분석
[✅ 완료] 2-6. 발견된 문제점 목록 작성 및 의문점 질문 (아래 참조)

=== 즉시 수정 완료 ===
[✅] BUG-1: admin.html + admin-mobile.html sendOTP 응답 체크 수정 (data.success → data.status==='success')
[✅] BUG-2: gas-final.gs.txt OTP 실전 모드 활성화 (Aligo SMS, 6자리), '0000' 단축키 제거
[✅] OTP UI 라벨 수정: "4자리" → "6자리" (admin.html, htmlllllllllllllllllll.txt)

=== 발견된 문제점 ===

[BUG-1] admin.html + admin-mobile.html: sendOTP() 응답 체크 오류
  위치: admin.html line 687, admin-mobile.html line 408
  원인: data.success 체크 → GAS는 {status:'success'} 반환, data.success는 undefined
  증상: OTP 요청 성공해도 "발송 실패" 메시지 표시됨
  수정: if (data.success) → if (data.status === 'success')

[BUG-2] GAS: OTP 테스트 모드 고정
  위치: gas-final.gs.txt line 517-519
  원인: sendOtpToManager가 항상 '0000' 반환, 실제 SMS 코드는 dead code
  보안: 누구나 '0000'으로 인증 가능
  → 의도적 테스트 모드인지 확인 필요

[BUG-3] GAS: TOSS_SECRET_KEY 미설정
  위치: gas-final.gs.txt line 12
  원인: 'YOUR_TOSS_SECRET_KEY_HERE' 플레이스홀더
  증상: 결제 기능 전체 불작동

[BUG-4] admin.html: Toss 클라이언트 키 테스트 모드
  위치: admin.html line 569
  값: 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq'
  증상: 실제 결제 카드 등록/청구 불가

[BUG-5] 병원 변경 시 GAS 스프레드시트 미업데이트
  위치: admin.html doChangeHospital() - Firestore만 업데이트
  원인: GAS의 updateStudentHospital 액션 호출 누락
  증상: Firestore에는 새 병원, GAS 스프레드시트에는 구 병원 정보 잔류

[아키텍처] 학생 데이터 academyId 연결 문제
  메인앱: GAS → Firestore 저장 시 academyId 없음
  admin.html: Firestore를 academyId로 쿼리 → 학생 미조회 가능성
  → 단일 학원 전용인지, 멀티 학원 지원 여부 확인 필요

[아키텍처] 출퇴근 이중 기록 데이터 불일치 위험
  Firestore(primary) + GAS 스프레드시트(backup) 동시 기록
  admin.html: Firestore의 attendance 컬렉션만 읽음
  GAS 승인 플로우: 스프레드시트 "누락승인대기" 시트 읽음
  Firestore 성공 + GAS 백업 실패 시 → 승인 플로우에서 기록 없음

[주의] 공휴일 하드코딩
  위치: htmlllllllllllllllllll.txt line 1319-1324
  2026년 특정 날짜만 하드코딩, 2027년 이후 오작동

[주의] practiceStart/End 기본값 하드코딩
  위치: htmlllllllllllllllllll.txt line 1257-1258
  '2026-02-02' ~ '2026-07-18' 하드코딩 fallback

[확인됨] 1928000ms 오프셋: GAS Sheets 1899년 시차 버그 보정 (의도적)

=== 사용자에게 확인이 필요한 질문들 (PHASE 3에서 처리) ===
Q1: OTP 테스트 모드('0000') 현재 의도적인가? 실 운영 전환 예정인가?
Q2: Toss 결제는 현재 테스트 모드 의도적인가? 언제 실결제로 전환?
Q3: 이 시스템은 단일 학원 전용인가? (academyId 연결 문제 관련)
Q4: Firestore vs GAS 스프레드시트 중 어느 쪽이 최종 진실 소스(source of truth)?
Q5: 병원 변경 시 GAS 미업데이트 - 스프레드시트는 레거시 백업용인가?

============================================================
PHASE 3: 수정 방향 결정 및 적용
============================================================

[✅ 완료] 3-1. 사용자와 문제점/의문점 협의
[✅ 완료] 3-2. PWA 구현
  - manifest.json 생성
  - sw.js (Service Worker) 생성
  - htmlllllllllllllllllll.txt: PWA 메타태그 추가
  - 인앱브라우저(카카오/네이버) 감지 + 외부 브라우저 유도
  - iOS: 홈화면 추가 단계별 가이드 (슬라이드업 모달)
  - Android: beforeinstallprompt 배너 + 설치 버튼
  - URL ?academy= 파라미터 localStorage 자동 저장
[ ] 3-3. 아이콘 파일 준비 필요: icon-192.png, icon-512.png
[ ] 3-4. GitHub Pages에 sw.js, manifest.json 업로드 필요

============================================================
터미널 재시작 시: 이 파일을 읽어 미완료 항목부터 재개
============================================================
