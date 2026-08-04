// v2
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

admin.initializeApp();
const db = admin.firestore();

// fetchWithRetry가 Content-Type:text/plain으로 보내므로 수동 파싱
function parseBody(req) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
}

const SOLAPI_KEY    = process.env.SOLAPI_KEY;
const SOLAPI_SECRET = process.env.SOLAPI_SECRET;
const SOLAPI_SENDER = process.env.SOLAPI_SENDER;

function solapiAuthHeader() {
    const date = new Date().toISOString();
    const salt = crypto.randomBytes(16).toString("hex");
    const signature = crypto.createHmac("sha256", SOLAPI_SECRET)
        .update(date + salt).digest("hex");
    return `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

function setCors(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
}

// OTP 발송: Firestore에 코드 저장 → 알리고 SMS 발송
exports.requestOTP = functions.https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
        const body = parseBody(req);
        const phone = body.phone;
        if (!phone) { res.json({ status: "error", success: false, message: "전화번호 필요" }); return; }

        const otpCode = String(Math.floor(100000 + Math.random() * 900000));
        await db.doc("otps/" + phone).set({
            code: otpCode,
            expiresAt: Date.now() + 300000   // 5분
        });

        const solapiRes = await fetch("https://api.solapi.com/messages/v4/send", {
            method:  "POST",
            headers: {
                "Content-Type":  "application/json",
                "Authorization": solapiAuthHeader(),
            },
            body: JSON.stringify({
                message: {
                    to:   phone,
                    from: SOLAPI_SENDER,
                    text: `[Here 출결관리] 담당자 서명 인증번호 [${otpCode}]를 입력해주세요.`,
                }
            }),
        });
        const solapiData = await solapiRes.json();
        console.log("Solapi response:", JSON.stringify(solapiData));

        if (solapiData.errorCode) {
            await db.doc("otps/" + phone).delete();
            res.json({ status: "error", success: false, message: "SMS 발송에 실패했습니다. 잠시 후 다시 시도해주세요." });
        } else {
            res.json({ status: "success", success: true, message: "인증번호가 발송되었습니다." });
        }
    } catch (e) {
        res.json({ status: "error", success: false, message: e.message });
    }
});

// iOS 홈화면 추가용 mobileconfig 제공
exports.iosInstall = functions.https.onRequest((req, res) => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key><true/>
      <key>IsRemovable</key><true/>
      <key>Label</key><string>Here 출결관리</string>
      <key>PayloadIdentifier</key><string>com.here.sahanurse.webclip</string>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key><string>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>URL</key><string>https://knadlg1.github.io/sahanurse-attendance/</string>
    </dict>
  </array>
  <key>PayloadDisplayName</key><string>Here 출결관리</string>
  <key>PayloadIdentifier</key><string>com.here.sahanurse</string>
  <key>PayloadRemovalDisallowed</key><false/>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>B2C3D4E5-F6A7-8901-BCDE-F12345678901</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>`;

    res.set('Content-Type', 'application/x-apple-aspen-config');
    res.set('Content-Disposition', 'attachment; filename="here.mobileconfig"');
    res.send(xml);
});

// ── 카카오 로그인: code → kakaoId 교환 ──────────────────────────────────
const KAKAO_REST_KEY = 'ca34b3c2a0cf2d0fe87d9f18b39aa8d8';

exports.kakaoLogin = functions.https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    try {
        const { code, redirect_uri } = parseBody(req);
        if (!code || !redirect_uri) {
            res.json({ status: 'error', message: '파라미터 누락' }); return;
        }

        // 1. 카카오 액세스 토큰 발급
        const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({
                grant_type:   'authorization_code',
                client_id:    KAKAO_REST_KEY,
                redirect_uri,
                code,
            }).toString(),
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
            console.error('카카오 토큰 발급 실패:', tokenData);
            res.json({ status: 'error', message: '카카오 인증에 실패했습니다.' }); return;
        }

        // 2. 사용자 정보 조회
        const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = await userRes.json();
        if (!userData.id) {
            res.json({ status: 'error', message: '사용자 정보를 가져올 수 없습니다.' }); return;
        }

        res.json({
            kakaoId:  userData.id,
            nickname: userData.kakao_account?.profile?.nickname || userData.properties?.nickname || '',
        });
    } catch (e) {
        console.error('kakaoLogin error:', e);
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// ════════════════════════════════════════════════════════════════════════
// processAttendance — C1: 출결 검증 서버사이드 이전
// 클라이언트가 GPS/BSSID 원시값 + Firebase ID토큰을 전송
// 서버에서 모든 검증 후 Admin SDK로 Firestore에 직접 기록
// ════════════════════════════════════════════════════════════════════════

const SCORE_PASS     = 5;   // 통과 최소 점수
const HARD_FAIL_DIST = 130; // GPS 유효거리 이 값 초과 시 무조건 실패(m)
const ANCHOR_RADIUS  = 50;  // trusted BSSID 위치 닻 허용 오차(m)
const SEEN_DATES_MAX      = 60;

const VALID_BSSID_RE  = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const RESERVED_BSSIDS = new Set([
    '00:00:00:00:00:00',
    '02:00:00:00:00:00', // Android 위치권한 거부시 더미값
    'ff:ff:ff:ff:ff:ff',
]);

function todayKST() {
    const kst = new Date(Date.now() + 9 * 3600000);
    return kst.toISOString().slice(0, 10);
}
function timeStrKST() {
    const kst = new Date(Date.now() + 9 * 3600000);
    return String(kst.getUTCHours()).padStart(2, '0') + ':' +
           String(kst.getUTCMinutes()).padStart(2, '0');
}
function calcDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
              Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function normalizeBssid(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const b = raw.toLowerCase().trim().replace(/-/g, ':');
    return (VALID_BSSID_RE.test(b) && !RESERVED_BSSIDS.has(b)) ? b : null;
}
function isValidCoord(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
           lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// hospitalRef: 병원 메타 문서 참조 — 신규 경로(academies/{academyId}/hospitals/{id})
// 또는 구 경로(hospitals/...) 어느 쪽이든 동일하게 동작 (processAttendance에서 해석)
async function svGetBssidInfo(hospitalRef, bssid) {
    if (!hospitalRef) return null;
    const snap = await hospitalRef.collection('bssids').doc(bssid).get();
    return snap.exists ? snap.data() : null;
}
async function svIncrementCheckin(hospitalRef) {
    if (!hospitalRef) return;
    const ref = hospitalRef;
    await db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists) {
            t.set(ref, {
                bssidStatus:       'bootstrap',
                bootstrapCheckins: 1,
                bootstrapStartDate: todayKST(),
                stableAt:          null,
                trustedBssidCount:  0,
            });
        } else {
            t.update(ref, { bootstrapCheckins: admin.firestore.FieldValue.increment(1) });
        }
    });
}
async function svRecordBssid(hospitalRef, bssid, lat, lon) {
    if (!hospitalRef) return;
    const today       = todayKST();
    const bssidRef    = hospitalRef.collection('bssids').doc(bssid);
    const hasGps      = Number.isFinite(lat) && Number.isFinite(lon);
    const becameTrusted = await db.runTransaction(async (t) => {
        const snap = await t.get(bssidRef);
        if (!snap.exists) {
            const doc = { count: 1, days: 1, seenDates: [today], trusted: false, lastSeen: today };
            if (hasGps) { doc.anchorLat = lat; doc.anchorLon = lon; doc.anchorCount = 1; }
            t.set(bssidRef, doc);
            return false;
        }
        const d         = snap.data();
        const seenDates = Array.isArray(d.seenDates) ? d.seenDates : [];
        const isNewDay  = !seenDates.includes(today);
        const newCount  = (d.count || 0) + 1;
        const newDays   = isNewDay ? (d.days || 0) + 1 : (d.days || 0);
        const trusted   = newCount >= 10 && newDays >= 5;
        const update    = {
            count: newCount, days: newDays,
            seenDates: isNewDay ? [...seenDates, today].slice(-SEEN_DATES_MAX) : seenDates,
            trusted, lastSeen: today,
        };
        // GPS 위치 닻(anchor) 누적 평균 업데이트
        if (hasGps) {
            const n = d.anchorCount || 0;
            if (n > 0 && Number.isFinite(d.anchorLat) && Number.isFinite(d.anchorLon)) {
                update.anchorLat   = (d.anchorLat * n + lat) / (n + 1);
                update.anchorLon   = (d.anchorLon * n + lon) / (n + 1);
                update.anchorCount = n + 1;
            } else {
                update.anchorLat = lat; update.anchorLon = lon; update.anchorCount = 1;
            }
        }
        t.set(bssidRef, update, { merge: true });
        return trusted && !d.trusted;
    });
    if (becameTrusted) {
        hospitalRef.update({ trustedBssidCount: admin.firestore.FieldValue.increment(1) }).catch(() => {});
    }
}
async function svSaveAttendanceChecked(kakaoId, type, today, updateData) {
    const ref = db.doc(`attendance/${String(kakaoId)}_${today}`);
    let status = null;
    await db.runTransaction(async (t) => {
        const snap     = await t.get(ref);
        const existing = snap.exists ? snap.data() : {};
        const field    = type === '출근' ? 'inTime' : 'outTime';
        if (existing[field]) { status = 'duplicate'; return; }
        if (type === '퇴근' && !existing.inTime) { status = 'no_checkin'; return; }
        t.set(ref, { ...existing, ...updateData }, { merge: true });
        status = 'success';
    });
    return status;
}

