// 병원 담당자(hospital supervisor) 출결 인증 서버 기능
// - 카카오 로그인 → Firebase 커스텀 토큰(role:'manager') 발급 → 이후 모든 엔드포인트는 서버 서명된 ID 토큰으로만 인증
// - 담당자 kakaoId는 항상 토큰 claim에서만 읽는다 (요청 body 값 신뢰 금지)
const crypto = require('crypto');

const OTP_TTL_MS         = 180000;   // 3분
const OTP_RESEND_MS      = 60000;    // 재발송 최소 간격
const OTP_DAILY_MAX      = 5;        // 번호당 하루 발송 한도
const OTP_MAX_ATTEMPTS   = 5;
const PENDING_DAYS       = 60;
const APPROVE_MAX_ITEMS  = 200;
const BATCH_CHUNK        = 400;
const SIG_PREFIX         = 'data:image/png;base64,';
const SIG_MIN_LEN        = 1500;
const SIG_MAX_LEN        = 400000;
const ID_RE              = /^[A-Za-z0-9_-]{1,100}$/;
const KAKAO_ID_RE        = /^\d{1,20}$/;
const DATE_RE            = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE           = /^01[0-9]{8,9}$/;

class ApiError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ApiError(code, message); };

function normPhone(raw) {
    return String(raw || '').replace(/[\s-]/g, '');
}
function hyphenPhone(d) {
    return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}
