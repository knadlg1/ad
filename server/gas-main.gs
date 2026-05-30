// ==================== 설정 ====================
const KAKAO_REST_API_KEY = 'ca34b3c2a0cf2d0fe87d9f18b39aa8d8';

const ALIGO_API_KEY = 'fmtbgsvith1i5vra7afmdg56g8y4ph3x';
const ALIGO_USER_ID  = 'sahajeil2556';
const ALIGO_SENDER   = '01093234333';

var PROJECT_ID = 'my-attendance-8122d';
var FS_BASE    = 'projects/' + PROJECT_ID + '/databases/(default)/documents';
var FS_URL     = 'https://firestore.googleapis.com/v1/' + FS_BASE;

const TOSS_SECRET_KEY = 'YOUR_TOSS_SECRET_KEY_HERE'; // ← 토스 대시보드 시크릿 키로 교체
const MONTHLY_AMOUNT  = 100000; // 월 이용료 100,000원

// 구글 드라이브 문서/폴더 ID
var TEMPLATE_MISSING_DOC_ID = '1B6JjJRg6ySRwZK47BeWBL4CL5n51yFh7UO2oYHe3eFQ';
var FOLDER_MISSING_ID       = '1MIi3S-v0mKr5ra2pxMZHemRLtj2twWG-';
var TEMPLATE_CARD_DOC_ID    = '1z-OSf6lLiLNmFI2tDzUY7_U_0wzNiqm5Be_Sze2ltzw';
var FOLDER_CARD_ID          = '1r8NuI3cHADTj06ohBer74FAlHPHj9ZTX';
var PROOF_FOLDER_ID         = '1mnbwWVPtLBE0ADMHM3AcPhkgldXFqFqn';
var CERT_TEMPLATE_ID        = '12_IAXnELoYksXwWDPeE3N2tde5XjjD_jL5zezTrbQa0';
var CERT_FOLDER_ID          = '1nX2VfF5kmJW4gdQczQ7seMyKjQ4AT7Ph';

// ==================== doGet ====================
function doGet() {
  return ContentService
    .createTextOutput("서버 정상 작동 중")
    .setMimeType(ContentService.MimeType.TEXT);
}

