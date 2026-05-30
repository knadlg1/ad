/**
 * gas-monthly-billing.js
 * 기존 GAS 프로젝트(doPost 파일)에 아래 코드를 통째로 붙여넣으세요.
 *
 * 설정:
 *  1. TOSS_SECRET_KEY  → 토스페이먼츠 대시보드 > API 키 > 시크릿 키
 *  2. GAS 트리거 설정  → 편집 > 현재 프로젝트의 트리거 > + 트리거 추가
 *                         함수: monthlyAutoCharge
 *                         이벤트 소스: 시간 기반
 *                         유형: 월 타이머 > 매월 1일 오전 9시
 */

// ── 설정 ──────────────────────────────────────────────────────
const TOSS_SECRET_KEY  = 'YOUR_TOSS_SECRET_KEY_HERE'; // ← 실제 키로 교체
const FIREBASE_PROJECT = 'my-attendance-8122d';
const FIREBASE_API_KEY = 'AIzaSyBaCpQKykViq6526dCJ8mEYbUZqyg5-NUo';
const MONTHLY_AMOUNT   = 100000; // 100,000원

// ── 월자동결제 메인 함수 (트리거로 연결) ─────────────────────
function monthlyAutoCharge() {
    const kst      = getKSTDateString();         // "2026-05-15"
    const monthKey = kst.slice(0, 7);            // "2026-05"

    Logger.log(`[월자동결제] 실행: ${monthKey}`);

    const docs = getFirestoreDocs('directors');
    if (!docs) { Logger.log('directors 읽기 실패'); return; }

    for (const doc of docs) {
        const docId = doc.name.split('/').pop();
        const d     = flattenDoc(doc);

        if (d.status !== 'approved') continue;
        if (!d.billingKey)           continue;

        if (paymentExists(docId, monthKey)) {
            Logger.log(`[SKIP] ${d.academyName || docId} — 이미 결제됨`);
            continue;
        }

        const orderId = `monthly_${docId}_${monthKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        const result  = chargeWithBillingKey(d.billingKey, {
            customerKey: docId,
            amount:      MONTHLY_AMOUNT,
            orderId:     orderId,
            orderName:   `까마귀 월 이용료 (${monthKey})`,
        });

        if (result.success) {
            Logger.log(`[SUCCESS] ${d.academyName || docId}`);
            savePayment(docId, monthKey, orderId, 'paid', null);
            patchDirector(docId, { paymentStatus: 'active', lastPaymentAt: new Date().toISOString() });
        } else {
            Logger.log(`[FAIL] ${d.academyName || docId}: ${result.error}`);
            savePayment(docId, monthKey, orderId, 'failed', result.error);
            patchDirector(docId, { paymentStatus: 'overdue' });
        }
    }

    Logger.log(`[월자동결제] 완료`);
}

// ── 토스페이먼츠 빌링 API ─────────────────────────────────────
function chargeWithBillingKey(billingKey, params) {
    const encoded = Utilities.base64Encode(TOSS_SECRET_KEY + ':');
    const options = {
        method:             'post',
        headers:            { Authorization: 'Basic ' + encoded, 'Content-Type': 'application/json' },
        payload:            JSON.stringify(params),
        muteHttpExceptions: true,
    };
    try {
        const res  = UrlFetchApp.fetch('https://api.tosspayments.com/v1/billing/' + billingKey, options);
        const body = JSON.parse(res.getContentText());
        if (res.getResponseCode() === 200) return { success: true, data: body };
        return { success: false, error: body.message || ('HTTP ' + res.getResponseCode()) };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ── Firestore REST 헬퍼 ───────────────────────────────────────
function getFirestoreDocs(col) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${col}?key=${FIREBASE_API_KEY}&pageSize=500`;
    try {
        const res  = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        const data = JSON.parse(res.getContentText());
        return data.documents || [];
    } catch (e) {
        Logger.log('Firestore 읽기 오류: ' + e.message);
        return null;
    }
}

function flattenDoc(doc) {
    const out = {};
    for (const [k, v] of Object.entries(doc.fields || {})) {
        out[k] = v.stringValue ?? v.integerValue ?? v.booleanValue ?? null;
    }
    return out;
}

function paymentExists(directorId, monthKey) {
    const url  = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const body = JSON.stringify({
        structuredQuery: {
            from: [{ collectionId: 'payments' }],
            where: {
                compositeFilter: {
                    op: 'AND',
                    filters: [
                        { fieldFilter: { field: { fieldPath: 'directorId' }, op: 'EQUAL', value: { stringValue: directorId } } },
                        { fieldFilter: { field: { fieldPath: 'month' },      op: 'EQUAL', value: { stringValue: monthKey } } },
                        { fieldFilter: { field: { fieldPath: 'status' },     op: 'EQUAL', value: { stringValue: 'paid' } } },
                    ],
                },
            },
            limit: 1,
        },
    });
    try {
        const res  = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true });
        const data = JSON.parse(res.getContentText());
        return Array.isArray(data) && data.some(r => r.document);
    } catch (e) {
        return false;
    }
}

function savePayment(directorId, month, orderId, status, errorMsg) {
    const url    = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/payments?key=${FIREBASE_API_KEY}`;
    const fields = {
        directorId: { stringValue: directorId },
        month:      { stringValue: month },
        orderId:    { stringValue: orderId },
        amount:     { integerValue: String(MONTHLY_AMOUNT) },
        status:     { stringValue: status },
        paidAt:     status === 'paid' ? { timestampValue: new Date().toISOString() } : { nullValue: null },
        error:      errorMsg ? { stringValue: errorMsg } : { nullValue: null },
    };
    UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ fields }), muteHttpExceptions: true });
}

function patchDirector(docId, data) {
    const masks = Object.keys(data).map(k => 'updateMask.fieldPaths=' + k).join('&');
    const url   = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/directors/${docId}?${masks}&key=${FIREBASE_API_KEY}`;
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
        if (v === null || v === undefined) fields[k] = { nullValue: null };
        else fields[k] = { stringValue: String(v) };
    }
    UrlFetchApp.fetch(url, { method: 'patch', contentType: 'application/json', payload: JSON.stringify({ fields }), muteHttpExceptions: true });
}

function getKSTDateString() {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

// ── 수동 테스트용 ─────────────────────────────────────────────
// GAS 에디터에서 이 함수를 직접 실행하면 즉시 결제 시도합니다.
// 테스트 키 사용 시 실제 과금 없음.
function testMonthlyCharge() {
    monthlyAutoCharge();
}
