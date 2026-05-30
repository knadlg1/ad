============================================================
까마귀 출결관리 시스템 - 아키텍처 재설계 계획서
작성일: 2026-05-16
============================================================

## 핵심 방향

1. Firestore = Source of Truth (진실 소스)
2. GAS = 문서 생성(Google Docs/PDF) 용도만 유지
3. SuperAdmin = Firestore 직접 편집 완전한 관리 화면
4. 100+ 학원 멀티테넌시 지원
5. 학생 가입 → 원장님 승인 → 반 배정 플로우

============================================================
PHASE A: 즉시 완료 (이미 처리됨)
============================================================

[✅] BUG-1: admin.html + admin-mobile.html sendOTP 응답 체크 수정
[✅] BUG-2: GAS OTP 실전 SMS 모드 활성화 (Aligo, 6자리)
[✅] OTP 라벨 "4자리" → "6자리" 전체 수정
[  ] BUG-3/4: Toss 실결제 키 수령 후 적용 (오늘 중)

============================================================
PHASE B: Firestore 데이터 구조 설계 (즉시 시작)
============================================================

[B-1] Firestore 컬렉션 구조 확정

academies/{academyId}
  - name: "사하간호학원"
  - address: "부산시 사하구..."
  - hospitals: [{name, lat, lon}, ...]  ← 병원 좌표를 학원별로 관리
  - contactPhone: "051-xxx-xxxx"
  - createdAt: timestamp

directors/{directorId}
  - phone, passwordHash, name
  - academyId: "academy_xxxx"        ← 학원 연결
  - academyName: "사하간호학원"
  - status: 'pending' | 'approved'
  - paymentStatus: 'none' | 'active' | 'overdue'
  - billingKey, cardInfo
  - createdAt

classes/{classId}
  - name: "2026상반기A반"
  - academyId: "academy_xxxx"
  - practiceStart: "2026-02-02"
  - practiceEnd: "2026-07-18"
  - createdAt

students/{kakaoId}
  - name, phone
  - academyId: "academy_xxxx"        ← 학원 연결 ★핵심 추가
  - classId: "class_xxxx"            ← 반 배정 (승인 시 설정)
  - hospital, hospitalLat, hospitalLon
  - practiceStart, practiceEnd        ← classId에서 상속
  - role: 'student' | 'admin'
  - status: 'pending' | 'approved' | 'rejected'
  - certStatus: '' | 'requested' | 'approved'
  - pendingRequest: ""
  - shiftType: '주간' | '야간'
  - isJabi: false
  - createdAt

attendance/{kakaoId_yyyy-MM-dd}
  - kakaoId, name, hospital, academyId ← 검색용 denormalize
  - date, inTime, outTime
  - inAccuracy, inDistance, outAccuracy, outDistance

weeklySignatures/{kakaoId_startDate}
  - (기존 구조 유지)

============================================================
PHASE C: 학생 가입 플로우 재설계 (학원 선택)
============================================================

[C-1] 메인앱 (htmlllllllllllllllllll.txt) 가입 화면 수정

현재: 이름 + 전화번호만 입력
변경:
  Step 1) 카카오 로그인
  Step 2) 이름 + 전화번호 입력
  Step 3) 학원 검색/선택
    - 학원명으로 검색 (Firestore academies 쿼리)
    - 검색 결과에서 선택
    - 학원 고유코드(invite code) 직접 입력도 지원
  Step 4) 제출 → Firestore students/{kakaoId}에 status:'pending', academyId 저장

[C-2] 학원 초대 코드 방식 (선택적 추가)
  - 각 academies 문서에 inviteCode 필드 (6자리 영숫자)
  - 원장님이 학생에게 코드 공유
  - 학생이 코드 입력 시 자동으로 해당 학원으로 연결
  → 100+ 학원에서도 정확한 학원 매칭 보장

[C-3] GAS 스프레드시트 기반 학생 조회 제거
  - handleCheckStudent GAS → Firestore 직접 조회로 전환
  - GAS checkStudent 액션은 폴백용으로만 유지 (점진적 제거)

============================================================
PHASE D: 원장님 승인 + 반 배정 플로우
============================================================

[D-1] admin.html 학생 관리 탭에 "가입 대기" 섹션 추가

  현재: 승인된 학생 목록만 표시
  변경:
    탭1: 재학생 (status=approved)
    탭2: 가입 대기 (status=pending)  ← 신규 추가

  가입 대기 학생 카드:
    - 이름, 전화번호, 가입일시
    - [승인 + 반 배정] 버튼 클릭 시:
        → 반 선택 드롭다운 (classesList)
        → 실습병원 선택
        → [확정] 클릭
        → Firestore students 업데이트:
            status: 'approved'
            classId: 선택한 반
            hospital, hospitalLat, hospitalLon
            practiceStart, practiceEnd (반에서 상속)
    - [반려] 버튼: status = 'rejected'

[D-2] 학생이 승인 대기 상태일 때 메인앱 표시
  - 현재: "승인 대기 중" 토스트
  - 추가: 대기 화면을 별도 UI로 표시 (반복 알림 방지)