function cleanText(v, max) {
    const s = typeof v === 'string' ? v.trim() : '';
    const len = [...s].length;
    return (len >= 1 && len <= max) ? s : null;
}
function kstDate(offsetDays = 0) {
    return new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

function registerManagerFunctions(exports, deps) {
    const { functions, admin, db, parseBody, setCors, solapiAuthHeader, KAKAO_REST_KEY, SOLAPI_SENDER } = deps;
    const FV = admin.firestore.FieldValue;

    // 공통 래퍼: CORS, 메서드, body 파싱, (선택) 담당자 토큰 검증, 에러 응답 통일
    const route = (fn, { auth = true } = {}) => functions.https.onRequest(async (req, res) => {
        setCors(res);
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
        if (req.method !== 'POST') { res.status(405).json({ status: 'error', message: '허용되지 않는 요청입니다.' }); return; }
        try {
            let body;
            try { body = parseBody(req) || {}; } catch { fail('bad_request', '잘못된 요청입니다.'); }
            let kakaoId = null;
            if (auth) {
                const h = req.headers.authorization || '';
                const idToken = h.startsWith('Bearer ') ? h.slice(7) : null;
                let decoded = null;
                if (idToken) { try { decoded = await admin.auth().verifyIdToken(idToken); } catch { decoded = null; } }
                if (!decoded || decoded.role !== 'manager' || !KAKAO_ID_RE.test(String(decoded.kakaoId || '')) ||
                    decoded.uid !== 'mgr_' + decoded.kakaoId) {
                    res.status(401).json({ status: 'error', code: 'unauthorized', message: '인증이 필요합니다. 다시 로그인해주세요.' });
                    return;
                }
                kakaoId = String(decoded.kakaoId);
            }
            const out = await fn({ body, kakaoId });
            res.json({ status: 'success', ...out });
        } catch (e) {
            if (e instanceof ApiError) { res.json({ status: 'error', code: e.code, message: e.message }); return; }
            console.error('manager endpoint error:', e && e.message);
            res.status(500).json({ status: 'error', code: 'server', message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
        }
    });

    const audit = (type, managerKakaoId, details) =>
        db.collection('managerAudit').add({ type, managerKakaoId: String(managerKakaoId), ts: FV.serverTimestamp(), details: details || {} })
            .catch(e => console.error('managerAudit write failed:', e.message));

    const strId = (v) => (typeof v === 'string' && ID_RE.test(v)) ? v : null;

    async function loadHospital(academyId, hospitalId) {
        const ref = db.doc(`academies/${academyId}/hospitals/${hospitalId}`);
        const snap = await ref.get();
        return snap.exists ? { ref, data: snap.data() } : null;
    }
    async function loadAcademyName(academyId) {
        const dir = await db.collection('directors').where('academyId', '==', academyId).limit(1).get();
        if (!dir.empty && dir.docs[0].data().academyName) return dir.docs[0].data().academyName;
        const a = await db.doc(`academies/${academyId}`).get();
        return a.exists ? (a.data().academyName || a.data().name || '') : '';
    }
    async function isStudentPhone(phone) {
        // 학생 문서 phone은 숫자만이 기본이나 레거시(GAS) 하이픈 형식도 함께 조회
        const q = await db.collection('students').where('phone', 'in', [phone, hyphenPhone(phone)]).limit(1).get();
        return !q.empty;
    }
    async function requireManager(kakaoId) {
        const ref = db.doc(`hospitalManagers/${kakaoId}`);
        const snap = await ref.get();
        if (!snap.exists) fail('not_registered', '담당자 등록이 필요합니다.');
        return { ref, data: snap.data() };
    }
    const isMember = (mgr, academyId, hospitalId) =>
        (mgr.hospitals || []).some(h => h.academyId === academyId && h.hospitalId === hospitalId);

    // ── 1. 카카오 로그인 → 커스텀 토큰 ─────────────────────────────────────
    exports.managerLogin = route(async ({ body }) => {
        const { code, redirect_uri } = body;
        if (typeof code !== 'string' || typeof redirect_uri !== 'string' || !code || !redirect_uri) fail('bad_request', '파라미터 누락');

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
        if (!tokenData.access_token) fail('kakao_failed', '카카오 인증에 실패했습니다.');

        const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = await userRes.json();
        if (!userData.id) fail('kakao_failed', '사용자 정보를 가져올 수 없습니다.');

        const kakaoId = String(userData.id);
        const customToken = await admin.auth().createCustomToken('mgr_' + kakaoId, { role: 'manager', kakaoId });
        const mSnap = await db.doc(`hospitalManagers/${kakaoId}`).get();
        const m = mSnap.exists ? mSnap.data() : null;
        return {
            customToken,
            kakaoId,
            nickname: userData.kakao_account?.profile?.nickname || userData.properties?.nickname || '',
            registered: !!m,
            manager: m ? {
                name: m.name, position: m.position,
                hospitals: (m.hospitals || []).map(h => ({ academyId: h.academyId, hospitalId: h.hospitalId })),
            } : null,
        };
    }, { auth: false });

    // ── 2. 병원 정보 ────────────────────────────────────────────────────────
    exports.managerHospitalInfo = route(async ({ body, kakaoId }) => {
        const academyId = strId(body.academyId), hospitalId = strId(body.hospitalId);
        if (!academyId || !hospitalId) fail('bad_request', '파라미터 누락');
        const hosp = await loadHospital(academyId, hospitalId);
        if (!hosp) fail('hospital_not_found', '병원 정보를 찾을 수 없습니다.');
        const mSnap = await db.doc(`hospitalManagers/${kakaoId}`).get();
        return {
            name: hosp.data.name || '',
            academyName: await loadAcademyName(academyId),
            isAcademy: hosp.data.isAcademy === true,
            registered: mSnap.exists,
            isMember: mSnap.exists && isMember(mSnap.data(), academyId, hospitalId),
        };
    });

    // ── 3. 등록용 OTP 발송 ──────────────────────────────────────────────────
    exports.managerSendOtp = route(async ({ body, kakaoId }) => {
        const phone = normPhone(body.phone);
        const academyId = strId(body.academyId), hospitalId = strId(body.hospitalId);
        if (!PHONE_RE.test(phone)) fail('bad_phone', '휴대폰번호를 정확히 입력해주세요.');
        if (!academyId || !hospitalId) fail('bad_request', '파라미터 누락');

        const hosp = await loadHospital(academyId, hospitalId);
        if (!hosp) fail('hospital_not_found', '병원 정보를 찾을 수 없습니다.');
        if (hosp.data.isAcademy === true) fail('academy_qr', '실습 병원이 아닌 학원 체험용 QR입니다.');

        const [mSnap, selfStudent] = await Promise.all([
            db.doc(`hospitalManagers/${kakaoId}`).get(),
            db.doc(`students/${kakaoId}`).get(),
        ]);
        if (mSnap.exists) fail('already_registered', '이미 등록된 담당자입니다.');
        if (selfStudent.exists || await isStudentPhone(phone)) {
            await audit('otp-send-blocked', kakaoId, { reason: 'student_phone', academyId, hospitalId });
            fail('student_phone', '학생으로 등록된 번호는 담당자로 등록할 수 없습니다.');
        }

        const code = String(crypto.randomInt(100000, 1000000));
        const otpRef = db.doc(`managerOtps/${kakaoId}`);
        const dailyRef = db.doc(`managerOtpDaily/${phone}_${kstDate().replace(/-/g, '')}`);
        const now = Date.now();

        // 재발송 간격/일일 한도 검사와 코드 저장을 한 트랜잭션으로 묶어 동시 요청 우회 방지
        const blocked = await db.runTransaction(async (t) => {
            const [oSnap, dSnap] = await Promise.all([t.get(otpRef), t.get(dailyRef)]);
            if (oSnap.exists && now - (oSnap.data().sentAt || 0) < OTP_RESEND_MS) return 'too_soon';
            const cnt = dSnap.exists ? (dSnap.data().count || 0) : 0;
            if (cnt >= OTP_DAILY_MAX) return 'daily_limit';
            t.set(dailyRef, { count: cnt + 1, phone, updatedAt: now });
            t.set(otpRef, { phone, code, expiresAt: now + OTP_TTL_MS, attempts: 0, sentAt: now, hospitalId, academyId });
            return null;
        });
        if (blocked === 'too_soon') fail('too_soon', '인증번호는 1분 후에 다시 요청할 수 있습니다.');
        if (blocked === 'daily_limit') {
            await audit('otp-send-blocked', kakaoId, { reason: 'daily_limit', academyId, hospitalId });
            fail('daily_limit', '오늘 인증번호 발송 한도를 초과했습니다. 내일 다시 시도해주세요.');
        }

        const solapiRes = await fetch('https://api.solapi.com/messages/v4/send', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': solapiAuthHeader() },
            body: JSON.stringify({
                message: {
                    to:   phone,
                    from: SOLAPI_SENDER,
                    // 마지막 줄(@도메인 #코드)은 안드로이드 WebOTP 자동입력용
                    text: `[Here 출결관리] 인증번호 [${code}]를 입력해주세요.\n@knadlg1.github.io #${code}`,
                }
            }),
        });
        const solapiData = await solapiRes.json();
        if (solapiData.errorCode) {
            console.error('managerSendOtp Solapi errorCode:', solapiData.errorCode);
            await otpRef.delete().catch(() => {});
            fail('sms_failed', 'SMS 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
        }
        return { message: '인증번호가 발송되었습니다.', expiresInSec: OTP_TTL_MS / 1000, resendAfterSec: OTP_RESEND_MS / 1000 };
    });

    // ── 4. 최초 등록 (OTP 서버 검증 포함) ────────────────────────────────────
    exports.managerRegister = route(async ({ body, kakaoId }) => {
        const phone = normPhone(body.phone);
        const academyId = strId(body.academyId), hospitalId = strId(body.hospitalId);
        const otp = typeof body.otp === 'string' ? body.otp.trim() : String(body.otp || '');
        const name = cleanText(body.name, 20), position = cleanText(body.position, 20);
        const sig = body.signature;

        if (!PHONE_RE.test(phone)) fail('bad_phone', '휴대폰번호를 정확히 입력해주세요.');
        if (!academyId || !hospitalId) fail('bad_request', '파라미터 누락');
        if (!/^\d{6}$/.test(otp)) fail('bad_otp', '인증번호 6자리를 입력해주세요.');
        if (!name) fail('bad_name', '이름은 1~20자로 입력해주세요.');
        if (!position) fail('bad_position', '직책은 1~20자로 입력해주세요.');
        if (typeof sig !== 'string' || !sig.startsWith(SIG_PREFIX) || sig.length < SIG_MIN_LEN || sig.length > SIG_MAX_LEN ||
            !/^[A-Za-z0-9+/=]+$/.test(sig.slice(SIG_PREFIX.length))) {
            fail('bad_signature', '서명을 확인해주세요. 서명이 비어 있거나 너무 작습니다.');
        }

        // OTP로 번호를 소모하기 전에 되돌릴 수 없는 실패 사유를 먼저 걸러낸다
        const hosp = await loadHospital(academyId, hospitalId);
        if (!hosp) fail('hospital_not_found', '병원 정보를 찾을 수 없습니다.');
        if (hosp.data.isAcademy === true) fail('academy_qr', '실습 병원이 아닌 학원 체험용 QR입니다.');
        const [mSnap, selfStudent] = await Promise.all([
            db.doc(`hospitalManagers/${kakaoId}`).get(),
            db.doc(`students/${kakaoId}`).get(),
        ]);
        if (mSnap.exists) fail('already_registered', '이미 등록된 담당자입니다. 병원 추가를 이용해주세요.');
        if (selfStudent.exists || await isStudentPhone(phone)) fail('student_phone', '학생으로 등록된 번호는 담당자로 등록할 수 없습니다.');

        // OTP 검증: 시도 횟수는 실패 때마다 영속 증가 (트랜잭션)
        const otpRef = db.doc(`managerOtps/${kakaoId}`);
        const otpResult = await db.runTransaction(async (t) => {
            const snap = await t.get(otpRef);
            if (!snap.exists) return 'expired';
            const o = snap.data();
            if (o.phone !== phone) return 'phone_mismatch';
            if (Date.now() > o.expiresAt) { t.delete(otpRef); return 'expired'; }
            if ((o.attempts || 0) >= OTP_MAX_ATTEMPTS) { t.delete(otpRef); return 'too_many_attempts'; }
            if (o.code !== otp) {
                if ((o.attempts || 0) + 1 >= OTP_MAX_ATTEMPTS) { t.delete(otpRef); return 'too_many_attempts'; }
                t.update(otpRef, { attempts: (o.attempts || 0) + 1 });
                return 'wrong';
            }
            t.delete(otpRef);
            return 'ok';
        });
        if (otpResult === 'expired') fail('otp_expired', '인증번호가 만료되었습니다. 다시 요청해주세요.');
        if (otpResult === 'phone_mismatch') fail('otp_phone_mismatch', '인증번호를 요청한 번호와 다릅니다.');
        if (otpResult === 'too_many_attempts') fail('too_many_attempts', '인증번호를 5회 틀렸습니다. 인증번호를 다시 요청해주세요.');
        if (otpResult === 'wrong') fail('otp_wrong', '인증번호가 일치하지 않습니다.');

        // 이상 징후 플래그
        const flags = [];
        const samePhone = await db.collection('hospitalManagers').where('phone', '==', phone).limit(1).get();
        if (!samePhone.empty) flags.push('phone_multi_manager');
        const cutoff = Date.now() - 30 * 86400000;
        const hospMgrs = await db.collection('hospitalManagers').where('registeredFromHospitalId', '==', hospitalId).get();
        const recent = hospMgrs.docs.filter(d => {
            const r = d.data().registeredAt;
            return r && r.toMillis && r.toMillis() >= cutoff;
        }).length + 1; // 이번 등록 포함
        if (recent >= 3) flags.push('hospital_manager_churn');

        const mgrRef = db.doc(`hospitalManagers/${kakaoId}`);
        await db.runTransaction(async (t) => {
            if ((await t.get(mgrRef)).exists) fail('already_registered', '이미 등록된 담당자입니다. 병원 추가를 이용해주세요.');
            t.set(mgrRef, {
                kakaoId, phone, name, position, signature: sig,
                hospitals: [{ academyId, hospitalId, joinedAt: Date.now(), via: 'student-qr' }],
                registeredAt: FV.serverTimestamp(),
                registeredFromHospitalId: hospitalId,
                lastApprovedAt: null,
                approveCount: 0,
                flags,
                updatedAt: FV.serverTimestamp(),
            });
        });
        await audit('register', kakaoId, { academyId, hospitalId, flags });
        return { flags };
    });

    // ── 5. 병원 추가 (이미 등록된 담당자) ───────────────────────────────────
    exports.managerJoinHospital = route(async ({ body, kakaoId }) => {
        const academyId = strId(body.academyId), hospitalId = strId(body.hospitalId);
        if (!academyId || !hospitalId) fail('bad_request', '파라미터 누락');
        const hosp = await loadHospital(academyId, hospitalId);
        if (!hosp) fail('hospital_not_found', '병원 정보를 찾을 수 없습니다.');
        if (hosp.data.isAcademy === true) fail('academy_qr', '실습 병원이 아닌 학원 체험용 QR입니다.');

        const mgrRef = db.doc(`hospitalManagers/${kakaoId}`);
        const result = await db.runTransaction(async (t) => {
            const snap = await t.get(mgrRef);
            if (!snap.exists) fail('not_registered', '담당자 등록이 필요합니다.');
            const m = snap.data();
            const hospitals = Array.isArray(m.hospitals) ? m.hospitals : [];
            if (isMember(m, academyId, hospitalId)) return { joined: false, flags: m.flags || [] };
            const next = [...hospitals, { academyId, hospitalId, joinedAt: Date.now(), via: 'join' }];
            const flags = Array.isArray(m.flags) ? [...m.flags] : [];
            if (new Set(next.map(h => h.hospitalId)).size >= 2 && !flags.includes('multi_hospital')) flags.push('multi_hospital');
            t.update(mgrRef, { hospitals: next, flags, updatedAt: FV.serverTimestamp() });
            return { joined: true, flags };
        });
        if (result.joined) await audit('join', kakaoId, { academyId, hospitalId });
        return { joined: result.joined, flags: result.flags };
    });

    // ── 6. 인증 대기 목록 ───────────────────────────────────────────────────
    exports.managerPending = route(async ({ body, kakaoId }) => {
        const academyId = strId(body.academyId), hospitalId = strId(body.hospitalId);
        if (!academyId || !hospitalId) fail('bad_request', '파라미터 누락');
        const { data: mgr } = await requireManager(kakaoId);
        if (!isMember(mgr, academyId, hospitalId)) fail('not_member', '이 병원의 담당자로 등록되어 있지 않습니다.');
        const hosp = await loadHospital(academyId, hospitalId);
        if (!hosp) fail('hospital_not_found', '병원 정보를 찾을 수 없습니다.');

        const stuSnap = await db.collection('students')
            .where('academyId', '==', academyId).where('hospitalId', '==', hospitalId).get();
        const students = stuSnap.docs.filter(d => d.data().verifyRequired === true);
        if (!students.length) return { hospital: { id: hospitalId, name: hosp.data.name || '' }, students: [] };

        const cutoff = kstDate(-PENDING_DAYS);
        const ids = students.map(d => d.id);
        const attSnaps = await Promise.all(chunk(ids, 30).map(c => db.collection('attendance').where('kakaoId', 'in', c).get()));
        const byStudent = {};
        for (const qs of attSnaps) for (const d of qs.docs) {
            const a = d.data();
            const date = a.date || d.id.split('_')[1];
            if (!a.inTime || a.verifiedAt || a.trial === true || !DATE_RE.test(date || '') || date < cutoff) continue;
            if (a.hospitalId && a.hospitalId !== hospitalId) continue;
            (byStudent[a.kakaoId] = byStudent[a.kakaoId] || []).push({
                date, inTime: a.inTime, outTime: a.outTime || null, complete: !!(a.inTime && a.outTime),
            });
        }

        const classIds = [...new Set(students.map(d => d.data().classId).filter(c => typeof c === 'string' && ID_RE.test(c)))];
        const classNames = {};
        await Promise.all(classIds.map(async (cid) => {
            const c = await db.doc(`classes/${cid}`).get();
            if (c.exists) classNames[cid] = c.data().name || c.data().className || '';
        }));

        const out = [];
        for (const d of students) {
            const days = byStudent[d.id];
            if (!days || !days.length) continue;
            days.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
            const s = d.data();
            out.push({ kakaoId: d.id, name: s.name || '', className: classNames[s.classId] || '', days });
        }
        out.sort((x, y) => x.name.localeCompare(y.name, 'ko'));
        return { hospital: { id: hospitalId, name: hosp.data.name || '' }, students: out };
    });

    // ── 7. 인증(승인) ───────────────────────────────────────────────────────
    exports.managerApprove = route(async ({ body, kakaoId }) => {
        const academyId = strId(body.academyId), hospitalId = strId(body.hospitalId);
        if (!academyId || !hospitalId) fail('bad_request', '파라미터 누락');
        if (!Array.isArray(body.items) || !body.items.length) fail('bad_request', '승인할 항목이 없습니다.');
        if (body.items.length > APPROVE_MAX_ITEMS) fail('too_many_items', `한 번에 최대 ${APPROVE_MAX_ITEMS}건까지 승인할 수 있습니다.`);

        const { ref: mgrRef, data: mgr } = await requireManager(kakaoId);
        if (!isMember(mgr, academyId, hospitalId)) fail('not_member', '이 병원의 담당자로 등록되어 있지 않습니다.');
        const hosp = await loadHospital(academyId, hospitalId);
        if (!hosp) fail('hospital_not_found', '병원 정보를 찾을 수 없습니다.');
        if (hosp.data.isAcademy === true) fail('academy_qr', '실습 병원이 아닌 학원 체험용 QR입니다.');

        const skipped = [];
        const items = [];
        const seen = new Set();
        for (const it of body.items) {
            const sid = it && String(it.kakaoId || ''), date = it && it.date;
            if (!KAKAO_ID_RE.test(sid || '') || typeof date !== 'string' || !DATE_RE.test(date)) {
                skipped.push({ kakaoId: sid || null, date: date || null, reason: 'invalid' }); continue;
            }
            const key = `${sid}_${date}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({ kakaoId: sid, date, key });
        }

        const stuIds = [...new Set(items.map(i => i.kakaoId))];
        const stuMap = {}, attMap = {};
        if (stuIds.length) {
            const snaps = await db.getAll(...stuIds.map(id => db.doc(`students/${id}`)));
            snaps.forEach(s => { if (s.exists) stuMap[s.id] = s.data(); });
        }
        if (items.length) {
            const snaps = await db.getAll(...items.map(i => db.doc(`attendance/${i.key}`)));
            snaps.forEach(s => { if (s.exists) attMap[s.id] = s.data(); });
        }

        const mgrPhone = normPhone(mgr.phone);
        const approved = [];
        const writes = [];
        for (const it of items) {
            const stu = stuMap[it.kakaoId], att = attMap[it.key];
            let reason = null;
            if (!stu) reason = 'no_student';
            else if (String(stu.academyId || '').trim() !== academyId) reason = 'wrong_academy';
            else if (it.kakaoId === kakaoId || (mgrPhone && normPhone(stu.phone) === mgrPhone)) reason = 'self';
            else if (!att) reason = 'no_attendance';
            else if (!att.inTime || !att.outTime) reason = 'incomplete';
            else if (att.verifiedAt) reason = 'already_verified';
            else if (att.trial === true) reason = 'trial';
            else if ((att.hospitalId || stu.hospitalId) !== hospitalId) reason = 'hospital_mismatch';
            if (reason) { skipped.push({ kakaoId: it.kakaoId, date: it.date, reason }); continue; }
            writes.push(it);
            approved.push(it.key);
        }

        for (const part of chunk(writes, BATCH_CHUNK)) {
            const batch = db.batch();
            for (const it of part) {
                batch.set(db.doc(`attendance/${it.key}`), {
                    date: it.date,
                    verifiedAt: FV.serverTimestamp(),
                    verifiedBy: kakaoId,
                    managerName: mgr.name,
                    managerPosition: mgr.position,
                    managerSig: mgr.signature,
                    managerPhone: mgr.phone,
                    hospitalIdAtVerify: hospitalId,
                    hospitalNameAtVerify: hosp.data.name || '',   // 이름은 바뀔 수 있으므로 승인 시점 값을 스냅샷
                    verifyAuth: 'kakao+otp',
                }, { merge: true });
            }
            await batch.commit();
        }
        if (approved.length) {
            await mgrRef.update({
                lastApprovedAt: FV.serverTimestamp(),
                approveCount: FV.increment(approved.length),
                updatedAt: FV.serverTimestamp(),
            });
        }
        await audit('approve', kakaoId, {
            academyId, hospitalId, approvedCount: approved.length, skippedCount: skipped.length, approved,
        });
        return { approved, skipped };
    });
}

module.exports = { registerManagerFunctions };