// ==================== doPost ====================
function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var studentSheet = ss.getSheetByName("학생배치");
    var recordSheet  = ss.getSheetByName("출석기록");

    if (!studentSheet) {
      studentSheet = ss.insertSheet("학생배치");
      studentSheet.appendRow(["학생명","카카오ID","전화번호","실습병원명","병원위도","병원경도","디바이스ID","등록일시","최종접속"]);
    }
    if (!recordSheet) {
      recordSheet = ss.insertSheet("출석기록");
      recordSheet.appendRow(["날짜","학생명","전화번호","카카오ID","병원명","출근시간","출근GPS정확도","출근거리","퇴근시간","퇴근GPS정확도","퇴근거리"]);
    }
    var submitSheet = ss.getSheetByName("서명제출내역");
    if (!submitSheet) {
      submitSheet = ss.insertSheet("서명제출내역");
      submitSheet.appendRow(["제출일시","학생명","카카오ID","회차기간","문서링크"]);
    }

    var data = JSON.parse(e.postData.contents);
    console.log('요청 액션:', data.action);

    switch (data.action) {
      case 'getKakaoUser':                  return handleGetKakaoUser(data);
      case 'checkStudent':                  return handleCheckStudent(data, studentSheet);
      case 'registerStudent':               return handleRegisterStudent(data, studentSheet);
      case 'changeDevice':                  return handleChangeDevice(data, studentSheet);
      case 'getTodayStatus':                return handleGetTodayStatus(data, recordSheet);
      case 'submitMissingVacation':         return submitMissingVacation(data, recordSheet);
      case 'submitPendingMissingAttendance':return submitPendingMissingAttendance(data, ss);
      case 'requestOTP':                    return sendOtpToManager(data);
      case 'verifyOTP':                     return verifyManagerOtp(data);
      case 'getMonthlyRecords':             return handleGetMonthlyRecords(data, studentSheet, recordSheet);
      case 'submitToGoogleDoc':             return handleSubmitToGoogleDoc(data, submitSheet);
      case 'getStudentStats':               return handleGetStudentStats(data, studentSheet, recordSheet);
      case 'uploadProofDocument':           return uploadProofDocument(data, ss);
      case 'generateCertificate':           return handleGenerateCertificate(data, ss);
      case 'getHistory':                    return handleGetHistory(data, ss);
      case 'recordAttendance':              return handleRecordAttendance(data, studentSheet, recordSheet);
      case 'getStudentList':                return getStudentList(studentSheet);
      case 'sendDocumentRequest':           return sendDocumentRequest(data, studentSheet);
      case 'updateStudentHospital':         return updateStudentHospital(data, studentSheet);
      // [BUG FIX] approveMissingAttendance는 plain object 반환하므로 createResponse로 감쌈
      case 'approveMissingAttendance':      return createResponse(approveMissingAttendance(data));
      // [BUG FIX] getPendingApprovals 스위치 추가 (기존 코드에 없던 것)
      case 'getPendingApprovals':           return createResponse(getPendingApprovals());
      // [NEW] 토스 빌링키 발급
      case 'issueBillingKey':              return issueBillingKey(data);
      default:                              return createResponse({status:'error', message:'Unknown action'});
    }
  } catch (error) {
    console.error('doPost 에러:', error);
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 카카오 사용자 정보 ====================
function handleGetKakaoUser(data) {
  try {
    const tokenUrl = 'https://kauth.kakao.com/oauth/token';
    const tokenOptions = {
      method: 'post',
      payload: {
        grant_type: 'authorization_code',
        client_id: KAKAO_REST_API_KEY,
        redirect_uri: data.redirect_uri,
        code: data.code
      },
      muteHttpExceptions: true
    };
    const tokenResponse = UrlFetchApp.fetch(tokenUrl, tokenOptions);
    const tokenData = JSON.parse(tokenResponse.getContentText());

    if (tokenData.error) return createResponse({status:'error', message: tokenData.error_description});
    if (!tokenData.access_token) return createResponse({status:'error', message:'액세스 토큰 없음'});

    const userResponse = UrlFetchApp.fetch('https://kapi.kakao.com/v2/user/me', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
      muteHttpExceptions: true
    });
    const userData = JSON.parse(userResponse.getContentText());

    if (userData.id) {
      return createResponse({
        status: 'success',
        kakaoId: userData.id.toString(),
        nickname: userData.properties?.nickname || '',
        email: userData.kakao_account?.email || ''
      });
    }
    return createResponse({status:'error', message:'사용자 정보 없음'});
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 학생 확인 ====================
function handleCheckStudent(data, studentSheet) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var submitSheet = ss.getSheetByName("서명제출내역");
    var recordSheet = ss.getSheetByName("출석기록");
    var submitData  = submitSheet ? submitSheet.getDataRange().getValues() : [];
    var studentData = studentSheet.getDataRange().getValues();
    var todayStr    = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
    var displayDateStr = Utilities.formatDate(new Date(), "GMT+9", "yy.MM.dd");

    for (var i = 1; i < studentData.length; i++) {
      if (String(studentData[i][1]) !== String(data.kakaoId)) continue;

      var savedDeviceId   = String(studentData[i][6]);
      var currentDeviceId = String(data.deviceId);
      if (savedDeviceId && savedDeviceId !== "" && savedDeviceId !== currentDeviceId) {
        return createResponse({status:'device_mismatch', message:'등록된 기기가 아닙니다.'});
      } else {
        studentSheet.getRange(i + 1, 7).setValue(currentDeviceId);
      }

      // 회차 계산
      var intervals     = [];
      var startDateObj  = studentData[i][11];
      var endDateObj    = studentData[i][12];
      if (startDateObj && endDateObj) {
        var start        = new Date(startDateObj);
        var finalEnd     = new Date(endDateObj);
        var today        = new Date();
        var currentStart = new Date(start);
        var round        = 1;
        var completedRaw = String(studentData[i][22] || "");
        var completedSet = {};
        completedRaw.split(",").forEach(function(s) { if(s.trim()) completedSet[s.trim()] = true; });

        while (currentStart <= finalEnd) {
          var currentEnd = new Date(currentStart);
          currentEnd.setDate(currentStart.getDate() + 29);
          if (currentEnd > finalEnd) currentEnd = new Date(finalEnd);
          var sDateStr   = Utilities.formatDate(currentStart, "GMT+9", "yyyy-MM-dd");
          var eDateStr   = Utilities.formatDate(currentEnd,   "GMT+9", "yyyy-MM-dd");
          var intervalStr = sDateStr + " ~ " + eDateStr;
          var isSubmitted = completedSet[intervalStr] === true;
          var nextDayStart = new Date(currentEnd);
          nextDayStart.setDate(currentEnd.getDate() + 1);
          nextDayStart.setHours(0,0,0,0);
          var status = 'locked';
          if (isSubmitted) status = 'completed';
          else if (today >= nextDayStart) status = 'available';
          intervals.push({round:round, intervalStr:intervalStr, startDate:sDateStr, endDate:eDateStr, status:status});
          currentStart = new Date(currentEnd);
          currentStart.setDate(currentEnd.getDate() + 1);
          round++;
        }
      }

      var userRole = studentData[i][20] === "원장님" ? "admin" : "student";

      // 오늘 출결 상태
      var checkIn = "", checkOut = "", missingRecord = null, foundPastDay = false;
      if (recordSheet) {
        var lastRow  = recordSheet.getLastRow();
        var startRow = Math.max(2, lastRow - 300);
        var numRows  = Math.max(0, lastRow - startRow + 1);
        var records  = numRows > 0 ? recordSheet.getRange(startRow, 1, numRows, 11).getValues() : [];

        for (var r = records.length - 1; r >= 0; r--) {
          if (String(records[r][3]) !== String(data.kakaoId)) continue;
          var rowDateObj = new Date(records[r][0]);
          var rowDateStr = Utilities.formatDate(rowDateObj, "GMT+9", "yyyy-MM-dd");

          if (rowDateStr === todayStr) {
            var inVal  = records[r][5];
            var outVal = records[r][8];
            if (inVal  instanceof Date) inVal  = Utilities.formatDate(new Date(inVal.getTime()  - 1928000), "GMT+9", "HH:mm:ss");
            if (outVal instanceof Date) outVal = Utilities.formatDate(new Date(outVal.getTime() - 1928000), "GMT+9", "HH:mm:ss");
            if (outVal && outVal !== "" && checkOut === "") checkOut = displayDateStr + " " + outVal;
            if (inVal  && inVal  !== "" && checkIn  === "") checkIn  = displayDateStr + " " + inVal;
          } else {
            if (!foundPastDay) {
              var dayOfWeek = rowDateObj.getDay();
              if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isKoreanHoliday(rowDateObj) && rowDateStr < todayStr) {
                foundPastDay = true;
                var pIn  = records[r][5] || "";
                var pOut = records[r][8] || "";
                var rowNum = startRow + r;
                if (pIn !== "" && pOut === "") missingRecord = {date:rowDateStr, type:'퇴근', row:rowNum};
                else if (pIn === "" && pOut !== "") missingRecord = {date:rowDateStr, type:'출근', row:rowNum};
                else if (pIn !== "" && pOut !== "") {
                  var diff = timeToMins(pOut) - timeToMins(pIn);
                  if (diff >= 0 && diff <= 10) missingRecord = {date:rowDateStr, type:'출근', row:rowNum};
                }
              }
            }
          }
          if (checkIn !== "" && foundPastDay) break;
        }
      }

      var totalPeriodStr = "-";
      if (studentData[i][9] && studentData[i][10]) {
        totalPeriodStr = Utilities.formatDate(new Date(studentData[i][9]),  "GMT+9", "yy.MM.dd")
                       + " ~ "
                       + Utilities.formatDate(new Date(studentData[i][10]), "GMT+9", "yy.MM.dd");
      }
      var lastUpdated = studentData[i][17]
        ? Utilities.formatDate(new Date(studentData[i][17]), "GMT+9", "yy.MM.dd HH:mm")
        : "업데이트 전";
      var pendingReq = studentData[i][18] ? String(studentData[i][18]) : "";

      return createResponse({
        status: 'found',
        name: studentData[i][0], phone: studentData[i][2],
        hospital: studentData[i][3],
        hospitalLat: parseFloat(studentData[i][4]) || 37.5665,
        hospitalLon: parseFloat(studentData[i][5]) || 126.9780,
        intervals: intervals, role: userRole,
        todayStatus: {checkIn:checkIn, checkOut:checkOut, missingRecord:missingRecord},
        stats: {
          totalPeriodStr: totalPeriodStr,
          totalHours:  parseInt(studentData[i][13]) || 0,
          tardyCount:  parseInt(studentData[i][14]) || 0,
          earlyCount:  parseInt(studentData[i][15]) || 0,
          outCount:    parseInt(studentData[i][16]) || 0,
          lastUpdated: lastUpdated,
          pendingRequest: pendingReq
        }
      });
    }
    return createResponse({status:'not_found'});
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 신규 학생 등록 ====================
function handleRegisterStudent(data, studentSheet) {
  try {
    var studentData  = studentSheet.getDataRange().getValues();
    var inputName    = data.name.replace(/\s/g, "");
    var inputPhone   = data.phone.replace(/[^0-9]/g, "");

    for (var i = 1; i < studentData.length; i++) {
      var sheetName  = studentData[i][0].toString().replace(/\s/g, "");
      var sheetPhone = studentData[i][2].toString().replace(/[^0-9]/g, "");
      if (sheetName !== inputName || sheetPhone !== inputPhone) continue;

      if (studentData[i][1] && studentData[i][1] !== "" && String(studentData[i][1]) !== String(data.kakaoId)) {
        return createResponse({status:'fail', message:'이미 다른 카카오 계정으로 등록되어 있습니다.'});
      }
      var savedDevice   = String(studentData[i][6]);
      var currentDevice = String(data.deviceId);
      if (savedDevice && savedDevice !== "" && savedDevice !== "undefined" && savedDevice !== currentDevice) {
        return createResponse({status:'fail', message:'이미 다른 기기에서 등록되어 있습니다. 학원에 문의하세요.'});
      }

      studentSheet.getRange(i + 1, 2).setValue(data.kakaoId);
      studentSheet.getRange(i + 1, 7).setValue(currentDevice);
      studentSheet.getRange(i + 1, 8).setValue(new Date());
      studentSheet.getRange(i + 1, 9).setValue(new Date());

      return createResponse({
        status: 'success', name: studentData[i][0], phone: studentData[i][2],
        hospital: studentData[i][3],
        hospitalLat: parseFloat(studentData[i][4]) || 37.5665,
        hospitalLon: parseFloat(studentData[i][5]) || 126.9780
      });
    }
    return createResponse({status:'fail', message:'등록된 수강생이 아닙니다. 학원에 문의하세요.'});
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 기기 변경 ====================
function handleChangeDevice(data, studentSheet) {
  try {
    var studentData = studentSheet.getDataRange().getValues();
    var inputName   = data.name.replace(/\s/g, "");
    var inputPhone  = data.phone.replace(/[^0-9]/g, "");

    for (var i = 1; i < studentData.length; i++) {
      var sheetName  = studentData[i][0].toString().replace(/\s/g, "");
      var sheetPhone = studentData[i][2].toString().replace(/[^0-9]/g, "");
      if (sheetName !== inputName || sheetPhone !== inputPhone) continue;

      studentSheet.getRange(i + 1, 2).setValue(data.newKakaoId);
      studentSheet.getRange(i + 1, 7).setValue(data.newDeviceId);
      studentSheet.getRange(i + 1, 9).setValue(new Date());

      return createResponse({
        status: 'success', name: studentData[i][0], phone: studentData[i][2],
        hospital: studentData[i][3],
        hospitalLat: parseFloat(studentData[i][4]) || 37.5665,
        hospitalLon: parseFloat(studentData[i][5]) || 126.9780
      });
    }
    return createResponse({status:'fail', message:'정보가 일치하지 않습니다.'});
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 오늘 출결 상태 ====================
function handleGetTodayStatus(data, recordSheet) {
  try {
    var todayStr       = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
    var displayDateStr = Utilities.formatDate(new Date(), "GMT+9", "yy.MM.dd");
    var checkIn = "", checkOut = "";
    var missingRecords = [], added = {};

    var lastRow  = recordSheet.getLastRow();
    var startRow = Math.max(2, lastRow - 300);
    var numRows  = Math.max(0, lastRow - startRow + 1);
    var records  = numRows > 0 ? recordSheet.getRange(startRow, 1, numRows, 11).getValues() : [];

    for (var i = records.length - 1; i >= 0; i--) {
      if (String(records[i][3]) !== String(data.kakaoId)) continue;
      var rowDateObj = new Date(records[i][0]);
      var rowDateStr = Utilities.formatDate(rowDateObj, "GMT+9", "yyyy-MM-dd");

      if (rowDateStr === todayStr) {
        var inVal  = records[i][5];
        var outVal = records[i][8];
        if (inVal  instanceof Date) inVal  = Utilities.formatDate(new Date(inVal.getTime()  - 1928000), "GMT+9", "HH:mm:ss");
        if (outVal instanceof Date) outVal = Utilities.formatDate(new Date(outVal.getTime() - 1928000), "GMT+9", "HH:mm:ss");
        if (outVal && outVal !== "" && checkOut === "") checkOut = displayDateStr + " " + outVal;
        if (inVal  && inVal  !== "" && checkIn  === "") checkIn  = displayDateStr + " " + inVal;
      } else {
        var dow = rowDateObj.getDay();
        if (dow !== 0 && dow !== 6 && !isKoreanHoliday(rowDateObj) && rowDateStr < todayStr) {
          var pIn  = records[i][5] || "";
          var pOut = records[i][8] || "";
          var rowNum = startRow + i;
          var mType  = "";
          if (pIn !== "" && pOut === "")  mType = "퇴근";
          else if (pIn === "" && pOut !== "") mType = "출근";
          else if (pIn !== "" && pOut !== "") {
            var diff = timeToMins(pOut) - timeToMins(pIn);
            if (diff >= 0 && diff <= 10) mType = "출근";
          }
          if (mType) {
            var key = rowDateStr + "_" + rowNum;
            if (!added[key]) { missingRecords.push({date:rowDateStr, type:mType, row:rowNum}); added[key] = true; }
          }
        }
      }
    }
    return createResponse({
      status: 'success', checkIn: checkIn, checkOut: checkOut,
      missingRecord:  missingRecords.length > 0 ? missingRecords[0] : null,
      missingRecords: missingRecords
    });
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 출퇴근 기록 ====================
function handleRecordAttendance(data, studentSheet, recordSheet) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var todayStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
    var lastRow  = recordSheet.getLastRow();
    var startRow = Math.max(2, lastRow - 300);
    var numRows  = Math.max(0, lastRow - startRow + 1);
    var records  = numRows > 0 ? recordSheet.getRange(startRow, 1, numRows, recordSheet.getLastColumn()).getValues() : [];

    var alreadyCheckedIn = false, alreadyCheckedOut = false, latestInTime = "-";
    var targetRowIndex = -1;

    for (var i = records.length - 1; i >= 0; i--) {
      var rowDateStr = (records[i][0] instanceof Date)
        ? Utilities.formatDate(records[i][0], "GMT+9", "yyyy-MM-dd")
        : String(records[i][0]).substring(0, 10);
      if (rowDateStr !== todayStr || String(records[i][3]) !== String(data.kakaoId)) continue;
      if (records[i][5] && records[i][5] !== "" && !alreadyCheckedIn) {
        alreadyCheckedIn = true; latestInTime = String(records[i][5]); targetRowIndex = startRow + i;
      }
      if (records[i][8] && records[i][8] !== "" && !alreadyCheckedOut) alreadyCheckedOut = true;
    }

    if (data.type === "출근") {
      if (alreadyCheckedIn) return createResponse({status:'duplicate', message:'이미 출근 처리되었습니다.'});
      recordSheet.appendRow([todayStr, data.name, data.phone||"", data.kakaoId, data.hospital, data.time, data.accuracy||"", data.distance||"", "", "", ""]);
      return createResponse({status:'success'});
    } else if (data.type === "퇴근") {
      if (alreadyCheckedOut) return createResponse({status:'duplicate', message:'이미 퇴근 처리되었습니다.'});
      if (targetRowIndex !== -1) {
        recordSheet.getRange(targetRowIndex, 9).setValue(data.time);
        recordSheet.getRange(targetRowIndex, 10).setValue(data.accuracy||"");
        recordSheet.getRange(targetRowIndex, 11).setValue(data.distance||"");
      } else {
        recordSheet.appendRow([todayStr, data.name, data.phone||"", data.kakaoId, data.hospital, "", "", "", data.time, data.accuracy||"", data.distance||""]);
      }
      return createResponse({status:'success'});
    }
    return createResponse({status:'error', message:'Invalid type'});
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  } finally {
    lock.releaseLock();
  }
}

// ==================== 누락 - 휴가/기타 즉시 제출 ====================
function submitMissingVacation(data, recordSheet) {
  try {
    recordSheet.getRange(data.row, 6).setValue("휴가/기타");
    recordSheet.getRange(data.row, 9).setValue("휴가/기타");
    return createResponse({status:'success'});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 누락 서명 제출 (구글문서 자동생성) ====================
function submitPendingMissingAttendance(data, ss) {
  try {
    if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
    var studentSheet = ss.getSheetByName("학생배치");
    var sData        = studentSheet.getDataRange().getValues();
    var totalPeriod  = "-";
    var hospitalName = data.hospital || "실습병원";

    for (var i = 1; i < sData.length; i++) {
      if (String(sData[i][1]) !== String(data.kakaoId)) continue;
      var sDate = sData[i][11] ? Utilities.formatDate(new Date(sData[i][11]), "GMT+9", "yyyy-MM-dd") : "";
      var eDate = sData[i][12] ? Utilities.formatDate(new Date(sData[i][12]), "GMT+9", "yyyy-MM-dd") : "";
      if (sDate && eDate) totalPeriod = sDate + " ~ " + eDate;
      hospitalName = sData[i][3];
      break;
    }

    var exactMissingTime = "";
    if (data.missingType === '출근')       exactMissingTime = data.inTime;
    else if (data.missingType === '퇴근')  exactMissingTime = data.outTime;
    else                                   exactMissingTime = data.inTime + " / 퇴근 " + data.outTime;

    var templateFile = DriveApp.getFileById(TEMPLATE_MISSING_DOC_ID);
    var targetFolder = DriveApp.getFolderById(FOLDER_MISSING_ID);
    var newFileName  = data.name + "_" + data.missingDate + "_" + data.missingType + "누락확인서";
    var newFile      = templateFile.makeCopy(newFileName, targetFolder);
    var doc          = DocumentApp.openById(newFile.getId());
    var body         = doc.getBody();

    body.replaceText("{{반코드}}", "");
    body.replaceText("{{실습기간}}", totalPeriod);
    body.replaceText("{{실습병원명}}", hospitalName);
    body.replaceText("{{학생이름}}", data.name);
    body.replaceText("{{담당자번호}}", data.managerPhone);
    body.replaceText("{{누락날짜}}", data.missingDate);
    body.replaceText("{{누락유형}}", data.missingType);
    body.replaceText("{{누락시간}}", exactMissingTime);
    replaceTextWithImage(body, "{{학생서명}}", data.studentSig);
    replaceTextWithImage(body, "{{담당자서명}}", data.managerSig);
    doc.saveAndClose();
    var docUrl = newFile.getUrl();

    var pendingSheet = ss.getSheetByName("누락승인대기");
    if (!pendingSheet) {
      pendingSheet = ss.insertSheet("누락승인대기");
      pendingSheet.appendRow(["제출일시","카카오ID","학생명","누락일","누락유형","담당자번호","상태","출석기록행","출근입력시간","퇴근입력시간"]);
    }
    var timeStamp = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm:ss");
    pendingSheet.appendRow([timeStamp, data.kakaoId, data.name, data.missingDate, data.missingType, data.managerPhone, "대기", data.row, data.inTime, data.outTime]);

    var logSheet = ss.getSheetByName("출퇴누락제출내역");
    if (!logSheet) {
      logSheet = ss.insertSheet("출퇴누락제출내역");
      var hdr = logSheet.getRange("A1:F1");
      hdr.setValues([["제출일시","학생명","누락일자","누락유형","담당자번호","확인서_문서링크"]]);
      hdr.setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
      logSheet.setFrozenRows(1);
    }
    logSheet.appendRow([timeStamp, data.name, data.missingDate, data.missingType, data.managerPhone, docUrl]);

    return createResponse({status:'success', message:'성공'});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 담당자 OTP 발송 ====================
function sendOtpToManager(data) {
  var cache   = CacheService.getScriptCache();
  var phone   = data.phone;
  var otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  cache.put(phone, otpCode, 300);

  try {
    var payload = {
      key:      ALIGO_API_KEY,
      user_id:  ALIGO_USER_ID,
      sender:   ALIGO_SENDER,
      receiver: phone,
      msg:      "[까마귀 출결관리]\n담당자 서명 인증번호 [" + otpCode + "]를 입력해주세요."
    };
    var res     = UrlFetchApp.fetch("https://apis.aligo.in/send/", {method:"post", payload:payload, muteHttpExceptions:true});
    var resData = JSON.parse(res.getContentText());
    if (resData.result_code == "1") return createResponse({status:'success', message:'인증번호가 발송되었습니다.'});
    return createResponse({status:'error', message:'문자 발송 실패: ' + resData.message});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 담당자 OTP 검증 ====================
// [BUG FIX] verified: true 추가 (HTML에서 data.verified 를 체크함)
function verifyManagerOtp(data) {
  try {
    var phone    = data.phone;
    var inputOtp = data.otp;
    var cache     = CacheService.getScriptCache();
    var storedOtp = cache.get(phone);
    if (storedOtp && storedOtp === inputOtp) {
      cache.remove(phone);
      return createResponse({status:'success', verified:true, message:'인증이 완료되었습니다.'});
    }
    return createResponse({status:'error', verified:false, message:'인증번호가 불일치하거나 만료되었습니다.'});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 월간 서명 데이터 ====================
function handleGetMonthlyRecords(data, studentSheet, recordSheet) {
  try {
    var kakaoId      = String(data.kakaoId);
    var startDateObj = new Date(data.targetStartDate);
    var endDateObj   = new Date(data.targetEndDate);
    var records      = recordSheet.getDataRange().getDisplayValues();
    var studentData  = studentSheet.getDataRange().getValues();
    var shiftType    = "주간", isJabi = false;

    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) === kakaoId) {
        if (studentData[s][19]) shiftType = String(studentData[s][19]).trim();
        if (String(studentData[s][20]).trim() === "자비") isJabi = true;
        break;
      }
    }

    var monthlyData = [], totalHours = 0;
    var diffDays = Math.ceil(Math.abs(endDateObj - startDateObj) / (1000*60*60*24)) + 1;

    for (var dayOffset = 0; dayOffset < diffDays; dayOffset++) {
      var currentDate = new Date(startDateObj.getTime());
      currentDate.setDate(startDateObj.getDate() + dayOffset);
      var dateStr        = Utilities.formatDate(currentDate, "GMT+9", "yyyy-MM-dd");
      var isHolidayDay   = (currentDate.getDay() === 0 || currentDate.getDay() === 6 || isKoreanHoliday(currentDate));
      var dailyRecord    = {date:dateStr, month:currentDate.getMonth()+1, day:currentDate.getDate(), dayOfWeek:currentDate.getDay(), isAbsent:true, isHoliday:isHolidayDay, checkIn:"-", checkOut:"-", workHours:0};

      for (var r = records.length - 1; r >= 1; r--) {
        if (records[r][0] !== dateStr || String(records[r][3]) !== kakaoId) continue;
        if (records[r][8] && records[r][8] !== "" && dailyRecord.checkOut === "-") dailyRecord.checkOut = String(records[r][8]);
        if (records[r][5] && records[r][5] !== "" && dailyRecord.checkIn  === "-") { dailyRecord.isAbsent = false; dailyRecord.checkIn = String(records[r][5]); }
        if (dailyRecord.checkIn !== "-" && dailyRecord.checkOut !== "-") break;
      }
      if (dailyRecord.checkIn !== "-" && dailyRecord.checkOut !== "-") {
        var logicResult = calculateTimeLogic(dailyRecord.checkIn, dailyRecord.checkOut, shiftType, currentDate, isJabi);
        if (logicResult.isAbsent) dailyRecord.isAbsent = true;
        dailyRecord.workHours = logicResult.hours + "h";
        totalHours += logicResult.hours;
      }
      monthlyData.push(dailyRecord);
    }
    return createResponse({
      status: 'success',
      startDate: Utilities.formatDate(startDateObj, "GMT+9", "yyyy-MM-dd"),
      endDate:   Utilities.formatDate(endDateObj,   "GMT+9", "yyyy-MM-dd"),
      totalHours: totalHours, records: monthlyData
    });
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 통계 가져오기 ====================
function handleGetStudentStats(data, studentSheet) {
  try {
    var studentData    = studentSheet.getDataRange().getValues();
    var totalPeriodStr = "-";
    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) !== String(data.kakaoId)) continue;
      if (studentData[s][9] && studentData[s][10]) {
        totalPeriodStr = Utilities.formatDate(new Date(studentData[s][9]),  "GMT+9", "yy.MM.dd")
                       + " ~ "
                       + Utilities.formatDate(new Date(studentData[s][10]), "GMT+9", "yy.MM.dd");
      }
      var lastUpdated = studentData[s][17]
        ? Utilities.formatDate(new Date(studentData[s][17]), "GMT+9", "yy.MM.dd HH:mm")
        : "업데이트 전";
      return createResponse({
        status: 'success',
        totalPeriodStr: totalPeriodStr,
        totalHours:  parseInt(studentData[s][13]) || 0,
        tardyCount:  parseInt(studentData[s][14]) || 0,
        earlyCount:  parseInt(studentData[s][15]) || 0,
        outCount:    parseInt(studentData[s][16]) || 0,
        lastUpdated: lastUpdated,
        pendingRequest: studentData[s][18] ? String(studentData[s][18]) : ""
      });
    }
    return createResponse({status:'error', message:'학생 정보를 찾을 수 없습니다.'});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 원장님 전용: 학생 목록 ====================
function getStudentList(studentSheet) {
  try {
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    var data = studentSheet.getDataRange().getValues();
    var list = [];
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] && data[i][20] !== "원장님") {
        list.push({name:data[i][0], kakaoId:data[i][1]});
      }
    }
    var hospitalSheet = ss.getSheetByName("병원목록");
    var hospitals = [];
    if (hospitalSheet) {
      var hData = hospitalSheet.getDataRange().getValues();
      for (var j = 1; j < hData.length; j++) {
        if (hData[j][0] && hData[j][0] !== "") {
          hospitals.push({name:hData[j][0], lat:hData[j][1], lon:hData[j][2]});
        }
      }
    }
    return createResponse({status:'success', students:list, hospitals:hospitals});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 원장님 전용: 서류 요청 ====================
function sendDocumentRequest(data, studentSheet) {
  try {
    var sData = studentSheet.getDataRange().getValues();
    for (var i = 1; i < sData.length; i++) {
      if (String(sData[i][1]) === String(data.targetKakaoId)) {
        studentSheet.getRange(i + 1, 19).setValue(data.docType);
        return createResponse({status:'success'});
      }
    }
    return createResponse({status:'error', message:'학생을 찾을 수 없습니다.'});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 원장님 전용: 병원 변경 ====================
function updateStudentHospital(data, studentSheet) {
  try {
    var sData = studentSheet.getDataRange().getValues();
    for (var i = 1; i < sData.length; i++) {
      if (String(sData[i][1]) === String(data.targetKakaoId)) {
        studentSheet.getRange(i + 1, 4).setValue(data.hospitalName);
        studentSheet.getRange(i + 1, 5).setValue(data.hospitalLat);
        studentSheet.getRange(i + 1, 6).setValue(data.hospitalLon);
        return createResponse({status:'success'});
      }
    }
    return createResponse({status:'error', message:'학생을 찾을 수 없습니다.'});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 원장님 전용: 누락 승인 대기 목록 ====================
// [BUG FIX] 반환 키 data→records, 필드명 HTML 기준으로 수정
function getPendingApprovals() {
  try {
    var ss           = SpreadsheetApp.getActiveSpreadsheet();
    var pendingSheet = ss.getSheetByName("누락승인대기");
    if (!pendingSheet) return {status:'success', records:[]};

    var rows        = pendingSheet.getDataRange().getValues();
    var pendingList = [];
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][6] !== "대기") continue;
      pendingList.push({
        recordId:    i + 1,          // 누락승인대기 시트 행번호 (HTML: data.recordId)
        kakaoId:     rows[i][1],
        name:        rows[i][2],     // studentName → name
        date:        rows[i][3],     // missingDate  → date
        type:        rows[i][4],     // missingType  → type
        managerPhone:rows[i][5],
        row:         rows[i][7],     // recordRow    → row (출석기록 행번호)
        inTime:      rows[i][8],
        outTime:     rows[i][9]
      });
    }
    return {status:'success', records: pendingList};
  } catch(e) {
    return {status:'error', message: e.toString()};
  }
}

// ==================== 원장님 전용: 누락 승인 처리 ====================
// [BUG FIX] 중복 함수 제거 — LockService 버전만 유지
function approveMissingAttendance(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss           = SpreadsheetApp.getActiveSpreadsheet();
    var recordSheet  = ss.getSheetByName("출석기록");
    var pendingSheet = ss.getSheetByName("누락승인대기");
    var targetRow    = parseInt(data.row);

    if (data.type === '출근' || data.type === '출,퇴근') recordSheet.getRange(targetRow, 6).setValue(data.inTime);
    if (data.type === '퇴근' || data.type === '출,퇴근') recordSheet.getRange(targetRow, 9).setValue(data.outTime);
    if (data.recordId) pendingSheet.getRange(parseInt(data.recordId), 7).setValue("승인완료");

    return {status:'success'};
  } catch(e) {
    return {status:'error', message: e.toString()};
  } finally {
    lock.releaseLock();
  }
}

// ==================== [NEW] 토스 빌링키 발급 ====================
function issueBillingKey(data) {
  try {
    var encoded = Utilities.base64Encode(TOSS_SECRET_KEY + ':');
    var res = UrlFetchApp.fetch('https://api.tosspayments.com/v1/billing/authorizations/issue', {
      method: 'post',
      headers: { Authorization: 'Basic ' + encoded, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ authKey: data.authKey, customerKey: data.customerKey }),
      muteHttpExceptions: true
    });
    var body = JSON.parse(res.getContentText());
    if (res.getResponseCode() === 200) {
      // Firestore directors/{customerKey} 에 billingKey 저장
      fsPatch('directors/' + data.customerKey, { billingKey: fsStr(body.billingKey) }, ['billingKey']);
      return createResponse({status:'success', billingKey: body.billingKey});
    }
    return createResponse({status:'error', message: body.message || 'HTTP ' + res.getResponseCode()});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 월 자동결제 (트리거: 매월 1일 오전 9시) ====================
function monthlyAutoCharge() {
  var kst      = getKSTDateString();
  var monthKey = kst.slice(0, 7);
  Logger.log('[월자동결제] 실행: ' + monthKey);

  var docs = fsGetCollection('directors');
  if (!docs) { Logger.log('directors 읽기 실패'); return; }

  for (var i = 0; i < docs.length; i++) {
    var doc   = docs[i];
    var docId = doc.name.split('/').pop();
    var d     = flattenDoc(doc);

    if (d.status !== 'approved') continue;
    if (!d.billingKey) continue;
    if (paymentExists(docId, monthKey)) { Logger.log('[SKIP] ' + (d.academyName || docId) + ' — 이미 결제됨'); continue; }

    var orderId = ('monthly_' + docId + '_' + monthKey).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    var result  = chargeWithBillingKey(d.billingKey, {
      customerKey: docId,
      amount:      MONTHLY_AMOUNT,
      orderId:     orderId,
      orderName:   '까마귀 월 이용료 (' + monthKey + ')'
    });

    if (result.success) {
      Logger.log('[SUCCESS] ' + (d.academyName || docId));
      savePayment(docId, monthKey, orderId, 'paid', null);
      fsPatch('directors/' + docId,
        { paymentStatus: fsStr('active'), lastPaymentAt: fsStr(new Date().toISOString()) },
        ['paymentStatus', 'lastPaymentAt']
      );
    } else {
      Logger.log('[FAIL] ' + (d.academyName || docId) + ': ' + result.error);
      savePayment(docId, monthKey, orderId, 'failed', result.error);
      fsPatch('directors/' + docId, { paymentStatus: fsStr('overdue') }, ['paymentStatus']);
    }
  }
  Logger.log('[월자동결제] 완료');
}

function chargeWithBillingKey(billingKey, params) {
  var encoded = Utilities.base64Encode(TOSS_SECRET_KEY + ':');
  try {
    var res  = UrlFetchApp.fetch('https://api.tosspayments.com/v1/billing/' + billingKey, {
      method: 'post',
      headers: { Authorization: 'Basic ' + encoded, 'Content-Type': 'application/json' },
      payload: JSON.stringify(params),
      muteHttpExceptions: true
    });
    var body = JSON.parse(res.getContentText());
    if (res.getResponseCode() === 200) return {success:true, data:body};
    return {success:false, error: body.message || 'HTTP ' + res.getResponseCode()};
  } catch(e) {
    return {success:false, error: e.message};
  }
}

function paymentExists(directorId, monthKey) {
  try {
    var body = JSON.stringify({
      structuredQuery: {
        from: [{collectionId:'payments'}],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              {fieldFilter:{field:{fieldPath:'directorId'}, op:'EQUAL', value:{stringValue:directorId}}},
              {fieldFilter:{field:{fieldPath:'month'},      op:'EQUAL', value:{stringValue:monthKey}}},
              {fieldFilter:{field:{fieldPath:'status'},     op:'EQUAL', value:{stringValue:'paid'}}}
            ]
          }
        },
        limit: 1
      }
    });
    var token = ScriptApp.getOAuthToken();
    var res   = UrlFetchApp.fetch(FS_URL + ':runQuery', {
      method: 'post', contentType: 'application/json',
      headers: {Authorization:'Bearer ' + token},
      payload: body, muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    return Array.isArray(data) && data.some(function(r){ return r.document; });
  } catch(e) {
    return false;
  }
}

function savePayment(directorId, month, orderId, status, errorMsg) {
  var fields = {
    directorId: fsStr(directorId),
    month:      fsStr(month),
    orderId:    fsStr(orderId),
    amount:     {integerValue: String(MONTHLY_AMOUNT)},
    status:     fsStr(status),
    paidAt:     status === 'paid' ? {timestampValue: new Date().toISOString()} : {nullValue: null},
    error:      errorMsg ? fsStr(errorMsg) : {nullValue: null}
  };
  fsCreate('payments', fields);
}

function testMonthlyCharge() { monthlyAutoCharge(); }

// ==================== 구글 문서 제출 (실습근무카드) ====================
function handleSubmitToGoogleDoc(data, submitSheet) {
  try {
    var ss           = SpreadsheetApp.getActiveSpreadsheet();
    var studentSheet = ss.getSheetByName("학생배치");
    var studentData  = studentSheet.getDataRange().getValues();
    var totalPeriodStr = "";

    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) !== String(data.kakaoId)) continue;
      var sDate = studentData[s][9]  ? Utilities.formatDate(new Date(studentData[s][9]),  "GMT+9", "yyyy-MM-dd") : "";
      var eDate = studentData[s][10] ? Utilities.formatDate(new Date(studentData[s][10]), "GMT+9", "yyyy-MM-dd") : "";
      totalPeriodStr = sDate + " ~ " + eDate;
      break;
    }

    var templateFile = DriveApp.getFileById(TEMPLATE_CARD_DOC_ID);
    var targetFolder = DriveApp.getFolderById(FOLDER_CARD_ID);
    var phoneLast4   = data.phone.length > 4 ? data.phone.slice(-4) : data.phone;
    var newFileName  = "(실습근무카드," + data.name + "," + phoneLast4 + "," + data.intervalStr + ")";
    var newFile      = templateFile.makeCopy(newFileName, targetFolder);
    var doc          = DocumentApp.openById(newFile.getId());
    var body         = doc.getBody();

    body.replaceText("{{이름}}", data.name || "");
    body.replaceText("{{실습병원명}}", data.hospital || "");
    body.replaceText("{{실습기간}}", totalPeriodStr || "");
    body.replaceText("{{단위기간시작일}}", data.targetStartDate || "");
    body.replaceText("{{단위기간종료일}}", data.targetEndDate || "");

    var records = data.records || [];
    var accumulatedHours = 0;
    for (var i = 1; i <= 30; i++) {
      var rec = records[i - 1];
      if (rec) {
        accumulatedHours += parseInt(rec.workHours) || 0;
        body.replaceText("{{단위기간시작일" + i + "}}", rec.dateText || "-");
        body.replaceText("{{출근시간" + i + "}}", rec.inTime || "-");
        body.replaceText("{{퇴근시간" + i + "}}", rec.outTime || "-");
        body.replaceText("{{실습시간" + i + "}}", rec.workHours !== "-" ? rec.workHours : "-");
        body.replaceText("{{누적시간" + i + "}}", accumulatedHours > 0 ? accumulatedHours.toString() : "-");
        replaceTextWithImage(body, "{{학생서명" + i + "}}", rec.studentSig);
        replaceTextWithImage(body, "{{담당자서명" + i + "}}", rec.managerSig);
      } else {
        ["{{단위기간시작일"+i+"}}","{{출근시간"+i+"}}","{{퇴근시간"+i+"}}","{{실습시간"+i+"}}","{{누적시간"+i+"}}","{{학생서명"+i+"}}","{{담당자서명"+i+"}}"].forEach(function(tag){ body.replaceText(tag,""); });
      }
    }
    doc.saveAndClose();

    submitSheet.appendRow([new Date(), data.name, data.kakaoId, data.intervalStr, newFile.getUrl()]);

    var sData2 = studentSheet.getDataRange().getValues();
    for (var si = 1; si < sData2.length; si++) {
      if (String(sData2[si][1]) === String(data.kakaoId)) {
        var existing = String(sData2[si][22] || "");
        studentSheet.getRange(si + 1, 23).setValue(existing ? existing + "," + data.intervalStr : data.intervalStr);
        break;
      }
    }
    return createResponse({status:'success', docUrl: newFile.getUrl()});
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 증빙서류 업로드 ====================
function uploadProofDocument(data, ss) {
  try {
    var targetFolder = DriveApp.getFolderById(PROOF_FOLDER_ID);
    var studentSheet = ss.getSheetByName("학생배치");
    var studentData  = studentSheet.getDataRange().getValues();
    var totalStartDate = "-";

    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) !== String(data.kakaoId)) continue;
      if (studentData[s][11]) totalStartDate = Utilities.formatDate(new Date(studentData[s][11]), "GMT+9", "yyyy-MM-dd");
      studentSheet.getRange(s + 1, 19).setValue("");
      break;
    }

    var docName = data.name + "_" + data.date + "_" + data.requestType + "_원본";
    var doc     = DocumentApp.create(docName);
    var body    = doc.getBody();
    body.appendParagraph("학생명: " + data.name + " | 날짜: " + data.date + " | 사유: " + data.requestType).setBold(true);
    data.images.forEach(function(base64Str) {
      if (base64Str) {
        var blob  = Utilities.newBlob(Utilities.base64Decode(base64Str), 'image/jpeg', 'proof.jpg');
        var img   = body.appendImage(blob);
        var origW = img.getWidth(), origH = img.getHeight();
        var targetW = 450;
        img.setWidth(targetW).setHeight(Math.round(origH * (targetW / origW)));
      }
    });
    doc.saveAndClose();
    var file   = DriveApp.getFileById(doc.getId());
    file.moveTo(targetFolder);
    var docUrl = file.getUrl();

    var proofSheet = ss.getSheetByName("증빙서류제출내역");
    if (!proofSheet) {
      proofSheet = ss.insertSheet("증빙서류제출내역");
      proofSheet.appendRow(["제출일시","학생명","카카오ID","전체훈련시작일","서류종류","해당날짜","사진원본링크"]);
    }
    proofSheet.appendRow([new Date(), data.name, data.kakaoId, totalStartDate, data.requestType, data.date, docUrl]);

    var sickSheet = ss.getSheetByName("병가제출내역");
    if (!sickSheet) {
      sickSheet = ss.insertSheet("병가제출내역");
      sickSheet.appendRow(["제출일시","학생명","카카오ID","병가일자","문서링크"]);
    }
    sickSheet.appendRow([new Date(), data.name, data.kakaoId, data.date, docUrl]);

    return createResponse({status:'success'});
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 제출/발급 내역 조회 ====================
function handleGetHistory(data, ss) {
  try {
    var sheetName   = data.type === 'sick' ? "병가제출내역" : "수강증명서발급내역";
    var historySheet = ss.getSheetByName(sheetName);
    var resultData  = [];
    if (historySheet) {
      var records = historySheet.getDataRange().getDisplayValues();
      for (var i = records.length - 1; i >= 1; i--) {
        if (String(records[i][2]) !== String(data.kakaoId)) continue;
        var rawDate    = records[i][0].substring(0, 16);
        var dateStr    = data.type === 'sick' ? "제출일 : " + rawDate : "발급일 : " + rawDate;
        var targetValue = String(records[i][3]);
        if (data.type === 'sick' && targetValue.startsWith("20") && targetValue.length === 10) targetValue = targetValue.substring(2);
        var desc = data.type === 'sick' ? targetValue + " 병가서류" : targetValue + " 수강증명서";
        resultData.push({date:dateStr, desc:desc, link:records[i][4]});
      }
    }
    return createResponse({status:'success', data:resultData});
  } catch(e) {
    return createResponse({status:'error', message: e.toString()});
  }
}

// ==================== 수강증명서 PDF 발급 ====================
function handleGenerateCertificate(data, ss) {
  try {
    var studentSheet = ss.getSheetByName("학생배치");
    var recordSheet  = ss.getSheetByName("출석기록");
    var certSheet    = ss.getSheetByName("수강증명서발급내역");
    if (!certSheet) { certSheet = ss.insertSheet("수강증명서발급내역"); certSheet.appendRow(["발급일시","학생명","카카오ID","신청기간","PDF링크"]); }

    var studentData     = studentSheet.getDataRange().getValues();
    var realName        = data.name;
    var totalStartDate  = "", totalEndDate = "";
    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) !== String(data.kakaoId)) continue;
      realName = studentData[s][0];
      if (studentData[s][11]) totalStartDate = Utilities.formatDate(new Date(studentData[s][11]), "GMT+9", "yyyy년 MM월 dd일");
      if (studentData[s][12]) totalEndDate   = Utilities.formatDate(new Date(studentData[s][12]), "GMT+9", "yyyy년 MM월 dd일");
      break;
    }

    var now       = new Date();
    var reqYear   = Utilities.formatDate(now, "GMT+9", "yyyy");
    var reqMonth  = Utilities.formatDate(now, "GMT+9", "MM");
    var reqDay    = Utilities.formatDate(now, "GMT+9", "dd");
    var reqTime   = Utilities.formatDate(now, "GMT+9", "HHmm");
    var docNumber = "사하제일-" + reqYear + "-" + reqMonth + "-" + reqDay + "-" + reqTime;

    var reqStartObj = new Date(data.startDate);
    var reqEndObj   = new Date(data.endDate);
    var formalPeriodStr  = Utilities.formatDate(reqStartObj, "GMT+9", "yyyy년 MM월 dd일") + " ~ " + Utilities.formatDate(reqEndObj, "GMT+9", "yyyy년 MM월 dd일");
    var historyPeriodStr = Utilities.formatDate(reqStartObj, "GMT+9", "yy.MM.dd") + " ~ " + Utilities.formatDate(reqEndObj, "GMT+9", "MM.dd");

    var records = recordSheet.getDataRange().getDisplayValues();
    var participatedDays = 0, participatedHours = 0;
    var myDailyRecords = {};
    for (var r = 1; r < records.length; r++) {
      if (String(records[r][3]) !== String(data.kakaoId)) continue;
      var cleanDate = String(records[r][0]).substring(0, 10);
      if (!myDailyRecords[cleanDate]) myDailyRecords[cleanDate] = {inStr:"-", outStr:"-"};
      if (records[r][5] && records[r][5] !== "") myDailyRecords[cleanDate].inStr  = String(records[r][5]);
      if (records[r][8] && records[r][8] !== "") myDailyRecords[cleanDate].outStr = String(records[r][8]);
    }
    reqStartObj.setHours(0,0,0,0); reqEndObj.setHours(23,59,59,999);
    for (var dateKey in myDailyRecords) {
      var rec     = myDailyRecords[dateKey];
      var dateObj = new Date(dateKey); dateObj.setHours(12,0,0,0);
      if (dateObj < reqStartObj || dateObj > reqEndObj) continue;
      var dow = dateObj.getDay();
      if (dow < 1 || dow > 5 || isKoreanHoliday(dateObj)) continue;
      if (rec.inStr === "-" || rec.outStr === "-") continue;
      var logic = calculateTimeLogic(rec.inStr, rec.outStr);
      if (!logic.isAbsent) { participatedDays++; participatedHours += logic.hours; }
    }

    var templateFile = DriveApp.getFileById(CERT_TEMPLATE_ID);
    var targetFolder = DriveApp.getFolderById(CERT_FOLDER_ID);
    var tempFile     = templateFile.makeCopy("임시수강증명서_" + realName, targetFolder);
    var doc          = DocumentApp.openById(tempFile.getId());
    var body         = doc.getBody();
    body.replaceText("{{문서번호}}", docNumber);
    body.replaceText("{{이름}}", realName);
    body.replaceText("{{주민등록번호}}", data.rrn);
    body.replaceText("{{전체훈련시작일}}", totalStartDate);
    body.replaceText("{{전체훈련종료일}}", totalEndDate);
    body.replaceText("{{신청기간}}", formalPeriodStr);
    body.replaceText("{{참여일수}}", participatedDays.toString());
    body.replaceText("{{참여시간}}", participatedHours.toString());
    body.replaceText("{{신청년}}", reqYear);
    body.replaceText("{{신청월}}", reqMonth);
    body.replaceText("{{신청일}}", reqDay);
    doc.saveAndClose();

    var pdfBlob      = tempFile.getAs('application/pdf');
    var finalPdfName = reqYear.substring(2) + "." + parseInt(reqMonth) + "." + parseInt(reqDay) + realName + "수강증명서";
    var pdfFile      = targetFolder.createFile(pdfBlob).setName(finalPdfName);
    tempFile.setTrashed(true);
    certSheet.appendRow([new Date(), realName, data.kakaoId, historyPeriodStr, pdfFile.getUrl()]);
    return createResponse({status:'success', docUrl: pdfFile.getUrl()});
  } catch(error) {
    return createResponse({status:'error', message: error.toString()});
  }
}

// ==================== 이미지 삽입 헬퍼 ====================
function replaceTextWithImage(body, searchText, base64String) {
  var found = body.findText(searchText);
  if (!found) return;
  var textElement = found.getElement().asText();
  if (base64String && base64String !== "") {
    try {
      var blob   = Utilities.newBlob(Utilities.base64Decode(base64String), 'image/png', 'signature.png');
      var parent = textElement.getParent();
      if (parent.getType() === DocumentApp.ElementType.PARAGRAPH)  parent.asParagraph().insertInlineImage(0, blob).setWidth(50).setHeight(30);
      else if (parent.getType() === DocumentApp.ElementType.LIST_ITEM) parent.asListItem().insertInlineImage(0, blob).setWidth(50).setHeight(30);
    } catch(e) { console.log('이미지 삽입 에러:', e); }
  }
  textElement.replaceText(searchText, "");
}

// ==================== 전체 통계 일괄 동기화 (새벽 3시 트리거) ====================
function syncAllStudentStats() {
  var ss           = SpreadsheetApp.getActiveSpreadsheet();
  var studentSheet = ss.getSheetByName("학생배치");
  var recordSheet  = ss.getSheetByName("출석기록");
  if (!studentSheet || !recordSheet) return;

  var studentData  = studentSheet.getDataRange().getValues();
  var records      = recordSheet.getDataRange().getValues();
  var dailyRecords = {}, studentMeta = {};

  for (var s = 1; s < studentData.length; s++) {
    var sId = String(studentData[s][1]);
    if (!sId) continue;
    var isJabiUser = studentData[s].length > 20 && studentData[s][20] && String(studentData[s][20]).trim() === "자비";
    studentMeta[sId] = {
      shiftType: studentData[s][19] ? String(studentData[s][19]).trim() : "주간",
      isJabi: isJabiUser
    };
  }

  for (var r = 1; r < records.length; r++) {
    var kakaoId = String(records[r][3]);
    var dateStr = records[r][0];
    if (!kakaoId || kakaoId === "undefined" || kakaoId === "" || !dateStr || dateStr === "") continue;
    var cleanDate = (dateStr instanceof Date) ? Utilities.formatDate(dateStr, "GMT+9", "yyyy-MM-dd") : String(dateStr).substring(0, 10);
    var key = kakaoId + "_" + cleanDate;
    if (!dailyRecords[key]) dailyRecords[key] = {kakaoId:kakaoId, inStr:"-", outStr:"-"};
    var inVal  = records[r][5];
    var outVal = records[r][8];
    if (inVal  instanceof Date) inVal  = ('0'+inVal.getHours()).slice(-2)+':'+('0'+inVal.getMinutes()).slice(-2);
    if (outVal instanceof Date) outVal = ('0'+outVal.getHours()).slice(-2)+':'+('0'+outVal.getMinutes()).slice(-2);
    if (inVal  && inVal  !== "") dailyRecords[key].inStr  = String(inVal);
    if (outVal && outVal !== "") dailyRecords[key].outStr = String(outVal);
  }

  var statsMap = {};
  for (var key in dailyRecords) {
    var rec    = dailyRecords[key];
    var kId    = rec.kakaoId;
    var dStr   = key.split("_")[1];
    var dObj   = new Date(dStr);
    if (!statsMap[kId]) statsMap[kId] = {hours:0, tardy:0, early:0};
    if (rec.inStr !== "-" && rec.outStr !== "-") {
      var meta  = studentMeta[kId] || {shiftType:"주간", isJabi:false};
      var logic = calculateTimeLogic(rec.inStr, rec.outStr, meta.shiftType, dObj, meta.isJabi);
      statsMap[kId].hours += logic.hours;
      if (logic.isTardy)      statsMap[kId].tardy++;
      if (logic.isEarlyLeave) statsMap[kId].early++;
    }
  }

  var numRows = studentData.length - 1;
  if (numRows <= 0) return;
  var targetRange  = studentSheet.getRange(2, 14, numRows, 5);
  var targetValues = targetRange.getValues();
  var nowTime      = new Date();

  for (var i = 1; i < studentData.length; i++) {
    var kId2 = String(studentData[i][1]);
    if (statsMap[kId2]) {
      targetValues[i-1][0] = statsMap[kId2].hours;
      targetValues[i-1][1] = statsMap[kId2].tardy;
      targetValues[i-1][2] = statsMap[kId2].early;
      targetValues[i-1][4] = nowTime;
      // Firestore 학생 문서에도 통계 동기화
      try {
        fsPatch('students/' + kId2, {
          totalHours:  {doubleValue: statsMap[kId2].hours},
          tardyCount:  {doubleValue: statsMap[kId2].tardy},
          earlyCount:  {doubleValue: statsMap[kId2].early},
          statsUpdatedAt: fsStr(nowTime.toISOString())
        }, ['totalHours', 'tardyCount', 'earlyCount', 'statsUpdatedAt']);
      } catch(e) { Logger.log('Firestore 통계 업데이트 실패: ' + kId2 + ' / ' + e.message); }
    }
  }
  targetRange.setValues(targetValues);
}

// ==================== 공휴일 확인 ====================
function isKoreanHoliday(dateObj) {
  var ss           = SpreadsheetApp.getActiveSpreadsheet();
  var holidaySheet = ss.getSheetByName("공휴일캐시");
  if (!holidaySheet) { refreshHolidayCache(); holidaySheet = ss.getSheetByName("공휴일캐시"); }
  var data      = holidaySheet.getRange("A2:A500").getValues();
  var targetStr = Utilities.formatDate(dateObj, "GMT+9", "yyyy-MM-dd");
  for (var i = 0; i < data.length; i++) { if (data[i][0] === targetStr) return true; }
  return false;
}

function refreshHolidayCache() {
  var ss           = SpreadsheetApp.getActiveSpreadsheet();
  var holidaySheet = ss.getSheetByName("공휴일캐시");
  if (!holidaySheet) { holidaySheet = ss.insertSheet("공휴일캐시"); holidaySheet.appendRow(["날짜(yyyy-MM-dd)","공휴일명"]); }
  var lastRow = holidaySheet.getLastRow();
  if (lastRow > 1) holidaySheet.getRange(2, 1, lastRow - 1, 2).clearContent();
  var calendar = CalendarApp.getCalendarById('ko.south_korea#holiday@group.v.calendar.google.com');
  if (calendar) {
    var nowYear = new Date().getFullYear();
    var events  = calendar.getEvents(new Date(nowYear - 1, 0, 1), new Date(nowYear + 2, 11, 31));
    var rows    = events.map(function(ev){ return [Utilities.formatDate(ev.getStartTime(), "GMT+9", "yyyy-MM-dd"), ev.getTitle()]; });
    if (rows.length > 0) holidaySheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
}

// ==================== 시간 계산 ====================
function calculateTimeLogic(inStr, outStr, shiftType, dateObj, isJabi) {
  var result = {hours:0, isTardy:false, isEarlyLeave:false, isAbsent:false};
  if (!inStr || !outStr || inStr === "-" || outStr === "-") return result;
  try {
    var parseTime = function(tStr) {
      var upper = String(tStr).toUpperCase();
      var isPM  = upper.indexOf("PM") > -1, isAM = upper.indexOf("AM") > -1;
      var clean = upper.replace(/AM|PM|[가-힣]/g, "").trim().split(":");
      var h = parseInt(clean[0],10)||0, m = parseInt(clean[1],10)||0, s = clean.length>2?parseInt(clean[2],10):0;
      if (isPM && h!==12) h+=12; if (isAM && h===12) h=0;
      return {h:h, m:m, s:s};
    };
    var inT  = parseTime(inStr),  outT = parseTime(outStr);
    var inH  = inT.h,  inM  = inT.m,  inS  = inT.s;
    var outH = outT.h, outM = outT.m;

    var isWeekendOrHoliday = false;
    if (dateObj) {
      var day = dateObj.getDay();
      if (day===0 || day===6 || (typeof isKoreanHoliday==='function' && isKoreanHoliday(dateObj))) isWeekendOrHoliday = true;
    }
    var skipPenalties = isWeekendOrHoliday || isJabi;
    var isTardy = false, isEarly = false;

    if (!skipPenalties) {
      if (shiftType === "야간") {
        if (inH>18 || (inH===18&&inM>30))    isTardy = true;
        if (outH<22 || (outH===22&&outM<29)) isEarly = true;
      } else {
        if (inH>9  || (inH===9&&inM>0))     isTardy = true;
        if (outH<16 || (outH===16&&outM<29)) isEarly = true;
      }
    }

    var adjInH = inH, adjInM = 0;
    if (inM===0)                         adjInM = 0;
    else if (inM<30 || (inM===30))        adjInM = 30;
    else                                 { adjInH++; adjInM = 0; }

    var adjOutH = outH, adjOutM = 0;
    if ((outM===59) || (outM===58))       { adjOutH++; adjOutM = 0; }
    else if (outM>=29)                    adjOutM = 30;
    else                                  adjOutM = 0;

    var workedDec = (adjOutH + adjOutM/60) - (adjInH + adjInM/60);
    if (workedDec < 0) workedDec = 0;
    if (workedDec > 4.0) workedDec -= 0.5;
    var finalHours = Math.min(8, Math.floor(workedDec));

    if (!skipPenalties) {
      var minHours = shiftType === "야간" ? 2 : 4;
      if (finalHours < minHours) { result.isAbsent = true; }
      else { result.isAbsent = false; result.isTardy = isTardy; result.isEarlyLeave = isEarly; }
    }
    result.hours = finalHours;
    return result;
  } catch(e) { return result; }
}

function timeToMins(tStr) {
  if (!tStr || tStr === "-") return 0;
  var parts = String(tStr).replace(/[^0-9:]/g, "").split(":");
  if (parts.length < 2) return 0;
  return parseInt(parts[0],10)*60 + parseInt(parts[1],10);
}

// ==================== Firestore REST 헬퍼 ====================
function fsGetCollection(collection) {
  var token = ScriptApp.getOAuthToken();
  var url   = FS_URL + '/' + collection + '?pageSize=500';
  try {
    var res  = UrlFetchApp.fetch(url, {headers:{Authorization:'Bearer '+token}, muteHttpExceptions:true});
    var data = JSON.parse(res.getContentText());
    return data.documents || [];
  } catch(e) { Logger.log('fsGetCollection 오류: ' + e.message); return null; }
}

function fsPatch(path, fields, masks) {
  var token   = ScriptApp.getOAuthToken();
  var maskStr = masks.map(function(k){ return 'updateMask.fieldPaths='+k; }).join('&');
  var url     = FS_URL + '/' + path + '?' + maskStr;
  try {
    UrlFetchApp.fetch(url, {
      method: 'PATCH', contentType: 'application/json',
      headers: {Authorization:'Bearer '+token},
      payload: JSON.stringify({fields:fields}),
      muteHttpExceptions: true
    });
  } catch(e) { Logger.log('fsPatch 오류(' + path + '): ' + e.message); }
}

function fsCreate(collection, fields) {
  var token = ScriptApp.getOAuthToken();
  var url   = FS_URL + '/' + collection;
  try {
    UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: {Authorization:'Bearer '+token},
      payload: JSON.stringify({fields:fields}),
      muteHttpExceptions: true
    });
  } catch(e) { Logger.log('fsCreate 오류(' + collection + '): ' + e.message); }
}

function fsBatchWrite(writes) {
  var token = ScriptApp.getOAuthToken();
  var url   = FS_URL + ':batchWrite';
  var size  = 500;
  for (var i = 0; i < writes.length; i += size) {
    var chunk = writes.slice(i, i + size);
    var res   = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: {Authorization:'Bearer '+token},
      payload: JSON.stringify({writes:chunk}),
      muteHttpExceptions: true
    });
    Logger.log('배치 ' + Math.ceil((i+1)/size) + ': ' + res.getResponseCode());
    if (res.getResponseCode() !== 200) Logger.log('에러: ' + res.getContentText());
    Utilities.sleep(300);
  }
}

function flattenDoc(doc) {
  var out = {};
  for (var k in (doc.fields||{})) {
    var v = doc.fields[k];
    out[k] = v.stringValue !== undefined ? v.stringValue
           : v.integerValue !== undefined ? v.integerValue
           : v.booleanValue !== undefined ? v.booleanValue
           : null;
  }
  return out;
}

function fsStr(v) {
  if (v === null || v === undefined) return {stringValue:''};
  if (v instanceof Date) return {stringValue: fmtDate(v)};
  return {stringValue: String(v)};
}
function fsNum(v) {
  var n = parseFloat(v);
  return {doubleValue: isNaN(n) ? 0 : n};
}

// ==================== Firestore → Sheets 동기화 (테스트기간 모니터링용) ====================
// 실행방법: GAS 에디터에서 syncFirestoreToSheets() 수동 실행 또는 트리거 등록
function syncFirestoreToSheets() {
  syncDirectorsToSheet();
  syncPaymentsToSheet();
  Logger.log('Firestore → Sheets 동기화 완료');
}

function syncDirectorsToSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("FS_원장목록");
  if (!sheet) {
    sheet = ss.insertSheet("FS_원장목록");
    sheet.appendRow(["문서ID","학원명","이메일","전화번호","상태","결제상태","billingKey유무","마지막결제일","업데이트"]);
    sheet.getRange("1:1").setBackground("#1a1a2e").setFontColor("white").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  var docs = fsGetCollection('directors');
  if (!docs) { Logger.log('directors 읽기 실패'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 9).clearContent();

  var rows = docs.map(function(doc) {
    var d   = flattenDoc(doc);
    var id  = doc.name.split('/').pop();
    return [id, d.academyName||"", d.email||"", d.phone||"", d.status||"", d.paymentStatus||"", d.billingKey?"O":"X", d.lastPaymentAt||"", new Date()];
  });
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, 9).setValues(rows);
  Logger.log('원장 ' + rows.length + '명 동기화');
}

function syncPaymentsToSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("FS_결제내역");
  if (!sheet) {
    sheet = ss.insertSheet("FS_결제내역");
    sheet.appendRow(["문서ID","원장ID","월","주문ID","금액","상태","결제일시","오류메시지","업데이트"]);
    sheet.getRange("1:1").setBackground("#1a1a2e").setFontColor("white").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  var docs = fsGetCollection('payments');
  if (!docs) { Logger.log('payments 읽기 실패'); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 9).clearContent();

  var rows = docs.map(function(doc) {
    var d  = flattenDoc(doc);
    var id = doc.name.split('/').pop();
    return [id, d.directorId||"", d.month||"", d.orderId||"", d.amount||"", d.status||"", d.paidAt||"", d.error||"", new Date()];
  });
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, 9).setValues(rows);
  Logger.log('결제내역 ' + rows.length + '건 동기화');
}

// ==================== 1회성 마이그레이션 (Sheet → Firestore) ====================
function migrateStudents() {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var sheet  = ss.getSheetByName('학생배치');
  var rows   = sheet.getDataRange().getValues();
  var writes = [];

  for (var i = 1; i < rows.length; i++) {
    var r       = rows[i];
    var kakaoId = String(r[1] || '').trim();
    if (!kakaoId) continue;
    var role    = String(r[20] || '').trim() === '원장님' ? 'admin' : 'student';

    writes.push({
      update: {
        name: FS_BASE + '/students/' + kakaoId,
        fields: {
          name:               fsStr(r[0]),  kakaoId:   fsStr(kakaoId),
          phone:              fsStr(r[2]),  hospital:  fsStr(r[3]),
          hospitalLat:        fsNum(r[4]||35.0817), hospitalLon: fsNum(r[5]||128.9883),
          practiceStart:      fsStr(r[9]  ? fmtDate(r[9])  : ''),
          practiceEnd:        fsStr(r[10] ? fmtDate(r[10]) : ''),
          totalStart:         fsStr(r[11] ? fmtDate(r[11]) : ''),
          totalEnd:           fsStr(r[12] ? fmtDate(r[12]) : ''),
          totalHours:         fsNum(r[13]||0), tardyCount: fsNum(r[14]||0),
          earlyCount:         fsNum(r[15]||0), shiftType:  fsStr(r[19]||'주간'),
          role:               fsStr(role),     status:     fsStr('active'),
          completedIntervals: fsStr(String(r[22]||'')),
          pendingRequest:     fsStr(String(r[18]||''))
        }
      }
    });
  }
  fsBatchWrite(writes);
  Logger.log('학생 이전 완료: ' + writes.length + '명');
}

function migrateAttendance() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('출석기록');
  var rows  = sheet.getDataRange().getValues();
  var map   = {};

  for (var i = 1; i < rows.length; i++) {
    var r       = rows[i];
    var kakaoId = String(r[3] || '').trim();
    var dateStr = r[0] instanceof Date ? fmtDate(r[0]) : String(r[0]).substring(0, 10);
    if (!kakaoId || !dateStr || dateStr.length < 8) continue;

    var key = kakaoId + '_' + dateStr;
    if (!map[key]) map[key] = {kakaoId:kakaoId, name:String(r[1]||''), phone:String(r[2]||''), hospital:String(r[4]||''), date:dateStr, inTime:'', outTime:'', inAccuracy:'', inDistance:'', outAccuracy:'', outDistance:''};

    var inVal  = r[5], outVal = r[8];
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
          kakaoId:     fsStr(d.kakaoId), name:        fsStr(d.name),
          phone:       fsStr(d.phone),   hospital:    fsStr(d.hospital),
          date:        fsStr(d.date),    inTime:      fsStr(d.inTime),
          outTime:     fsStr(d.outTime), inAccuracy:  fsStr(d.inAccuracy),
          inDistance:  fsStr(d.inDistance), outAccuracy: fsStr(d.outAccuracy),
          outDistance: fsStr(d.outDistance)
        }
      }
    });
  }
  fsBatchWrite(writes);
  Logger.log('출석 이전 완료: ' + writes.length + '건');
}

