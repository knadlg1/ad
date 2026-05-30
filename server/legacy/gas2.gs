// ==================== Firestore 마이그레이션 ====================
var PROJECT_ID = 'my-attendance-8122d';
var FS_BASE = 'projects/' + PROJECT_ID + '/databases/(default)/documents';
var FS_URL = 'https://firestore.googleapis.com/v1/' + FS_BASE;

// ① 학생 데이터 이전 (1회 실행)
function migrateStudents() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('학생배치');
  var rows = sheet.getDataRange().getValues();
  var writes = [];

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var kakaoId = String(r[1] || '').trim();
    if (!kakaoId || kakaoId === '') continue;

    var role = String(r[20] || '').trim() === '원장님' ? 'admin' : 'student';

    writes.push({
      update: {
        name: FS_BASE + '/students/' + kakaoId,
        fields: {
          name:             fsStr(r[0]),
          kakaoId:          fsStr(kakaoId),
          phone:            fsStr(r[2]),
          hospital:         fsStr(r[3]),
          hospitalLat:      fsNum(r[4] || 35.0817),
          hospitalLon:      fsNum(r[5] || 128.9883),
          practiceStart:    fsStr(r[9]  ? fmtDate(r[9])  : ''),
          practiceEnd:      fsStr(r[10] ? fmtDate(r[10]) : ''),
          totalStart:       fsStr(r[11] ? fmtDate(r[11]) : ''),
          totalEnd:         fsStr(r[12] ? fmtDate(r[12]) : ''),
          totalHours:       fsNum(r[13] || 0),
          tardyCount:       fsNum(r[14] || 0),
          earlyCount:       fsNum(r[15] || 0),
          shiftType:        fsStr(r[19] || '주간'),
          role:             fsStr(role),
          status:           fsStr('active'),
          completedIntervals: fsStr(String(r[22] || '')),
          pendingRequest:   fsStr(String(r[18] || ''))
        }
      }
    });
  }

  batchWrite(writes);
  Logger.log('학생 이전 완료: ' + (writes.length) + '명');
}

// ② 출석 기록 이전 (1회 실행)
function migrateAttendance() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('출석기록');
  var rows = sheet.getDataRange().getValues();

  // 같은 kakaoId + 날짜 행 합치기
  var map = {};
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var kakaoId = String(r[3] || '').trim();
    var dateStr  = r[0] instanceof Date ? fmtDate(r[0]) : String(r[0]).substring(0, 10);
    if (!kakaoId || !dateStr || dateStr.length < 8) continue;

    var key = kakaoId + '_' + dateStr;
    if (!map[key]) {
      map[key] = {
        kakaoId: kakaoId, name: String(r[1] || ''),
        phone: String(r[2] || ''), hospital: String(r[4] || ''),
        date: dateStr, inTime: '', outTime: '',
        inAccuracy: '', inDistance: '', outAccuracy: '', outDistance: ''
      };
    }
    var inVal  = r[5];
    var outVal = r[8];
    if (inVal  instanceof Date) inVal  = fmtTime(new Date(inVal.getTime()  - 1928000));
    if (outVal instanceof Date) outVal = fmtTime(new Date(outVal.getTime() - 1928000));
    if (inVal  && String(inVal).trim()  !== '') map[key].inTime      = String(inVal).trim();
    if (r[6]   && String(r[6]).trim()   !== '') map[key].inAccuracy  = String(r[6]).trim();
    if (r[7]   && String(r[7]).trim()   !== '') map[key].inDistance  = String(r[7]).trim();
    if (outVal && String(outVal).trim() !== '') map[key].outTime     = String(outVal).trim();
    if (r[9]   && String(r[9]).trim()   !== '') map[key].outAccuracy = String(r[9]).trim();
    if (r[10]  && String(r[10]).trim()  !== '') map[key].outDistance = String(r[10]).trim();
  }

  var writes = [];
  for (var key in map) {
    var d = map[key];
    writes.push({
      update: {
        name: FS_BASE + '/attendance/' + key,
        fields: {
          kakaoId:     fsStr(d.kakaoId),
          name:        fsStr(d.name),
          phone:       fsStr(d.phone),
          hospital:    fsStr(d.hospital),
          date:        fsStr(d.date),
          inTime:      fsStr(d.inTime),
          outTime:     fsStr(d.outTime),
          inAccuracy:  fsStr(d.inAccuracy),
          inDistance:  fsStr(d.inDistance),
          outAccuracy: fsStr(d.outAccuracy),
          outDistance: fsStr(d.outDistance)
        }
      }
    });
  }

  batchWrite(writes);
  Logger.log('출석 이전 완료: ' + writes.length + '건');
}

// ==================== 헬퍼 함수 ====================
function batchWrite(writes) {
  var token = ScriptApp.getOAuthToken();
  var url = FS_URL + ':batchWrite';
  var size = 500;

  for (var i = 0; i < writes.length; i += size) {
    var chunk = writes.slice(i, i + size);
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ writes: chunk }),
      muteHttpExceptions: true
    });
    Logger.log('배치 ' + Math.ceil((i + 1) / size) + ': ' + res.getResponseCode());
if (res.getResponseCode() !== 200) {
  Logger.log('에러 내용: ' + res.getContentText());
}
    Utilities.sleep(300);
  }
}

function fmtDate(d) {
  return Utilities.formatDate(new Date(d), 'GMT+9', 'yyyy-MM-dd');
}
function fmtTime(d) {
  return Utilities.formatDate(d, 'GMT+9', 'HH:mm:ss');
}
function fsStr(v) {
  if (v === null || v === undefined) return { stringValue: '' };
  if (v instanceof Date) return { stringValue: fmtDate(v) };
  return { stringValue: String(v) };
}
function fsNum(v) {
  var n = parseFloat(v);
  return { doubleValue: isNaN(n) ? 0 : n };
}

function approveAllStudents() {
  var token = ScriptApp.getOAuthToken();
  var PROJECT_ID = 'my-attendance-8122d';
  var FS_URL = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID + '/databases/(default)/documents';
  
  // students 컬렉션 전체 조회
  var url = FS_URL + '/students?pageSize=200';
  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token }
  });
  var data = JSON.parse(res.getContentText());
  var docs = data.documents || [];
  
  var count = 0;
  docs.forEach(function(doc) {
    var fields = doc.fields || {};
    var status = fields.status ? fields.status.stringValue : '';
    
    // pending이거나 status 없는 경우 모두 approved로 설정
    if (status !== 'approved') {
      var docName = doc.name; // 전체 경로
      var patchUrl = 'https://firestore.googleapis.com/v1/' + docName + '?updateMask.fieldPaths=status';
      UrlFetchApp.fetch(patchUrl, {
        method: 'PATCH',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({
          fields: { status: { stringValue: 'approved' } }
        })
      });
      count++;
    }
  });
  
  Logger.log('승인 완료: ' + count + '명');
}