exports.processAttendance = functions.https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ status: 'error', type: 'server', message: '허용되지 않는 요청입니다.' }); return; }

    // body를 try 바깥에서 파싱 (log 초기화에 필요)
    let body = {};
    try { body = parseBody(req); } catch {}
    const { idToken, type, kakaoId, latitude, longitude, accuracy, bssid: rawBssid, mocked, wifiConnected, wifiMatchPct, fingerprintPhase } = body;

    // ── 로그 객체 (모든 응답 직전에 Firestore에 기록) ────────────────────
    const log = {
        ts:           admin.firestore.FieldValue.serverTimestamp(),
        type:         type         || null,
        kakaoId:      kakaoId      ? String(kakaoId) : null,
        latitude:     Number.isFinite(latitude)  ? latitude  : null,
        longitude:    Number.isFinite(longitude) ? longitude : null,
        accuracy:     Number.isFinite(accuracy)  ? +Number(accuracy).toFixed(1) : null,
        mocked:       mocked === true || mocked === 'true' || mocked === 1,
        wifiConnected: wifiConnected === true,
        bssid: null, bssidTrusted: false, anchorDist: null,
        dist: null, effectiveDist: null, scoreA: null, scoreB: null, scoreC: null,
        name: null, hospital: null, hospitalId: null, acId: null, hospPath: null,
        date: null, timeStr: null, mode: null,
        result: null, errorType: null, errorMsg: null,
    };
    const reply = async (obj) => {
        log.result    = obj.status === 'success' ? 'success'
                      : obj.status === 'duplicate' ? 'duplicate' : 'error';
        log.errorType = obj.type    || null;
        log.errorMsg  = obj.message || null;
        await db.collection('attendanceLogs').add(log).catch(() => {});
        res.json({
            ...obj,
            dist:          log.dist          ?? null,
            effectiveDist: log.effectiveDist ?? null,
            scoreA:        log.scoreA        ?? null,
            scoreB:        log.scoreB        ?? null,
            scoreC:        log.scoreC        ?? null,
        });
    };

    try {
        // ── 1. Firebase ID 토큰 검증 ──────────────────────────────────────
        if (!idToken) { await reply({ status: 'error', type: 'auth', message: '인증 토큰이 없습니다.' }); return; }
        try { await admin.auth().verifyIdToken(idToken); }
        catch { await reply({ status: 'error', type: 'auth', message: '인증 토큰이 유효하지 않습니다.' }); return; }

        // ── 2. 필수 파라미터 ──────────────────────────────────────────────
        if (!kakaoId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            await reply({ status: 'error', type: 'server', message: '필수 파라미터 누락' }); return;
        }
        if (type !== '출근' && type !== '퇴근') {
            await reply({ status: 'error', type: 'server', message: '잘못된 요청입니다.' }); return;
        }
        if (!/^\d{1,20}$/.test(String(kakaoId))) {
            await reply({ status: 'error', type: 'server', message: '잘못된 학생 정보입니다.' }); return;
        }

        // ── 3. 학생 정보 조회 ─────────────────────────────────────────────
        const studentSnap = await db.doc(`students/${String(kakaoId)}`).get();
        if (!studentSnap.exists) {
            await reply({ status: 'error', type: 'auth', message: '등록된 학생이 아닙니다.' }); return;
        }
        const s = studentSnap.data();
        const { hospitalLat, hospitalLon, hospitalId: hId, hospital, name } = s;
        const academyId = s.academyId ? String(s.academyId).trim() : null;
        log.name = name || null; log.hospital = hospital || null; log.acId = academyId || s.academyName || null;

        // ── 4. mock location ──────────────────────────────────────────────
        if (mocked === true || mocked === 'true' || mocked === 1) {
            await reply({ status: 'error', type: 'distance', message: '가짜 위치 앱이 감지됐습니다.\n위치 앱을 종료 후 다시 시도해주세요.' }); return;
        }

        // ── 5. 좌표 유효성 ────────────────────────────────────────────────
        if (!isValidCoord(latitude, longitude) || (latitude === 0 && longitude === 0)) {
            await reply({ status: 'error', type: 'distance', message: 'GPS 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.' }); return;
        }
        // (병원 좌표 검사는 7단계에서 — 병원 문서 좌표 우선, 학생 문서 좌표 폴백)

        // ── 6. hospitalId ─────────────────────────────────────────────────
        // hId 기반 값(신규 경로 auto docId)과 name 기반 값(레거시 경로/최종 폴백)을 처음부터 분리한다.
        // 기존에는 hId||hospital을 합친 단일 변수를 레거시 경로 조회·metaRef 계산에도 그대로 썼는데,
        // hId가 stale(다른 병원을 가리키는 auto docId)해도 그 값이 레거시 경로 문자열에 그대로 섞여
        // 들어가 엉뚱한 경로에서 우연히 문서를 찾거나 BSSID 메타가 잘못된 경로에 기록될 위험이 있었다
        // (2026-07-21 이상준 사건 후속 조치 — FIX B가 신규 경로에서는 stale hId를 거부하지만,
        // 레거시 경로 쪽은 이 변수 분리 없이는 여전히 stale hId의 영향을 받을 수 있었음).
        const hIdSafe        = hId ? String(hId).trim() : '';                                  // 신규 경로(auto docId) 전용
        const hospitalNameKey = String(hospital || hId || '').replace(/\//g, '_').trim();       // 레거시 경로(이름 기반)/최종 폴백 전용
        if (!hIdSafe && !hospital) { await reply({ status: 'error', type: 'distance', message: '병원 정보가 없습니다.\n관리자에게 문의해주세요.' }); return; }
        if (!hospitalNameKey) { await reply({ status: 'error', type: 'distance', message: '병원 정보가 없습니다.\n관리자에게 문의해주세요.' }); return; }
        log.hospitalId = hospitalNameKey;

        // ── 7. 병원 문서 로드 (신규 경로 우선 + 구 경로 폴백) + 거리 계산 ──
        // 해석 순서:
        //   new            : academies/{academyId}/hospitals/{hId(auto docId)} → 없으면 name 쿼리
        //   legacy-academy : hospitals/{academyId}/hospitals/{병원명 sanitize}
        //   legacy-flat    : hospitals/{병원명 sanitize}
        let hospitalDocRef  = null;
        let hospitalDocData = null;
        let hospPath        = 'none';
        if (academyId) {
            if (hIdSafe && !hIdSafe.includes('/')) {
                const ref  = db.doc(`academies/${academyId}/hospitals/${hIdSafe}`);
                const snap = await ref.get();
                if (snap.exists) {
                    const resolvedName = snap.data()?.name;
                    // 방어(2026-07-21 실사고 대응): hospitalId로 resolve된 병원의 name이 학생 문서의
                    // hospital(표시 이름) 필드와 다르면 신뢰하지 않는다. 웹 어드민이 병원 재배정 시
                    // hospital/hospitalLat/hospitalLon만 갱신하고 hospitalId는 갱신하지 않는 기존
                    // 버그로 인해 hospitalId가 stale해질 수 있는데, 그 상태로 이 stale ID가 실제
                    // 존재하는 "다른" 병원 문서를 가리키면 완전히 엉뚱한 좌표로 거리 계산이 되어
                    // 정상 위치에서도 출근이 거부되는 사고가 발생했다(이상준 사례, 사송(test)↔사하제일간호학원).
                    // hospital 필드는 어드민 화면이 항상 최신으로 갱신하므로 이를 검증 기준으로 삼고,
                    // 불일치 시 아래 이름 기반 재조회로 폴백시킨다.
                    if (!hospital || resolvedName === String(hospital).trim()) {
                        hospitalDocRef = ref; hospitalDocData = snap.data(); hospPath = 'new';
                    } else {
                        console.warn(`[hospitalId 불일치] kakaoId=${kakaoId} hospitalId=${hIdSafe}가 가리키는 병원명="${resolvedName}" != 학생 hospital 필드="${hospital}" — 이름 기반 재조회로 폴백`);
                    }
                }
            }
            if (!hospitalDocRef && hospital) {
                const q = await db.collection(`academies/${academyId}/hospitals`)
                    .where('name', '==', String(hospital).trim()).limit(1).get();
                if (!q.empty) { hospitalDocRef = q.docs[0].ref; hospitalDocData = q.docs[0].data(); hospPath = 'new'; }
            }
            if (!hospitalDocRef) {
                const ref  = db.doc(`hospitals/${academyId}/hospitals/${hospitalNameKey}`);
                const snap = await ref.get();
                if (snap.exists) { hospitalDocRef = ref; hospitalDocData = snap.data(); hospPath = 'legacy-academy'; }
            }
        }
        if (!hospitalDocRef) {
            const ref  = db.doc(`hospitals/${hospitalNameKey}`);
            const snap = await ref.get();
            hospitalDocRef  = ref;
            hospitalDocData = snap.exists ? snap.data() : null;
            if (snap.exists) hospPath = 'legacy-flat';
        }
        log.hospPath = hospPath;

        // 메타(부트스트랩/BSSID) 기록 대상: 신규/구-학원 경로 문서면 그 문서,
        // 아니면 구-학원 경로에 생성(academyId 있을 때), 그것도 없으면 최상위 구 경로
        const metaRef = (hospPath === 'new' || hospPath === 'legacy-academy')
            ? hospitalDocRef
            : (academyId ? db.doc(`hospitals/${academyId}/hospitals/${hospitalNameKey}`) : hospitalDocRef);

        // 좌표 정본: 병원 문서(신규 경로) lat/lon 우선, 없으면 학생 문서 좌표 폴백 (이행기 호환)
        let baseLat, baseLon;
        if (hospitalDocData && isValidCoord(hospitalDocData.lat, hospitalDocData.lon) &&
            !(hospitalDocData.lat === 0 && hospitalDocData.lon === 0)) {
            baseLat = hospitalDocData.lat; baseLon = hospitalDocData.lon;
        } else if (isValidCoord(hospitalLat, hospitalLon) && !(hospitalLat === 0 && hospitalLon === 0)) {
            baseLat = hospitalLat; baseLon = hospitalLon;
        } else {
            await reply({ status: 'error', type: 'distance', message: '병원 위치 정보가 없습니다.\n관리자에게 문의해주세요.' }); return;
        }
        const extraWaypoints = Array.isArray(hospitalDocData?.waypoints) ? hospitalDocData.waypoints.slice(0, 2) : [];
        let dist = calcDistance(latitude, longitude, baseLat, baseLon);
        for (const wp of extraWaypoints) {
            if (isValidCoord(wp.lat, wp.lon)) dist = Math.min(dist, calcDistance(latitude, longitude, wp.lat, wp.lon));
        }
        log.dist = +dist.toFixed(1);

        // ── 8. KST 타임스탬프 ─────────────────────────────────────────────
        const kstNow  = new Date(Date.now() + 9 * 3600000);
        const today   = kstNow.toISOString().slice(0, 10);
        const timeStr = String(kstNow.getUTCHours()).padStart(2, '0') + ':' + String(kstNow.getUTCMinutes()).padStart(2, '0');
        log.date = today; log.timeStr = timeStr;

        // ── 9. 점수제 위치 인증 ───────────────────────────────────────────
        const bssid     = normalizeBssid(rawBssid);
        const bssidData = bssid ? await svGetBssidInfo(metaRef, bssid) : null;
        log.bssid = bssid; log.bssidTrusted = bssidData?.trusted === true;

        const effectiveDist = Math.max(0, dist - Math.min(Number.isFinite(accuracy) ? accuracy : 0, 40) * 0.5);
        log.effectiveDist = +effectiveDist.toFixed(1);

        if (effectiveDist > HARD_FAIL_DIST) {
            await reply({ status: 'error', type: 'distance',
                message: `📍 병원에서 ${Math.round(dist)}m 떨어져 있습니다.\n병원 입구에서 다시 시도해주세요.` }); return;
        }
        let scoreA;
        if      (effectiveDist <= 20) scoreA = 5;
        else if (effectiveDist <= 40) scoreA = 4;
        else if (effectiveDist <= 60) scoreA = 3;
        else if (effectiveDist <= 90) scoreA = 2;
        else                          scoreA = 1;

        let scoreB = 0, anchorDist = null;
        if (bssidData?.trusted) {
            anchorDist = (Number.isFinite(bssidData.anchorLat) && Number.isFinite(bssidData.anchorLon))
                ? calcDistance(latitude, longitude, bssidData.anchorLat, bssidData.anchorLon) : null;
            scoreB = (anchorDist !== null && anchorDist <= ANCHOR_RADIUS) ? 5 : 2;
        } else if (wifiConnected) {
            scoreB = 1;
        }
        const rawMatchPct = Number.isFinite(wifiMatchPct) ? Math.max(0, Math.min(100, wifiMatchPct)) : 0;
        const scoreC = fingerprintPhase === 'active' ? Math.floor(rawMatchPct / 10) : 0;
        log.scoreA = scoreA; log.scoreB = scoreB; log.scoreC = scoreC;
        log.anchorDist = anchorDist !== null ? +anchorDist.toFixed(1) : null;

        if (scoreA + scoreB + scoreC < SCORE_PASS) {
            const errType = scoreA >= 3 ? 'wifi' : 'distance';
            const errMsg  = scoreA >= 3
                ? '📶 GPS 신호가 불안정합니다.\n병원 와이파이에 연결 후 다시 시도해주세요.'
                : `📍 병원에서 ${Math.round(dist)}m 떨어져 있습니다.\n병원 입구에서 다시 시도해주세요.`;
            await reply({ status: 'error', type: errType, message: errMsg }); return;
        }

        const mode     = effectiveDist <= 25 ? 'outdoor' : 'indoor';
        const wifiBssid = bssid;
        log.mode = mode;

        // ── 10. Firestore 저장 ────────────────────────────────────────────
        if (type === '출근') {
            const saveStatus = await svSaveAttendanceChecked(kakaoId, '출근', today, {
                kakaoId: String(kakaoId), name: name || '', hospital: hospital || '',
                date: today, inTime: timeStr,
                inAccuracy: Math.round(accuracy) || 0,
                inDistance: Math.round(dist), inMode: mode,
            });
            if (saveStatus === 'duplicate') { await reply({ status: 'duplicate', timeStr }); return; }
            if (saveStatus !== 'success') { await reply({ status: 'error', type: 'server', message: '서버 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.' }); return; }
            await svIncrementCheckin(metaRef).catch(() => {});
            if (wifiBssid) await svRecordBssid(metaRef, wifiBssid, latitude, longitude).catch(() => {});
        } else {
            const saveStatus = await svSaveAttendanceChecked(kakaoId, '퇴근', today, {
                outTime: timeStr,
                outAccuracy: Math.round(accuracy) || 0,
                outDistance: Math.round(dist), outMode: mode,
            });
            if (saveStatus === 'duplicate') { await reply({ status: 'duplicate', timeStr }); return; }
            if (saveStatus === 'no_checkin') { await reply({ status: 'error', type: 'server', message: '출근 기록이 없습니다.\n오늘 출근 후 퇴근해주세요.' }); return; }
            if (saveStatus !== 'success') { await reply({ status: 'error', type: 'server', message: '서버 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.' }); return; }
            if (wifiBssid) await svRecordBssid(metaRef, wifiBssid, latitude, longitude).catch(() => {});
        }

        await reply({ status: 'success', timeStr });

    } catch (e) {
        console.error('processAttendance error:', e);
        await reply({ status: 'error', type: 'server', message: '서버 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.' });
    }
});