function approveAllStudents() {
  var docs  = fsGetCollection('students');
  if (!docs) return;
  var count = 0;
  docs.forEach(function(doc) {
    var fields = doc.fields || {};
    var status = fields.status ? fields.status.stringValue : '';
    if (status !== 'approved') {
      var id = doc.name.split('/').pop();
      fsPatch('students/' + id, {status: fsStr('approved')}, ['status']);
      count++;
    }
  });
  Logger.log('승인 완료: ' + count + '명');
}

// ==================== 임시: 특정 날짜 Firestore 출결 → 출석기록 시트 ====================
// GAS 에디터에서 pullAttendanceByDate 선택 후 실행
function pullAttendanceByDate() {
  var dateStr = '2026-05-01'; // ← 날짜 바꿔서 실행 (예: '2026-05-21')
  var token   = ScriptApp.getOAuthToken();

  // Firestore에서 해당 날짜 출결 전체 조회
  var body = JSON.stringify({
    structuredQuery: {
      from: [{ collectionId: 'attendance' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'date' },
          op:    'EQUAL',
          value: { stringValue: dateStr }
        }
      }
    }
  });
  var res     = UrlFetchApp.fetch(FS_URL + ':runQuery', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: body, muteHttpExceptions: true
  });
  var docs = JSON.parse(res.getContentText())
               .filter(function(r) { return r.document; })
               .map(function(r) { return r.document; });

  if (docs.length === 0) {
    Logger.log('[pullAttendanceByDate] ' + dateStr + ' 데이터 없음');
    return;
  }

  // Firestore 필드값 추출 헬퍼 (string/int/double 모두 처리)
  function g(fields, key) {
    var v = fields[key];
    if (!v) return '';
    return v.stringValue  !== undefined ? v.stringValue
         : v.integerValue !== undefined ? v.integerValue
         : v.doubleValue  !== undefined ? v.doubleValue
         : '';
  }

  // 기존 출석기록 시트 로드 — kakaoId(col4) + 날짜(col1) 기준으로 인덱스 생성
  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var recordSheet = ss.getSheetByName('출석기록');
  if (!recordSheet) {
    recordSheet = ss.insertSheet('출석기록');
    recordSheet.appendRow(['날짜','학생명','전화번호','카카오ID','병원명','출근시간','출근GPS정확도','출근거리','퇴근시간','퇴근GPS정확도','퇴근거리']);
  }

  var existing = recordSheet.getDataRange().getValues();
  // key: kakaoId_date → 시트 행 인덱스 (1-based, 헤더 제외)
  var rowIndex = {};
  for (var i = 1; i < existing.length; i++) {
    var rowDate    = existing[i][0] instanceof Date
                     ? Utilities.formatDate(existing[i][0], 'GMT+9', 'yyyy-MM-dd')
                     : String(existing[i][0]).substring(0, 10);
    var rowKakaoId = String(existing[i][3]);
    if (rowKakaoId && rowDate) rowIndex[rowKakaoId + '_' + rowDate] = i + 1; // 시트 행번호
  }

  var appended = 0, updated = 0;

  docs.forEach(function(doc) {
    var f       = doc.fields || {};
    var kakaoId = g(f, 'kakaoId');
    var date    = g(f, 'date');
    var key     = kakaoId + '_' + date;

    var row = [
      date,
      g(f, 'name'),
      g(f, 'phone'),
      kakaoId,
      g(f, 'hospital'),
      g(f, 'inTime'),
      g(f, 'inAccuracy'),
      g(f, 'inDistance'),
      g(f, 'outTime'),
      g(f, 'outAccuracy'),
      g(f, 'outDistance')
    ];

    if (rowIndex[key]) {
      // 이미 해당 행 존재 → 빈 칸만 채우기
      var sheetRow  = rowIndex[key];
      var cellRange = recordSheet.getRange(sheetRow, 1, 1, 11);
      var cellVals  = cellRange.getValues()[0];
      var changed   = false;
      for (var c = 0; c < 11; c++) {
        var cellStr = String(cellVals[c]).trim();
        if ((cellStr === '' || cellStr === '-') && row[c] !== '') {
          cellVals[c] = row[c];
          changed = true;
        }
      }
      if (changed) { cellRange.setValues([cellVals]); updated++; }
    } else {
      // 없는 행 → 새로 추가
      recordSheet.appendRow(row);
      appended++;
    }
  });

  Logger.log('[pullAttendanceByDate] ' + dateStr + ' → 신규:' + appended + '건, 보완:' + updated + '건 (전체:' + docs.length + '건)');
}