============================================================
PHASE E: SuperAdmin 화면 완성
============================================================

[E-1] superadmin.html 현재 상태 파악 필요

슈퍼어드민이 할 수 있어야 할 것들:
  - 학원(academies) CRUD
  - 원장님(directors) 승인/반려/정지
  - 학생(students) 정보 직접 수정
    * 이름, 전화번호, 병원, 실습기간
    * 출퇴근 기록 수정 (attendance 컬렉션)
    * 반 재배정
  - 학원 병원 좌표 수정 (hospitalLat, hospitalLon)
  - 출퇴근 기록 직접 추가/수정/삭제
  - 전체 통계 대시보드

[E-2] 슈퍼어드민 인증
  - 현재: Firestore 직접 접근 (Firestore 보안 규칙에서 별도 처리 필요)
  - 슈퍼어드민 계정은 별도 superadmins 컬렉션 or 하드코딩된 UID

============================================================
PHASE F: GAS 역할 축소 (단계적)
============================================================

[F-1] 유지할 GAS 기능 (계속 필요)
  - handleSubmitToGoogleDoc: 실습근무카드 Google Docs 생성
  - submitPendingMissingAttendance: 누락확인서 Google Docs 생성
  - handleGenerateCertificate: 수강증명서 PDF 생성
  - uploadProofDocument: 증빙서류 Google Drive 저장

[F-2] 제거/Firestore 전환 대상
  - handleCheckStudent → Firestore 직접 읽기로 대체
  - handleRecordAttendance → 이미 Firestore primary, GAS는 backup → backup 제거
  - getStudentList → admin.html이 이미 Firestore 직접 읽음 → 제거
  - updateStudentHospital → admin.html에서 Firestore 직접 업데이트 → 제거
  - approveMissingAttendance → superadmin에서 Firestore 직접 수정으로 대체
  - getPendingApprovals → Firestore weeklySignatures 컬렉션으로 전환

[F-3] 스프레드시트 역할 변화
  현재: 데이터 저장소 (source of truth 역할)
  미래: Firestore 데이터 뷰어 (pull 전용)
  - 별도 GAS 트리거로 주기적으로 Firestore → 스프레드시트 동기화
  - 원장님/슈퍼어드민이 스프레드시트에서 읽기 전용으로 확인

============================================================
PHASE G: Firestore 보안 규칙 설계
============================================================

현재 문제: 모든 클라이언트가 익명 인증으로 Firestore에 직접 접근
→ 보안 규칙 없으면 누구나 모든 데이터 읽기/쓰기 가능

필요한 규칙:
  - students: 본인(kakaoId == request.auth.uid 또는 custom token) 읽기/쓰기
  - attendance: 본인 읽기, 쓰기
  - directors: 본인 읽기/쓰기 (phone 검색은 허용)
  - academies: 읽기 허용 (검색), 쓰기는 슈퍼어드민만
  - superadmins: 슈퍼어드민 전용

※ 현재 익명 auth 방식으로는 세밀한 보안 규칙 구현이 어려움
→ 향후 Firebase Auth (카카오 Custom Token) 연동 검토

============================================================
구현 순서 (우선순위)
============================================================

[즉시]
  1. BUG-1, BUG-2 완료 ✅
  2. Toss 키 수령 즉시 BUG-3/4 적용

[이번 주]
  3. PHASE C: 학생 가입 시 학원 선택 (academyId 연결)
  4. PHASE D: 원장님 가입 대기 승인 + 반 배정 UI
  5. academies 컬렉션 생성 + 초대코드 방식 구현

[다음 단계]
  6. PHASE E: SuperAdmin 화면 강화
  7. PHASE F: GAS 역할 정리
  8. PHASE G: Firestore 보안 규칙 강화

============================================================
의사결정이 필요한 항목
============================================================

Q-A: 학원 선택 방식 결정
  옵션1: 학원명 검색 → 검색 결과 목록에서 선택
  옵션2: 원장님이 발급한 초대코드(6자리) 입력
  옵션3: 원장님이 학생에게 공유하는 전용 URL (?code=SAHA2026)
  → 추천: 옵션3 (URL) + 옵션2(코드) 병행 지원

Q-B: 학원 병원 좌표 관리 위치
  현재: admin.html에 HOSPITALS 배열 하드코딩
  변경: Firestore academies/{id}.hospitals 배열로 이동
  → 원장님 또는 슈퍼어드민이 수정 가능

Q-C: GAS 스프레드시트 동기화 주기
  옵션1: 실시간 (Firestore trigger → GAS) - GAS에선 어려움
  옵션2: 매시간 GAS 트리거로 Firestore pull
  옵션3: 슈퍼어드민에서 수동 "스프레드시트 내보내기" 버튼
  → 추천: 옵션3 (점진적으로 스프레드시트 의존도 줄이는 방향)

============================================================
터미널 재시작 시: 이 파일 + 작업계획.txt 읽고 재개
============================================================