// ── 병원 보조좌표 설정 (슈퍼어드민 전용) ─────────────────────────────
exports.updateHospitalWaypoints = functions.https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    try {
        const { passwordHash, hospitalId, waypoints, academyName, academyId } = parseBody(req);
        if (!passwordHash || !hospitalId) {
            res.json({ status: 'error', message: '필수 파라미터 누락' }); return;
        }
        const configSnap = await db.doc('superadmin/config').get();
        if (!configSnap.exists || configSnap.data().passwordHash !== passwordHash) {
            res.json({ status: 'error', message: '인증 실패' }); return;
        }
        const safeId = String(hospitalId).replace(/\//g, '_').trim();
        if (!safeId) { res.json({ status: 'error', message: '잘못된 병원 ID' }); return; }
        const safeWps = (Array.isArray(waypoints) ? waypoints : []).slice(0, 2).filter(
            wp => Number.isFinite(wp?.lat) && Number.isFinite(wp?.lon) &&
                  wp.lat >= -90 && wp.lat <= 90 && wp.lon >= -180 && wp.lon <= 180
        ).map(wp => ({ lat: wp.lat, lon: wp.lon }));
        // 신규 경로(academyId) 우선, 구 경로(academyName → 최상위) 폴백
        const safeAcId        = academyId ? String(academyId).trim() : null;
        const sanitizedAcName = academyName ? String(academyName).trim().replace(/\//g, '_') : null;
        if (!safeAcId && !sanitizedAcName) {
            console.warn(`[updateHospitalWaypoints] academyId/academyName missing for hospital ${safeId} — writing to legacy path`);
        }
        const docPath = safeAcId
            ? `academies/${safeAcId}/hospitals/${safeId}`
            : sanitizedAcName
                ? `hospitals/${sanitizedAcName}/hospitals/${safeId}`
                : `hospitals/${safeId}`;
        await db.doc(docPath).set({ waypoints: safeWps }, { merge: true });
        res.json({ status: 'success', count: safeWps.length });
    } catch(e) {
        res.json({ status: 'error', message: e.message });
    }
});