// ==================== Firestore 출결 → 출석기록 시트 자동 동기화 ====================
// 사용법:
//   1. setupAttendanceSyncTrigger() 1회 실행 → 1시간마다 자동 등록
//   2. syncAttendanceToSheet()      1회 실행 → 과거 데이터 즉시 전부 반영

function syncAttendanceToSheet() {
  var START_DATE = '2026-05-01';
  var token = ScriptApp.getOAuthToken();
  Logger.log('1. Firestore 요청');

  var res = UrlFetchApp.fetch(
    'https://firestore.googleapis.com/v1/projects/my-attendance-8122d/databases/(default)/documents:runQuery',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'attendance' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'date' },
              op: 'GREATER_THAN_OR_EQUAL',
              value: { stringValue: START_DATE }
            }
          }
        }
      }),
      muteHttpExceptions: true
    }
  );

  Logger.log('2. 응답 코드: ' + res.getResponseCode());

  var docs = JSON.parse(res.getContentText())
    .filter(function(r) { return r.document; })
    .map(function(r) { return r.document; });

  Logger.log('3. 문서 수: ' + docs.length);
  if (docs.length === 0) { Logger.log('데이터 없음'); return; }

  function g(f, k) {
    var v = f[k];
    if (!v) return '';
    if (v.stringValue  !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return v.integerValue;
    if (v.doubleValue  !== undefined) return v.doubleValue;
    return '';
  }

  var rows = docs.map(function(doc) {
    var f = doc.fields || {};
    return [g(f,'date'), g(f,'name'), g(f,'phone'), g(f,'kakaoId'), g(f,'hospital'),
            g(f,'inTime'), g(f,'inAccuracy'), g(f,'inDistance'),
            g(f,'outTime'), g(f,'outAccuracy'), g(f,'outDistance')];
  });

  Logger.log('4. 기존 시트 읽기');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('출석기록') || ss.insertSheet('출석기록');
  var existing = sheet.getDataRange().getValues();
  var numCols = Math.max(existing[0] ? existing[0].length : 11, 11);

  // 기존 행 인덱스 (kakaoId_날짜 → existing 배열 인덱스)
  var map = {};
  for (var i = 1; i < existing.length; i++) {
    var d = existing[i][0];
    var dt = (d instanceof Date) ? Utilities.formatDate(d, 'GMT+9', 'yyyy-MM-dd') : String(d).substring(0, 10);
    var kid = String(existing[i][3]);
    if (kid && dt) map[kid + '_' + dt] = i;
  }

  // Firestore 데이터 머지 (메모리에서만 — 시트 미접촉)
  var newRows = [], updated = 0;
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var key = row[3] + '_' + row[0];
    if (map[key] !== undefined) {
      // 기존 행: Firestore 값이 있으면 덮어쓰기, 비어있으면 기존 시트 값 유지
      var idx = map[key];
      var changed = false;
      for (var c = 0; c < 11; c++) {
        var newVal = String(row[c]).trim();
        var oldVal = String(existing[idx][c]).trim();
        if (newVal !== '' && newVal !== oldVal) {
          existing[idx][c] = row[c]; changed = true;
        }
      }
      if (changed) updated++;
    } else {
      // 새 행: numCols 에 맞게 오른쪽 빈칸 패딩
      var nr = row.slice();
      while (nr.length < numCols) nr.push('');
      newRows.push(nr);
    }
  }

  Logger.log('5. 시트 쓰기 - 보완:' + updated + '건, 신규:' + newRows.length + '건');

  // ★ clearContents 없음 — 기존 데이터 절대 소멸 없음 ★
  // 기존 행 덮어쓰기 (변경된 것만 메모리에서 반영된 상태로 일괄 write)
  if (existing.length > 1) {
    sheet.getRange(2, 1, existing.length - 1, numCols).setValues(existing.slice(1));
  }
  // 새 행 맨 아래 추가
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, numCols).setValues(newRows);
  }

  Logger.log('완료 - 신규:' + newRows.length + '건, 보완:' + updated + '건');
}

function setupAttendanceSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncAttendanceToSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAttendanceToSheet').timeBased().everyHours(1).create();
  Logger.log('트리거 등록 완료: 1시간마다 syncAttendanceToSheet 자동 실행');
}

// attendance 문서 중 phone 없는 것들을 students 컬렉션에서 찾아 일괄 보충 (1회 실행)
function backfillAttendancePhones() {
  var token = ScriptApp.getOAuthToken();

  // 1. students에서 kakaoId → phone 맵 구성
  Logger.log('1. 학생 전화번호 로드');
  var studRes = UrlFetchApp.fetch(FS_URL + '/students?pageSize=300', {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  var phoneMap = {};
  (JSON.parse(studRes.getContentText()).documents || []).forEach(function(doc) {
    var f = doc.fields || {};
    var kid = f.kakaoId ? f.kakaoId.stringValue : '';
    var ph  = f.phone   ? f.phone.stringValue   : '';
    if (kid && ph) phoneMap[kid] = ph;
  });
  Logger.log('학생 수: ' + Object.keys(phoneMap).length);

  // 2. attendance 조회 (2026-05-01~)
  Logger.log('2. 출석 데이터 조회');
  var attRes = UrlFetchApp.fetch(
    'https://firestore.googleapis.com/v1/projects/my-attendance-8122d/databases/(default)/documents:runQuery',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'attendance' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'date' },
              op: 'GREATER_THAN_OR_EQUAL',
              value: { stringValue: '2026-05-01' }
            }
          }
        }
      }),
      muteHttpExceptions: true
    }
  );
  var docs = JSON.parse(attRes.getContentText())
    .filter(function(r) { return r.document; })
    .map(function(r) { return r.document; });
  Logger.log('출석 문서 수: ' + docs.length);

  // 3. phone 없는 문서만 선별
  var writes = [];
  docs.forEach(function(doc) {
    var f = doc.fields || {};
    var phone   = f.phone   ? f.phone.stringValue   : '';
    var kakaoId = f.kakaoId ? f.kakaoId.stringValue : '';
    if (!phone && kakaoId && phoneMap[kakaoId]) {
      writes.push({
        update: { name: doc.name, fields: { phone: { stringValue: phoneMap[kakaoId] } } },
        updateMask: { fieldPaths: ['phone'] }
      });
    }
  });
  Logger.log('업데이트 대상: ' + writes.length + '건');
  if (writes.length === 0) { Logger.log('없음'); return; }

  // 4. 500건씩 batchWrite
  var batchUrl = 'https://firestore.googleapis.com/v1/projects/my-attendance-8122d/databases/(default)/documents:batchWrite';
  for (var i = 0; i < writes.length; i += 500) {
    var chunk = writes.slice(i, i + 500);
    var r = UrlFetchApp.fetch(batchUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ writes: chunk }),
      muteHttpExceptions: true
    });
    Logger.log('배치 ' + (Math.floor(i / 500) + 1) + ': ' + r.getResponseCode());
    Utilities.sleep(300);
  }
  Logger.log('완료');
}

