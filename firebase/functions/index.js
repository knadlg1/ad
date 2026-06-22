// v2
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

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

async function svGetBssidInfo(hospitalId, bssid) {
    const snap = await db.doc(`hospitals/${hospitalId}/bssids/${bssid}`).get();
    return snap.exists ? snap.data() : null;
}
async function svIncrementCheckin(hospitalId) {
    const ref = db.doc(`hospitals/${hospitalId}`);
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
async function svRecordBssid(hospitalId, bssid, lat, lon) {
    const today       = todayKST();
    const hospitalRef = db.doc(`hospitals/${hospitalId}`);
    const bssidRef    = db.doc(`hospitals/${hospitalId}/bssids/${bssid}`);
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
    const { idToken, type, kakaoId, latitude, longitude, accuracy, bssid: rawBssid, mocked, wifiConnected } = body;

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
        dist: null, effectiveDist: null, scoreA: null, scoreB: null,
        name: null, hospital: null, hospitalId: null, acId: null,
        date: null, timeStr: null, mode: null,
        result: null, errorType: null, errorMsg: null,
    };
    const reply = async (obj) => {
        log.result    = obj.status === 'success' ? 'success'
                      : obj.status === 'duplicate' ? 'duplicate' : 'error';
        log.errorType = obj.type    || null;
        log.errorMsg  = obj.message || null;
        await db.collection('attendanceLogs').add(log).catch(() => {});
        res.json(obj);
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
        log.name = name || null; log.hospital = hospital || null; log.acId = s.acId || null;

        // ── 4. mock location ──────────────────────────────────────────────
        if (mocked === true || mocked === 'true' || mocked === 1) {
            await reply({ status: 'error', type: 'distance', message: '가짜 위치 앱이 감지됐습니다.\n위치 앱을 종료 후 다시 시도해주세요.' }); return;
        }

        // ── 5. 좌표 유효성 ────────────────────────────────────────────────
        if (!isValidCoord(latitude, longitude) || (latitude === 0 && longitude === 0)) {
            await reply({ status: 'error', type: 'distance', message: 'GPS 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.' }); return;
        }
        if (!isValidCoord(hospitalLat, hospitalLon) || (hospitalLat === 0 && hospitalLon === 0)) {
            await reply({ status: 'error', type: 'distance', message: '병원 위치 정보가 없습니다.\n관리자에게 문의해주세요.' }); return;
        }

        // ── 6. hospitalId ─────────────────────────────────────────────────
        const rawId = hId || hospital;
        if (!rawId) { await reply({ status: 'error', type: 'distance', message: '병원 정보가 없습니다.\n관리자에게 문의해주세요.' }); return; }
        const hospitalId = String(rawId).replace(/\//g, '_').trim();
        if (!hospitalId) { await reply({ status: 'error', type: 'distance', message: '병원 정보가 없습니다.\n관리자에게 문의해주세요.' }); return; }
        log.hospitalId = hospitalId;

        // ── 7. 병원 문서 로드 + 거리 계산 ────────────────────────────────
        const hospitalDocRef  = db.doc(`hospitals/${hospitalId}`);
        const hospitalDocSnap = await hospitalDocRef.get();
        const hospitalDocData = hospitalDocSnap.exists ? hospitalDocSnap.data() : null;
        const extraWaypoints  = Array.isArray(hospitalDocData?.waypoints) ? hospitalDocData.waypoints.slice(0, 2) : [];
        let dist = calcDistance(latitude, longitude, hospitalLat, hospitalLon);
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
        const bssidData = bssid ? await svGetBssidInfo(hospitalId, bssid) : null;
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
        log.scoreA = scoreA; log.scoreB = scoreB;
        log.anchorDist = anchorDist !== null ? +anchorDist.toFixed(1) : null;

        if (scoreA + scoreB < SCORE_PASS) {
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
            await svIncrementCheckin(hospitalId).catch(() => {});
            if (wifiBssid) await svRecordBssid(hospitalId, wifiBssid, latitude, longitude).catch(() => {});
        } else {
            const saveStatus = await svSaveAttendanceChecked(kakaoId, '퇴근', today, {
                outTime: timeStr,
                outAccuracy: Math.round(accuracy) || 0,
                outDistance: Math.round(dist), outMode: mode,
            });
            if (saveStatus === 'duplicate') { await reply({ status: 'duplicate', timeStr }); return; }
            if (saveStatus === 'no_checkin') { await reply({ status: 'error', type: 'server', message: '출근 기록이 없습니다.\n오늘 출근 후 퇴근해주세요.' }); return; }
            if (saveStatus !== 'success') { await reply({ status: 'error', type: 'server', message: '서버 오류가 발생했습니다.\n잠시 후 다시 시도해주세요.' }); return; }
            if (wifiBssid) await svRecordBssid(hospitalId, wifiBssid, latitude, longitude).catch(() => {});
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
        const { passwordHash, hospitalId, waypoints } = parseBody(req);
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
        await db.doc(`hospitals/${safeId}`).set({ waypoints: safeWps }, { merge: true });
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