// ════════════════════════════════════════════════════════════════════════

// OTP 검증: Firestore에서 코드 조회 → 일치 확인 후 삭제
exports.verifyOTP = functions.https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    try {
        const body = parseBody(req);
        const phone = body.phone;
        // LoginScreen은 'code', SignFlowModal/MissingOutModal은 'otp' 필드 사용
        const otp = body.otp || body.code;
        if (!phone || !otp) { res.json({ status: "error", success: false, message: "파라미터 누락" }); return; }

        const snap = await db.doc("otps/" + phone).get();
        if (!snap.exists) {
            res.json({ status: "error", success: false, verified: false, message: "인증번호가 만료되었습니다." }); return;
        }
        const { code, expiresAt } = snap.data();
        if (Date.now() > expiresAt) {
            await db.doc("otps/" + phone).delete();
            res.json({ status: "error", success: false, verified: false, message: "인증번호가 만료되었습니다." }); return;
        }
        if (code !== otp) {
            res.json({ status: "error", success: false, verified: false, message: "인증번호가 불일치합니다." }); return;
        }
        await db.doc("otps/" + phone).delete();
        res.json({ status: "success", success: true, verified: true, message: "인증이 완료되었습니다." });
    } catch (e) {
        res.json({ status: "error", success: false, message: e.message });
    }
});