// ==================== 공통 헬퍼 ====================
function createResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function fmtDate(d) { return Utilities.formatDate(new Date(d), 'GMT+9', 'yyyy-MM-dd'); }
function fmtTime(d) { return Utilities.formatDate(d, 'GMT+9', 'HH:mm:ss'); }
function getKSTDateString() {
  return new Date(Date.now() + 9*60*60*1000).toISOString().slice(0, 10);
}

// ==================== 트리거 등록 (1회만 실행) ====================
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncAllStudentStats').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('refreshHolidayCache').timeBased().everyDays(1).atHour(2).create();
  // 매월 1일 오전 9시 자동결제
  ScriptApp.newTrigger('monthlyAutoCharge').timeBased().onMonthDay(1).atHour(9).create();
  Logger.log('트리거 등록 완료! (syncAllStudentStats 03:00 / refreshHolidayCache 02:00 / monthlyAutoCharge 매월1일 09:00)');
}

// ==================== 테스트 함수 ====================
function forceAuth() { Logger.log(UrlFetchApp.fetch('https://www.google.com').getResponseCode()); }
function reallyForceAuth() {
  var f = DocumentApp.create("권한승인용_임시파일");
  DriveApp.getFileById(f.getId()).makeCopy("권한승인용_임시파일_복사본");
  Logger.log("권한 승인 완료!");
}
function testKakaoToken() {
  var res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
    method: 'post',
    payload: {grant_type:'authorization_code', client_id:KAKAO_REST_API_KEY, redirect_uri:'https://knadlg1.github.io/sahanurse-attendance/', code:'test_fake_code'},
    muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() + ' / ' + res.getContentText());
}