// ════════════════════════════════════════════════════════════════════════
// 정기결제(나이스페이 구모듈 카드빌링, webapi.nicepay.co.kr) — Toss → 신모듈(직접암호화) →
// 최종적으로 이 구모듈(goPay() 팝업 방식)로 교체.
// syncPaymentsToSheet(구글시트 자동동기화)는 이식 범위 제외
//
// 카드정보 처리 방식: Toss와 동일하게 나이스페이 호스팅 팝업(goPay)에서 카드정보를 직접
// 입력받으므로 카드 원문이 admin.html이나 이 Cloud Function을 전혀 거치지 않는다(PCI-DSS
// 부담이 신모듈 직접암호화 방식보다 훨씬 낮음 — SAQ A 수준에 가까움).
//
// 플로우: admin.html → prepareBillingAuth(서명된 폼 파라미터 발급) → 클라이언트가 hidden
// form 생성 후 goPay() 팝업 호출 → 인증 성공 시 브라우저가 폼을 issueBillingKey로 그대로
// POST(리다이렉트 아님, 실제 폼 제출) → issueBillingKey가 cardbill_regist.jsp로 빌키(BID)
// 교환 후 Firestore 갱신 → admin.html로 302 리다이렉트(?billing=success|fail).
//
// ⚠️ 미확인/추정 항목(실 샌드박스 검증 필요, 아래 보고 참고):
//  - billing_approve.jsp 승인 성공 ResultCode "3001" 값 자체
//  - cardbill_regist.jsp/billing_approve.jsp의 EdiType:'JSON' 강제 시 실제 JSON 반환 여부
//  - 결제통보(웹훅) 실제 전달 형식(GET 쿼리스트링 vs POST form, 그리고 OK 응답 필요 여부)
// ════════════════════════════════════════════════════════════════════════
const MONTHLY_AMOUNT = 30000; // 월 이용료 30,000원
const NICEPAY_WEBAPI_BASE = 'https://webapi.nicepay.co.kr/webapi';

// 전문생성일시 포맷: YYYYMMDDHHMMSS (KST) — 나이스페이 구모듈 규격
function nicepayEdiDate() {
    const kst = new Date(Date.now() + 9 * 3600000);
    const p = n => String(n).padStart(2, '0');
    return `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}${p(kst.getUTCSeconds())}`;
}

// SignData = hex(sha256(...parts + MerchantKey)) — 엔드포인트마다 parts 순서가 다르므로
// 호출부에서 매뉴얼에 명시된 순서 그대로 인자를 넘겨야 한다.
function nicepaySignData(...parts) {
    return crypto.createHash('sha256').update(parts.join('') + process.env.NICEPAY_MERCHANT_KEY).digest('hex');
}

// 나이스페이 빌키로 실제 청구(billing_approve.jsp) — 내부 헬퍼
// SignData 순서: MID+EdiDate+Moid+Amt+BID+MerchantKey (매뉴얼 명시)
// TID는 빌키 발급 때 받은 TID를 재사용하면 오류 — 청구마다 새로 발급해야 한다(매뉴얼 경고).
async function chargeWithBillingKey(bid, { orderId, amount, goodsName }) {
    try {
        const mid = process.env.NICEPAY_MID;
        const ediDate = nicepayEdiDate();
        const tid = `T${Date.now()}${Math.random().toString(36).slice(2, 8)}`.slice(0, 30);
        const signData = nicepaySignData(mid, ediDate, orderId, amount, bid);
        const form = new URLSearchParams({
            BID: bid, MID: mid, TID: tid, EdiDate: ediDate, Moid: orderId,
            Amt: String(amount), GoodsName: goodsName, SignData: signData,
            CardQuota: '00', EdiType: 'JSON', CharSet: 'utf-8',
        });
        const res = await fetch(`${NICEPAY_WEBAPI_BASE}/billing/billing_approve.jsp`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    form.toString(),
        });
        const body = await res.json();
        if (body.ResultCode === '3001') return { success: true, data: body };
        return { success: false, error: body.ResultMsg || `ResultCode ${body.ResultCode}` };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// payments 컬렉션에 이번 달 결제 성공 기록이 이미 있는지 확인 (중복결제 방지)
async function paymentExists(directorId, monthKey) {
    const snap = await db.collection('payments')
        .where('directorId', '==', directorId)
        .where('month', '==', monthKey)
        .where('status', '==', 'paid')
        .limit(1).get();
    return !snap.empty;
}

// payments 컬렉션에 결제 기록 저장
async function savePayment(data) {
    await db.collection('payments').add(data);
}

// 월 자동결제 실행 — directorIds 지정 시 해당 원장만, 없으면(null) 전체 원장 대상
async function runMonthlyCharge(directorIds) {
    const kst = new Date(Date.now() + 9 * 3600000);
    const monthKey = kst.toISOString().slice(0, 7);

    let directorDocs;
    if (Array.isArray(directorIds) && directorIds.length) {
        const snaps = await Promise.all(directorIds.map(id => db.doc('directors/' + id).get()));
        directorDocs = snaps.filter(s => s.exists);
    } else {
        const snap = await db.collection('directors').get();
        directorDocs = snap.docs;
    }

    for (const doc of directorDocs) {
        const docId = doc.id;
        const d = doc.data();
        if (d.status !== 'approved') continue;
        if (!d.billingKey) continue;
        if (await paymentExists(docId, monthKey)) { console.log(`[SKIP] ${d.academyName || docId} — 이미 결제됨`); continue; }

        const orderId = `monthly_${docId}_${monthKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        const result = await chargeWithBillingKey(d.billingKey, {
            orderId,
            amount:    MONTHLY_AMOUNT,
            goodsName: `까마귀 월 이용료 (${monthKey})`,
        });

        if (result.success) {
            console.log(`[SUCCESS] ${d.academyName || docId}`);
            await savePayment({
                directorId: docId, month: monthKey, orderId,
                amount: MONTHLY_AMOUNT, status: 'paid',
                paidAt: admin.firestore.FieldValue.serverTimestamp(), error: null,
            });
            await db.doc('directors/' + docId).update({
                paymentStatus: 'active',
                lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        } else {
            console.log(`[FAIL] ${d.academyName || docId}: ${result.error}`);
            await savePayment({
                directorId: docId, month: monthKey, orderId,
                amount: MONTHLY_AMOUNT, status: 'failed',
                paidAt: null, error: result.error,
            });
            await db.doc('directors/' + docId).update({ paymentStatus: 'overdue' });
        }
    }
}

// 카드등록 팝업(goPay) 호출에 필요한 서명된 폼 파라미터 발급.
// customerKey/returnUrl은 Moid(주문번호)를 키로 billingAuthRequests에 임시 저장해두고,
// issueBillingKey(폼 제출 콜백)에서 Moid로 다시 조회한다 — 나이스페이가 임의 reserved 필드를
// 그대로 echo해주는지 문서로 확인이 안 되어, 자체 Firestore 매핑으로 안전하게 처리.
exports.prepareBillingAuth = functions.runWith({ secrets: ['NICEPAY_MID', 'NICEPAY_MERCHANT_KEY'] }).https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    try {
        const { customerKey, returnUrl } = parseBody(req);
        if (!customerKey || !returnUrl) { res.json({ status: 'error', message: '파라미터 누락' }); return; }

        const mid = process.env.NICEPAY_MID;
        const ediDate = nicepayEdiDate();
        const moid = `billreg_${customerKey}_${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        const amt = 0; // 빌키 등록 전용 요청 — 매뉴얼 명시: 실제로 결제되지 않는 임의 금액값
        const goodsName = '까마귀 카드등록';
        const signData = nicepaySignData(ediDate, mid, amt);

        await db.doc('billingAuthRequests/' + moid).set({
            customerKey, returnUrl,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        res.json({ status: 'success', mid, ediDate, moid, amt, goodsName, signData });
    } catch (e) {
        console.error('prepareBillingAuth error:', e);
        res.json({ status: 'error', message: e.message });
    }
});

// goPay() 팝업 인증 성공 후 브라우저가 실제 form POST로 호출하는 콜백(fetch 아님).
// AuthToken+TxTid를 cardbill_regist.jsp로 교환해 빌키(BID)를 발급받고 directors 문서 갱신 후,
// admin.html의 returnUrl로 302 리다이렉트(?billing=success|fail)한다.
exports.issueBillingKey = functions.runWith({ secrets: ['NICEPAY_MID', 'NICEPAY_MERCHANT_KEY'] }).https.onRequest(async (req, res) => {
    const redirectBack = (returnUrl, ok) => {
        const base = returnUrl || 'about:blank';
        res.redirect(302, base + (base.includes('?') ? '&' : '?') + 'billing=' + (ok ? 'success' : 'fail'));
    };
    let returnUrl = null;
    try {
        const body = (req.body && typeof req.body === 'object') ? req.body : parseBody(req);
        const { AuthResultCode, AuthToken, TxTid, Moid } = body || {};

        const reqSnap = await db.doc('billingAuthRequests/' + Moid).get();
        if (!reqSnap.exists) { redirectBack(null, false); return; }
        const { customerKey, returnUrl: savedReturnUrl } = reqSnap.data();
        returnUrl = savedReturnUrl;

        if (AuthResultCode !== '0000' || !AuthToken || !TxTid) { redirectBack(returnUrl, false); return; }

        const mid = process.env.NICEPAY_MID;
        const ediDate = nicepayEdiDate();
        const signData = nicepaySignData(TxTid, mid, ediDate);
        const form = new URLSearchParams({
            TID: TxTid, AuthToken, MID: mid, EdiDate: ediDate, SignData: signData,
            CharSet: 'utf-8', EdiType: 'JSON',
        });
        const npRes = await fetch(`${NICEPAY_WEBAPI_BASE}/billing/cardbill_regist.jsp`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    form.toString(),
        });
        const resultBody = await npRes.json();
        if (resultBody.ResultCode !== 'F100') { redirectBack(returnUrl, false); return; }

        await db.doc('directors/' + customerKey).update({
            billingKey:    resultBody.BID,
            cardInfo:      { brand: resultBody.CardName || '카드', last4: String(resultBody.CardNo || '').replace(/\D/g, '').slice(-4) || '****' },
            paymentStatus: 'active',
        });
        await db.doc('billingAuthRequests/' + Moid).delete().catch(() => {});
        redirectBack(returnUrl, true);
    } catch (e) {
        console.error('issueBillingKey error:', e);
        redirectBack(returnUrl, false);
    }
});

// 월 자동결제 (트리거: 매월 1일 오전 9시 KST)
exports.monthlyAutoCharge = functions.runWith({ secrets: ['NICEPAY_MID', 'NICEPAY_MERCHANT_KEY'] }).pubsub
    .schedule('0 9 1 * *').timeZone('Asia/Seoul')
    .onRun(async (context) => {
        await runMonthlyCharge(null);
        return null;
    });

// 월 자동결제 수동 테스트용 — 슈퍼어드민 비밀번호 확인 후 지정 원장 1명만 청구
exports.testMonthlyCharge = functions.runWith({ secrets: ['NICEPAY_MID', 'NICEPAY_MERCHANT_KEY'] }).https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    try {
        const { passwordHash, directorId } = parseBody(req);
        if (!passwordHash || !directorId) { res.json({ status: 'error', message: '파라미터 누락' }); return; }
        const configSnap = await db.doc('superadmin/config').get();
        if (!configSnap.exists || configSnap.data().passwordHash !== passwordHash) {
            res.json({ status: 'error', message: '인증 실패' }); return;
        }
        await runMonthlyCharge([directorId]);
        res.json({ status: 'success' });
    } catch (e) {
        console.error('testMonthlyCharge error:', e);
        res.json({ status: 'error', message: e.message });
    }
});

// 나이스페이 결제통보(구모듈 웹훅) 수신 — 현재는 로그 기록만 수행, 실제 결제상태 갱신은 TODO.
// ⚠️ 전달 형식(GET 쿼리스트링 / POST form-urlencoded) 및 "OK" 응답 필요 여부가 매뉴얼상
// 가맹점관리자 설정("OK 체크" 옵션)에 따라 달라질 수 있어, 두 경우 모두 로그를 남기고
// 항상 "OK"로 응답하도록 방어적으로 구현.
exports.nicepayWebhook = functions.https.onRequest(async (req, res) => {
    try {
        let body = req.body;
        if (typeof body !== 'object' || body === null) {
            try { body = parseBody(req); } catch { body = req.body || null; }
        }
        await db.collection('webhookLogs').add({
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
            query:      req.query || null,
            body:       body,
            headers:    req.headers || null,
        });
        // TODO: signature 검증과 실제 결제상태 갱신(취소/환불 등)은 별도 구현 필요
    } catch (e) {
        console.error('nicepayWebhook error:', e);
    }
    res.status(200).send('OK');
});

// ==================== 수강증명서 PDF 생성(승인 시점 호출) ====================
// GAS(gas-main.gs)에는 신규 기능을 추가하지 않기로 하여, Puppeteer 기반으로 Cloud Functions에서
// 직접 구현한다. 시간 계산(calculateTimeLogic)은 GAS용으로 먼저 설계했던 것을 그대로 이식했고,
// 참여일수/시간을 셀 날짜를 고르는 기준은 mobile-app의 loadBsAttendance와 동일하게
// 전자시간표(classes.timetableData)상 실습일로 지정된 날짜인지로 판단한다(요일/공휴일 무관).
const CERT_TEMPLATE_PATH = path.join(__dirname, 'templates', 'cert-template.html');

// GAS calculateTimeLogic를 이식(요일 기반 지각/조퇴 판정 로직은 유지, 공휴일 조회 부분만 제거 —
// 아래 참고).
function calculateTimeLogic(inStr, outStr, shiftType, dateObj, isJabi) {
    const result = { hours: 0, isTardy: false, isEarlyLeave: false, isAbsent: false };
    if (!inStr || !outStr || inStr === '-' || outStr === '-') return result;
    try {
        const parseTime = (tStr) => {
            const upper = String(tStr).toUpperCase();
            const isPM = upper.indexOf('PM') > -1, isAM = upper.indexOf('AM') > -1;
            const clean = upper.replace(/AM|PM|[가-힣]/g, '').trim().split(':');
            let h = parseInt(clean[0], 10) || 0;
            const m = parseInt(clean[1], 10) || 0;
            if (isPM && h !== 12) h += 12;
            if (isAM && h === 12) h = 0;
            return { h, m };
        };
        const inT = parseTime(inStr), outT = parseTime(outStr);
        const inH = inT.h, inM = inT.m;
        const outH = outT.h, outM = outT.m;

        let isWeekend = false;
        if (dateObj) {
            const day = dateObj.getDay();
            if (day === 0 || day === 6) isWeekend = true;
        }
        const skipPenalties = isWeekend || isJabi;
        let isTardy = false, isEarly = false;

        if (!skipPenalties) {
            if (shiftType === '야간') {
                if (inH > 18 || (inH === 18 && inM > 30)) isTardy = true;
                if (outH < 22 || (outH === 22 && outM < 29)) isEarly = true;
            } else {
                if (inH > 9 || (inH === 9 && inM > 0)) isTardy = true;
                if (outH < 16 || (outH === 16 && outM < 29)) isEarly = true;
            }
        }

        let adjInH = inH, adjInM = 0;
        if (inM === 0) adjInM = 0;
        else if (inM < 30 || inM === 30) adjInM = 30;
        else { adjInH++; adjInM = 0; }

        let adjOutH = outH, adjOutM = 0;
        if (outM === 59 || outM === 58) { adjOutH++; adjOutM = 0; }
        else if (outM >= 29) adjOutM = 30;
        else adjOutM = 0;

        let workedDec = (adjOutH + adjOutM / 60) - (adjInH + adjInM / 60);
        if (workedDec < 0) workedDec = 0;
        if (workedDec > 4.0) workedDec -= 0.5;
        const finalHours = Math.min(8, Math.floor(workedDec));

        if (!skipPenalties) {
            const minHours = shiftType === '야간' ? 2 : 4;
            if (finalHours < minHours) { result.isAbsent = true; }
            else { result.isAbsent = false; result.isTardy = isTardy; result.isEarlyLeave = isEarly; }
        }
        result.hours = finalHours;
        return result;
    } catch (e) { return result; }
}

function fmtDateKo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, '0')}월 ${String(d.getDate()).padStart(2, '0')}일`;
}

exports.generateCertificatePdf = functions
    .runWith({ memory: '1GB', timeoutSeconds: 120 })
    .https.onRequest(async (req, res) => {
        setCors(res);
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
        try {
            const body = parseBody(req);
            const certRequestId = body.certRequestId;
            if (!certRequestId) { res.json({ status: 'error', message: 'certRequestId 필요' }); return; }

            const certSnap = await db.doc('certRequests/' + certRequestId).get();
            if (!certSnap.exists) { res.json({ status: 'error', message: '신청 내역을 찾을 수 없습니다.' }); return; }
            const cert = certSnap.data();

            const kakaoId = String(cert.kakaoId);
            const startDate = cert.startDate;
            const endDate = cert.endDate;
            const rrn = cert.rrn || '';

            const studentSnap = await db.doc('students/' + kakaoId).get();
            if (!studentSnap.exists) { res.json({ status: 'error', message: '학생 정보를 찾을 수 없습니다.' }); return; }
            const student = studentSnap.data();
            const realName = student.name || cert.name || '';
            const isJabi = !!student.jabi;

            // 학원명(하드코딩 없이 동적 조회) + 직인 이미지
            const academyId = cert.academyId || student.academyId || '';
            let academyName = '';
            let sealBase64 = '';
            if (academyId) {
                const dirSnap = await db.collection('directors').where('academyId', '==', academyId).limit(1).get();
                if (!dirSnap.empty) academyName = dirSnap.docs[0].data().academyName || '';
                const academySnap = await db.doc('academies/' + academyId).get();
                if (academySnap.exists) sealBase64 = academySnap.data().sealImage || '';
            }

            // 전체훈련기간: classes.trainStart/trainEnd 우선, 없으면 practiceStart/practiceEnd로 대체
            let cls = null;
            if (student.classId) {
                const clsSnap = await db.doc('classes/' + student.classId).get();
                if (clsSnap.exists) cls = clsSnap.data();
            }
            const totalStartRaw = (cls && cls.trainStart) || (cls && cls.practiceStart) || student.practiceStart || '';
            const totalEndRaw = (cls && cls.trainEnd) || (cls && cls.practiceEnd) || student.practiceEnd || '';
            const totalStartDate = fmtDateKo(totalStartRaw);
            const totalEndDate = fmtDateKo(totalEndRaw);

            const now = new Date();
            const reqYear = String(now.getFullYear());
            const reqMonth = String(now.getMonth() + 1).padStart(2, '0');
            const reqDay = String(now.getDate()).padStart(2, '0');
            const docNumber = `${academyName || '학원'}-${reqYear}-${reqMonth}-${reqDay}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
            const formalPeriodStr = `${fmtDateKo(startDate)} ~ ${fmtDateKo(endDate)}`;

            // 참여일수/시간: attendance를 kakaoId로 조회 후, 신청기간 내에서 전자시간표(timetableData)상
            // 실습일로 지정된 날짜만 카운트한다 — 요일/공휴일 여부는 무관하다(loadBsAttendance와 동일한 기준).
            // calculateTimeLogic으로 자비(jabi) 예외 원칙 동일 적용
            const timetableData = (cls && cls.timetableData) || null;
            const attSnap = await db.collection('attendance').where('kakaoId', '==', kakaoId).get();
            let participatedDays = 0, participatedHours = 0;
            const reqStartObj = new Date(startDate); reqStartObj.setHours(0, 0, 0, 0);
            const reqEndObj = new Date(endDate); reqEndObj.setHours(23, 59, 59, 999);
            attSnap.forEach((docSnap) => {
                const rec = docSnap.data();
                if (!rec.date || !rec.inTime || !rec.outTime) return;
                if (!timetableData || !timetableData[rec.date]) return;
                if (!isJabi && student.practiceStart && rec.date < student.practiceStart) return;
                const dateObj = new Date(rec.date); dateObj.setHours(12, 0, 0, 0);
                if (dateObj < reqStartObj || dateObj > reqEndObj) return;
                const logic = calculateTimeLogic(rec.inTime, rec.outTime, null, dateObj, isJabi);
                if (!logic.isAbsent) { participatedDays++; participatedHours += logic.hours; }
            });

            // 예정 실습일수/시간: 신청기간 내 전자시간표상 실습일로 지정된 날짜 수 × 표준 실습시간(7시간/일).
            // 참여일수 계산과 동일한 자비 예외 규칙을 적용해 분자/분모 기준을 맞춘다.
            let scheduledDays = 0;
            if (timetableData) {
                let d = new Date(startDate); d.setHours(0, 0, 0, 0);
                const endD = new Date(endDate); endD.setHours(0, 0, 0, 0);
                while (d <= endD) {
                    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    if (timetableData[ds] && (isJabi || !student.practiceStart || ds >= student.practiceStart)) {
                        scheduledDays++;
                    }
                    d.setDate(d.getDate() + 1);
                }
            }
            const scheduledHours = scheduledDays * 7;

            // HTML 템플릿 채우기(직인은 텍스트 치환이 아니라 <img> 삽입)
            let html = fs.readFileSync(CERT_TEMPLATE_PATH, 'utf8');
            const sealHtml = sealBase64 ? `<img src="data:image/png;base64,${sealBase64}">` : '';
            html = html
                .replace(/\{\{문서번호\}\}/g, docNumber)
                .replace(/\{\{이름\}\}/g, realName)
                .replace(/\{\{주민등록번호\}\}/g, rrn)
                .replace(/\{\{전체훈련시작일\}\}/g, totalStartDate)
                .replace(/\{\{전체훈련종료일\}\}/g, totalEndDate)
                .replace(/\{\{신청기간\}\}/g, formalPeriodStr)
                .replace(/\{\{참여일수\}\}/g, `${participatedDays}/${scheduledDays}`)
                .replace(/\{\{참여시간\}\}/g, `${participatedHours}/${scheduledHours}`)
                .replace(/\{\{신청년\}\}/g, reqYear)
                .replace(/\{\{신청월\}\}/g, reqMonth)
                .replace(/\{\{신청일\}\}/g, reqDay)
                .replace(/\{\{학원이름\}\}/g, academyName)
                .replace(/\{\{ 직인 \}\}/g, sealHtml);

            // Puppeteer(서버리스 크로미움)로 PDF 렌더링
            const chromium = require('@sparticuz/chromium');
            const puppeteer = require('puppeteer-core');
            const browser = await puppeteer.launch({
                args: puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
                executablePath: await chromium.executablePath(),
                headless: 'shell',
            });
            let pdfBuffer;
            try {
                const page = await browser.newPage();
                await page.setContent(html, { waitUntil: 'networkidle0' });
                pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
            } finally {
                await browser.close();
            }

            // Firebase Storage에 저장 후 다운로드 URL 발급(GAS의 Drive 폴더 저장을 대체)
            const bucket = admin.storage().bucket();
            const file = bucket.file(`certificates/${certRequestId}.pdf`);
            await file.save(pdfBuffer, { metadata: { contentType: 'application/pdf' } });
            const [pdfUrl] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' });

            // PDF 링크만 certRequests 문서에 기록하고, 주민등록번호는 이 시점에 즉시 삭제한다(영구 저장 금지).
            await db.doc('certRequests/' + certRequestId).update({
                pdfUrl,
                rrn: admin.firestore.FieldValue.delete(),
            });

            res.json({ status: 'success', docUrl: pdfUrl });
        } catch (e) {
            console.error('generateCertificatePdf 오류:', e);
            res.json({ status: 'error', message: e.message });
        }
    });
