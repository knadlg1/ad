function doGet() {
  return ContentService
    .createTextOutput("서버 정상 작동 중")
    .setMimeType(ContentService.MimeType.TEXT);
}
// ==================== 설정 ====================
const KAKAO_REST_API_KEY = 'ca34b3c2a0cf2d0fe87d9f18b39aa8d8'; // REST API 키

// ==================== 메인 함수 ====================
function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 시트 설정
    var studentSheet = ss.getSheetByName("학생배치");
    var recordSheet = ss.getSheetByName("출석기록");
    
    // 시트가 없으면 생성
    if (!studentSheet) { 
      studentSheet = ss.insertSheet("학생배치"); 
      studentSheet.appendRow(["학생명", "카카오ID", "전화번호", "실습병원명", "병원위도", "병원경도", "디바이스ID", "등록일시", "최종접속"]); 
    }
        if (!recordSheet) { 
      recordSheet = ss.insertSheet("출석기록"); 
      recordSheet.appendRow(["날짜", "학생명", "카카오ID", "병원명", "출근시간", "출근GPS정확도", "출근거리", "퇴근시간", "퇴근GPS정확도", "퇴근거리"]); 
    }
    // 👇👇 새로 추가하는 부분 (서명제출내역 시트 생성)
    var submitSheet = ss.getSheetByName("서명제출내역");
    if (!submitSheet) {
      submitSheet = ss.insertSheet("서명제출내역");
      submitSheet.appendRow(["제출일시", "학생명", "카카오ID", "회차기간", "문서링크"]);
    }
    
    var data = JSON.parse(e.postData.contents);
    console.log('요청 액션:', data.action);
    
        switch(data.action) {
      case 'getKakaoUser': return handleGetKakaoUser(data);
      case 'checkStudent': return handleCheckStudent(data, studentSheet);
      case 'registerStudent': return handleRegisterStudent(data, studentSheet);
      case 'changeDevice': return handleChangeDevice(data, studentSheet);
            case 'getTodayStatus': return handleGetTodayStatus(data, recordSheet); // 기존
      case 'submitMissingVacation': return submitMissingVacation(data, recordSheet); // 👈 이거 추가!
            case 'submitPendingMissingAttendance': return submitPendingMissingAttendance(data, ss);
      case 'requestOTP': return sendOtpToManager(data);
      case 'verifyOTP': return verifyManagerOtp(data);
      case 'getMonthlyRecords': return handleGetMonthlyRecords(data, studentSheet, recordSheet);
      case 'submitToGoogleDoc': return handleSubmitToGoogleDoc(data, submitSheet);
      case 'getStudentStats': return handleGetStudentStats(data, studentSheet, recordSheet);
      case 'uploadProofDocument': return uploadProofDocument(data, ss);           
      case 'generateCertificate': return handleGenerateCertificate(data, ss);
      case 'getHistory': return handleGetHistory(data, ss);
      case 'recordAttendance': return handleRecordAttendance(data, studentSheet, recordSheet);
      
      // 🔥 원장님 전용 기능 2개 추가!
      case 'getStudentList': return getStudentList(studentSheet);
      case 'sendDocumentRequest': return sendDocumentRequest(data, studentSheet);
      // 👇 여기에 추가 👇
      case 'updateStudentHospital': return updateStudentHospital(data, studentSheet);
      
      // 🔥 원장님 누락 서명 승인 처리 길 열어주기 (이 줄을 복사해서 붙여넣으세요)
      case 'approveMissingAttendance': return createResponse(approveMissingAttendance(data));


      default: return createResponse({status: 'error', message: 'Unknown action'});
    }
    
  } catch(error) {
    console.error('doPost 에러:', error);
    return createResponse({status: 'error', message: error.toString()});
  }
}



// 👇 여기서부터 통째로 복사해서 맨 아래에 붙여넣어 주세요 👇
function approveMissingAttendance(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("출석기록"); 
  var row = parseInt(data.row);
  
  if (data.type === '출근' || data.type === '출,퇴근') {
    sheet.getRange(row, 6).setValue(data.inTime); 
  }
  
  if (data.type === '퇴근' || data.type === '출,퇴근') {
    sheet.getRange(row, 9).setValue(data.outTime); 
  }
  
  return { status: 'success' };
}

// ==================== 카카오 사용자 정보 가져오기 ====================
function handleGetKakaoUser(data) {
  try {
    // 1. 인증 코드로 액세스 토큰 받기
    const tokenUrl = 'https://kauth.kakao.com/oauth/token';
    const tokenPayload = {
      'grant_type': 'authorization_code',
      'client_id': KAKAO_REST_API_KEY,
      'redirect_uri': data.redirect_uri,
      'code': data.code
    };
    
    const tokenOptions = {
      'method': 'post',
      'payload': tokenPayload,
      'muteHttpExceptions': true
    };
    
    console.log('토큰 요청 중...');
    const tokenResponse = UrlFetchApp.fetch(tokenUrl, tokenOptions);
    const tokenData = JSON.parse(tokenResponse.getContentText());
    
    if (tokenData.error) {
      console.error('토큰 에러:', tokenData);
      return createResponse({status: 'error', message: tokenData.error_description});
    }
    
    if (!tokenData.access_token) {
      return createResponse({status: 'error', message: '액세스 토큰 없음'});
    }
    
    // 2. 액세스 토큰으로 사용자 정보 받기
    const userUrl = 'https://kapi.kakao.com/v2/user/me';
    const userOptions = {
      'method': 'get',
      'headers': {
        'Authorization': 'Bearer ' + tokenData.access_token
      },
      'muteHttpExceptions': true
    };
    
    console.log('사용자 정보 요청 중...');
    const userResponse = UrlFetchApp.fetch(userUrl, userOptions);
    const userData = JSON.parse(userResponse.getContentText());
    
    if (userData.id) {
      console.log('카카오 ID 받음:', userData.id);
      return createResponse({
        status: 'success',
        kakaoId: userData.id.toString(),
        nickname: userData.properties?.nickname || '',
        email: userData.kakao_account?.email || ''
      });
    } else {
      return createResponse({status: 'error', message: '사용자 정보 없음'});
    }
    
  } catch(error) {
    console.error('카카오 사용자 정보 오류:', error);
    return createResponse({status: 'error', message: error.toString()});
  }
}

function handleCheckStudent(data, studentSheet) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var submitSheet = ss.getSheetByName("서명제출내역");
    var recordSheet = ss.getSheetByName("출석기록");

    var submitData = submitSheet ? submitSheet.getDataRange().getValues() : [];
    var studentData = studentSheet.getDataRange().getValues();
    var todayStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
    var displayDateStr = Utilities.formatDate(new Date(), "GMT+9", "yy.MM.dd");

    for (var i = 1; i < studentData.length; i++) {
      if (String(studentData[i][1]) === String(data.kakaoId)) {
        console.log('학생 찾음:', studentData[i][0]);
        
        // 기기 체크
        var savedDeviceId = String(studentData[i][6]);
        var currentDeviceId = String(data.deviceId);
        if (savedDeviceId && savedDeviceId !== "" && savedDeviceId !== currentDeviceId) {
          return createResponse({ status: 'device_mismatch', message: '등록된 기기가 아닙니다.' });
        } else {
          studentSheet.getRange(i + 1, 7).setValue(currentDeviceId);
        }

        // ==================== 회차 계산 ====================
        var intervals = [];
                var startDateObj = studentData[i][11];   // L열 전체시작
        var endDateObj = studentData[i][12];     // M열 전체종료   

        if (startDateObj && endDateObj) {
          var start = new Date(startDateObj);
          var finalEnd = new Date(endDateObj);
          var today = new Date();
          var currentStart = new Date(start);
          var round = 1;

          var completedRaw = String(studentData[i][22] || "");
var completedSet = {};
completedRaw.split(",").forEach(function(s) { 
  if(s.trim()) completedSet[s.trim()] = true; 
});


          while (currentStart <= finalEnd) {
            var currentEnd = new Date(currentStart);
            currentEnd.setDate(currentStart.getDate() + 29);
            if (currentEnd > finalEnd) currentEnd = new Date(finalEnd);

            var sDateStr = Utilities.formatDate(currentStart, "GMT+9", "yyyy-MM-dd");
            var eDateStr = Utilities.formatDate(currentEnd, "GMT+9", "yyyy-MM-dd");
            var intervalStr = sDateStr + " ~ " + eDateStr;


var isSubmitted = completedSet[intervalStr] === true;

                        var nextDayStart = new Date(currentEnd); nextDayStart.setDate(currentEnd.getDate() + 1); nextDayStart.setHours(0,0,0,0);
            var status = 'locked';
            if (isSubmitted) status = 'completed';
            else if (today >= nextDayStart) status = 'available';

            intervals.push({ round: round, intervalStr: intervalStr, startDate: sDateStr, endDate: eDateStr, status: status });
            currentStart = new Date(currentEnd);
            currentStart.setDate(currentEnd.getDate() + 1);
            round++;
          }
        }

        var userRole = studentData[i][20] === "원장님" ? "admin" : "student";

        // ==================== 오늘 출결 상태 빠르게 계산 (버그 수정 완벽 버전) ====================
        var checkIn = "";
        var checkOut = "";
        var missingRecord = null;
        var foundPastDay = false;

        if (recordSheet) {
          var lastRow = recordSheet.getLastRow();
          var startRow = Math.max(2, lastRow - 300);
          var numRows = Math.max(0, lastRow - startRow + 1);
          var records = numRows > 0 ? recordSheet.getRange(startRow, 1, numRows, 11).getValues() : [];

          for (var r = records.length - 1; r >= 0; r--) {
            if (String(records[r][3]) !== String(data.kakaoId)) continue; 

            var rowDateObj = new Date(records[r][0]);
            var rowDateStr = Utilities.formatDate(rowDateObj, "GMT+9", "yyyy-MM-dd");

                                                if (rowDateStr === todayStr) {
              var inVal = records[r][5];
              var outVal = records[r][8];
              
              // 🔥 32분 8초(1928000ms)를 빼서 1899년 시차 버그 완벽 상쇄!
              if (inVal instanceof Date) inVal = Utilities.formatDate(new Date(inVal.getTime() - 1928000), "GMT+9", "HH:mm:ss");
              if (outVal instanceof Date) outVal = Utilities.formatDate(new Date(outVal.getTime() - 1928000), "GMT+9", "HH:mm:ss");
              
              if (outVal && outVal !== "" && checkOut === "") checkOut = displayDateStr + " " + outVal;
              if (inVal && inVal !== "" && checkIn === "") checkIn = displayDateStr + " " + inVal;
            } else {
              if (!foundPastDay) {
                var dayOfWeek = rowDateObj.getDay();
                if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isKoreanHoliday(rowDateObj) && rowDateStr < todayStr) {
                  foundPastDay = true; 
                  var inVal = records[r][5] || "";
                  var outVal = records[r][8] || "";
                  var rowNum = startRow + r;

                  if (inVal === "" && outVal === "") {
                    // 통으로 결석한 날은 누락 아님! 패스!
                  } else if (inVal !== "" && outVal === "") {
                    missingRecord = { date: rowDateStr, type: '퇴근', row: rowNum };
                  } else if (inVal === "" && outVal !== "") {
                    missingRecord = { date: rowDateStr, type: '출근', row: rowNum };
                  } else if (inVal !== "" && outVal !== "") {
                    var diff = timeToMins(outVal) - timeToMins(inVal);
                    if (diff >= 0 && diff <= 10) missingRecord = { date: rowDateStr, type: '출근', row: rowNum };
                  }
                }
              }
            }
            if (checkIn !== "" && foundPastDay) break; 
          }
        }

        // ==================== 통계 ====================
        var totalPeriodStr = "-";
        if (studentData[i][9] && studentData[i][10]) {
          var sDate = new Date(studentData[i][9]);
          var eDate = new Date(studentData[i][10]);
          totalPeriodStr = Utilities.formatDate(sDate, "GMT+9", "yy.MM.dd") + " ~ " + Utilities.formatDate(eDate, "GMT+9", "yy.MM.dd");
        }

        var lastUpdated = studentData[i][17] ? Utilities.formatDate(new Date(studentData[i][17]), "GMT+9", "yy.MM.dd HH:mm") : "업데이트 전";
        var pendingReq = studentData[i][18] ? String(studentData[i][18]) : "";

        return createResponse({
          status: 'found', name: studentData[i][0], phone: studentData[i][2], hospital: studentData[i][3],
          hospitalLat: parseFloat(studentData[i][4]) || 37.5665, hospitalLon: parseFloat(studentData[i][5]) || 126.9780,
          intervals: intervals, role: userRole,
          todayStatus: { checkIn: checkIn, checkOut: checkOut, missingRecord: missingRecord },
          stats: { totalPeriodStr: totalPeriodStr, totalHours: parseInt(studentData[i][13]) || 0, tardyCount: parseInt(studentData[i][14]) || 0, earlyCount: parseInt(studentData[i][15]) || 0, outCount: parseInt(studentData[i][16]) || 0, lastUpdated: lastUpdated, pendingRequest: pendingReq }
        });
      }
    }
    return createResponse({ status: 'not_found' });
  } catch(error) { return createResponse({ status: 'error', message: error.toString() }); }
}

// ==================== 신규 학생 등록 ====================
function handleRegisterStudent(data, studentSheet) {
  try {
    var studentData = studentSheet.getDataRange().getValues();
    
    // 이름과 전화번호 정규화
    var inputName = data.name.replace(/\s/g, "");
    var inputPhone = data.phone.replace(/[^0-9]/g, "");
    
    console.log('등록 시도:', inputName, inputPhone);
    
    for (var i = 1; i < studentData.length; i++) {
      var sheetName = studentData[i][0].toString().replace(/\s/g, "");
      var sheetPhone = studentData[i][2].toString().replace(/[^0-9]/g, "");
      
      if (sheetName === inputName && sheetPhone === inputPhone) {
        console.log('명단에서 찾음:', studentData[i][0]);
        
        // 이미 다른 카카오ID가 등록되어 있는지 확인
        if (studentData[i][1] && studentData[i][1] !== "" && String(studentData[i][1]) !== String(data.kakaoId)) {
          console.log('이미 다른 계정으로 등록됨');
          return createResponse({
            status: 'fail',
            message: '이미 다른 카카오 계정으로 등록되어 있습니다.'
          });
        }
        
        // 이미 다른 기기가 등록되어 있는지 확인
        var savedDeviceId = String(studentData[i][6]);
        var currentDeviceId = String(data.deviceId);
        
        if (savedDeviceId && savedDeviceId !== "" && savedDeviceId !== "undefined" && savedDeviceId !== currentDeviceId) {
          console.log('이미 다른 기기로 등록됨');
          return createResponse({
            status: 'fail',
            message: '이미 다른 기기에서 등록되어 있습니다. 학원에 문의하세요.'
          });
        }
        
        // 카카오ID와 기기고유값 저장
        studentSheet.getRange(i + 1, 2).setValue(data.kakaoId);
        studentSheet.getRange(i + 1, 7).setValue(currentDeviceId);
        studentSheet.getRange(i + 1, 8).setValue(new Date()); // 등록일시
        studentSheet.getRange(i + 1, 9).setValue(new Date()); // 최종접속
        
        return createResponse({
          status: 'success',
          name: studentData[i][0],
          phone: studentData[i][2],
          hospital: studentData[i][3],
          hospitalLat: parseFloat(studentData[i][4]) || 37.5665,
          hospitalLon: parseFloat(studentData[i][5]) || 126.9780
        });
      }
    }
    
    // 명단에 없음
    console.log('명단에 없음');
    return createResponse({
      status: 'fail',
      message: '등록된 수강생이 아닙니다. 학원에 문의하세요.'
    });
    
  } catch(error) {
    console.error('학생 등록 오류:', error);
    return createResponse({status: 'error', message: error.toString()});
  }
}

// ==================== 기기 변경 ====================
function handleChangeDevice(data, studentSheet) {
  try {
    var studentData = studentSheet.getDataRange().getValues();
    
    // 이름과 전화번호로 찾기
    var inputName = data.name.replace(/\s/g, "");
    var inputPhone = data.phone.replace(/[^0-9]/g, "");
    
    for (var i = 1; i < studentData.length; i++) {
      var sheetName = studentData[i][0].toString().replace(/\s/g, "");
      var sheetPhone = studentData[i][2].toString().replace(/[^0-9]/g, "");
      
      if (sheetName === inputName && sheetPhone === inputPhone) {
        // 새 카카오ID와 디바이스ID로 업데이트
        studentSheet.getRange(i + 1, 2).setValue(data.newKakaoId);
        studentSheet.getRange(i + 1, 7).setValue(data.newDeviceId);
        studentSheet.getRange(i + 1, 9).setValue(new Date()); // 최종접속
        
        console.log('기기 변경 완료:', studentData[i][0]);
        
        return createResponse({
          status: 'success',
          name: studentData[i][0],
          phone: studentData[i][2],  // 전화번호 추가!
          hospital: studentData[i][3],
          hospitalLat: parseFloat(studentData[i][4]) || 37.5665,
          hospitalLon: parseFloat(studentData[i][5]) || 126.9780
        });
      }
    }
    
    return createResponse({
      status: 'fail',
      message: '정보가 일치하지 않습니다.'
    });
    
  } catch(error) {
    console.error('기기 변경 오류:', error);
    return createResponse({status: 'error', message: error.toString()});
  }
}

function handleGetTodayStatus(data, recordSheet) {
  try {
    var todayStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
    var displayDateStr = Utilities.formatDate(new Date(), "GMT+9", "yy.MM.dd");

    var checkIn = "";
    var checkOut = "";
    var missingRecords = [];
    var added = {};

    var lastRow = recordSheet.getLastRow();
    var startRow = Math.max(2, lastRow - 300);
    var numRows = Math.max(0, lastRow - startRow + 1);
    var records = numRows > 0 ? recordSheet.getRange(startRow, 1, numRows, 11).getValues() : [];

    for (var i = records.length - 1; i >= 0; i--) {
      if (String(records[i][3]) !== String(data.kakaoId)) continue;

      var rowDateObj = new Date(records[i][0]);
      var rowDateStr = Utilities.formatDate(rowDateObj, "GMT+9", "yyyy-MM-dd");

      if (rowDateStr === todayStr) {
        var inValToday = records[i][5];
        var outValToday = records[i][8];

        if (inValToday instanceof Date) inValToday = Utilities.formatDate(new Date(inValToday.getTime() - 1928000), "GMT+9", "HH:mm:ss");
        if (outValToday instanceof Date) outValToday = Utilities.formatDate(new Date(outValToday.getTime() - 1928000), "GMT+9", "HH:mm:ss");

        if (outValToday && outValToday !== "" && checkOut === "") checkOut = displayDateStr + " " + outValToday;
        if (inValToday && inValToday !== "" && checkIn === "") checkIn = displayDateStr + " " + inValToday;
      } else {
        var dayOfWeek = rowDateObj.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isKoreanHoliday(rowDateObj) && rowDateStr < todayStr) {
          var inVal = records[i][5] || "";
          var outVal = records[i][8] || "";
          var rowNum = startRow + i;
          var missingType = "";

          if (inVal !== "" && outVal === "") {
            missingType = "퇴근";
          } else if (inVal === "" && outVal !== "") {
            missingType = "출근";
          } else if (inVal !== "" && outVal !== "") {
            var diff = timeToMins(outVal) - timeToMins(inVal);
            if (diff >= 0 && diff <= 10) missingType = "출근";
          }

          if (missingType) {
            var key = rowDateStr + "_" + rowNum;
            if (!added[key]) {
              missingRecords.push({ date: rowDateStr, type: missingType, row: rowNum });
              added[key] = true;
            }
          }
        }
      }
    }

    return createResponse({
      status: 'success',
      checkIn: checkIn,
      checkOut: checkOut,
      missingRecord: missingRecords.length > 0 ? missingRecords[0] : null, // 하위호환
      missingRecords: missingRecords
    });
  } catch (error) {
    return createResponse({ status: 'error', message: error.toString() });
  }
}


// 시간 문자열(18:00)을 '분(Minutes)'으로 변환하는 헬퍼 함수
function timeToMins(tStr) {
  if(!tStr || tStr === "-") return 0;
  var parts = String(tStr).replace(/[^0-9:]/g, "").split(":");
  if(parts.length < 2) return 0;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// ==================== [추가] 누락 - 휴가/기타 즉시 제출 ====================
function submitMissingVacation(data, recordSheet) {
  try {
    // 6열(F)=출근시간, 9열(I)=퇴근시간
    recordSheet.getRange(data.row, 6).setValue("휴가/기타");
    recordSheet.getRange(data.row, 9).setValue("휴가/기타");
    return createResponse({status: 'success'});
  } catch(e) { return createResponse({status: 'error', message: e.toString()}); }
}

// ==================== [수정됨] 담당자 OTP 실제 문자 발송 (알리고 API 연동) ====================
function sendOtpToManager(data) {
  // 테스트용: SMS 발송 생략, 바로 성공 처리
  var cache = CacheService.getScriptCache();
  cache.put(data.phone, '0000', 300);
  return createResponse({ status: 'success', message: '테스트 모드 (인증번호: 0000)' });

  try {
    var phone = data.phone;
    if (!phone) throw new Error("휴대폰 번호가 없습니다.");

    // 1. 6자리 난수(인증번호) 생성
    var otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 2. 캐시에 5분(300초) 동안 저장
    var cache = CacheService.getScriptCache();
    cache.put(phone, otpCode, 300); 

    // ====================================================================
    // 🔥 실제 문자(SMS) 발송 로직 (알리고 API) 🔥
    // 원장님이 알리고(aligo.in) 가입 후 발급받은 정보를 아래에 입력하세요.
    // ====================================================================
    var ALIGO_API_KEY = 'fmtbgsvith1i5vra7afmdg56g8y4ph3x';    // 예: t8j4...
    var ALIGO_USER_ID = 'sahajeil2556';    // 예: sahanurse
    var SENDER_PHONE  = '01093234333';  // 예: 0511234567 (- 없이 숫자만)

    var smsUrl = "https://apis.aligo.in/send/";
    
    // 카카오톡 알림톡이 아닌 일반 문자(SMS)로 발송합니다.
    var payload = {
      "key": ALIGO_API_KEY,
      "user_id": ALIGO_USER_ID,
      "sender": SENDER_PHONE,
      "receiver": phone,
      "msg": "[Here 출결관리]\n담당자 서명 인증번호 [" + otpCode + "]를 입력해주세요."
    };

    var options = {
      "method": "post",
      "payload": payload,
      "muteHttpExceptions": true
    };

    // 3. 알리고 서버로 문자 발송 명령 전송
    var response = UrlFetchApp.fetch(smsUrl, options);
    var resData = JSON.parse(response.getContentText());

    // 알리고 발송 성공 결과 코드는 "1" 입니다.
    if (resData.result_code == "1") {
      return createResponse({ status: 'success', message: '입력하신 번호로 인증번호 문자가 발송되었습니다.' });
    } else {
      // 충전 잔액 부족, 번호 미등록 등 알리고 서버에서 거절한 경우
      return createResponse({ status: 'error', message: '문자 발송 실패: ' + resData.message });
    }

  } catch(e) {
    return createResponse({ status: 'error', message: e.toString() });
  }
}

// ==================== [추가] 담당자 OTP 검증 로직 ====================
function verifyManagerOtp(data) {
  try {
    var phone = data.phone;
    var inputOtp = data.otp;
    // 테스트용: 0000이면 무조건 통과
    if (inputOtp === '0000') return createResponse({ status: 'success', message: '인증 완료' });
    var cache = CacheService.getScriptCache();
    var storedOtp = cache.get(phone);

    if (storedOtp && storedOtp === inputOtp) {
      cache.remove(phone); // 재사용 방지
      return createResponse({ status: 'success', message: '인증이 완료되었습니다.' });
    } else {
      return createResponse({ status: 'error', message: '인증번호가 불일치하거나 만료되었습니다.' });
    }
  } catch(e) {
    return createResponse({ status: 'error', message: e.toString() });
  }
}

// ==================== [수정됨] 누락 서명 제출 (구글문서 자동생성 및 시트 정리) ====================
function submitPendingMissingAttendance(data, ss) {
  try {
    if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. 학생배치 시트에서 전체 실습기간 및 병원명 가져오기
    var studentSheet = ss.getSheetByName("학생배치");
    var sData = studentSheet.getDataRange().getValues();
    var totalPeriod = "-";
    var hospitalName = data.hospital || "실습병원";
    
    for (var i = 1; i < sData.length; i++) {
      if (String(sData[i][1]) === String(data.kakaoId)) {
        // 전체 훈련시작일(L열=11), 종료일(M열=12) 가져오기
        var sDate = sData[i][11] ? Utilities.formatDate(new Date(sData[i][11]), "GMT+9", "yyyy-MM-dd") : "";
        var eDate = sData[i][12] ? Utilities.formatDate(new Date(sData[i][12]), "GMT+9", "yyyy-MM-dd") : "";
        if (sDate && eDate) totalPeriod = sDate + " ~ " + eDate;
        
        hospitalName = sData[i][3];
        break;
      }
    }

    // 🔥 누락유형(출근/퇴근)에 맞는 정확한 시간만 쏙 뽑아내기 🔥
    var exactMissingTime = "";
    if (data.missingType === '출근') {
      exactMissingTime = data.inTime;
    } else if (data.missingType === '퇴근') {
      exactMissingTime = data.outTime;
    } else {
      // 출근, 퇴근 둘 다 누락한 경우
      exactMissingTime = data.inTime + " / 퇴근 " + data.outTime;
    }

    // 2. 구글 문서 생성 
    // 🚨 (여기에 원장님의 템플릿 ID와 폴더 ID를 꼭 넣어주세요!) 🚨
    var TEMPLATE_DOC_ID = '1B6JjJRg6ySRwZK47BeWBL4CL5n51yFh7UO2oYHe3eFQ'; 
    var FOLDER_ID = '1MIi3S-v0mKr5ra2pxMZHemRLtj2twWG-'; 
    
    var templateFile = DriveApp.getFileById(TEMPLATE_DOC_ID);
    var targetFolder = DriveApp.getFolderById(FOLDER_ID);
    var newFileName = data.name + "_" + data.missingDate + "_" + data.missingType + "누락확인서";
    
    var newFile = templateFile.makeCopy(newFileName, targetFolder);
    var doc = DocumentApp.openById(newFile.getId());
    var body = doc.getBody();

    // 💡 올려주신 표 양식에 맞게 데이터 치환!
    // (반코드는 시트에 따로 정보가 없으므로 일단 빈칸으로 지워지게 처리했습니다)
    body.replaceText("{{반코드}}", ""); 
    body.replaceText("{{실습기간}}", totalPeriod);
    body.replaceText("{{실습병원명}}", hospitalName);
    body.replaceText("{{학생이름}}", data.name);
    body.replaceText("{{담당자번호}}", data.managerPhone);
    
    // 대상 일자 및 비고 란에 들어가는 3종 세트!
    body.replaceText("{{누락날짜}}", data.missingDate);
    body.replaceText("{{누락유형}}", data.missingType);
    body.replaceText("{{누락시간}}", exactMissingTime);

    // 서명 칸 이미지로 변환해서 삽입
    replaceTextWithImage(body, "{{학생서명}}", data.studentSig);
    replaceTextWithImage(body, "{{담당자서명}}", data.managerSig);

    doc.saveAndClose();
    var docUrl = newFile.getUrl(); // 만들어진 문서 링크

    // 3. 승인 대기 시트에 저장 (원장님 승인용)
    var pendingSheet = ss.getSheetByName("누락승인대기");
    if (!pendingSheet) {
      pendingSheet = ss.insertSheet("누락승인대기");
      pendingSheet.appendRow(["제출일시", "카카오ID", "학생명", "누락일", "누락유형", "담당자번호", "상태", "출석기록행", "출근입력시간", "퇴근입력시간"]);
    }
    var timeStamp = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm:ss");
    
    pendingSheet.appendRow([
      timeStamp, data.kakaoId, data.name, data.missingDate, data.missingType, 
      data.managerPhone, "대기", data.row, data.inTime, data.outTime
    ]);

    // 4. 🔥 제출 목록 한눈에 보기 시트 생성 및 저장 🔥
    var logSheet = ss.getSheetByName("출퇴누락제출내역");
    if (!logSheet) {
      logSheet = ss.insertSheet("출퇴누락제출내역");
      // 헤더(첫 줄) 디자인 예쁘게 만들기
      var headerRange = logSheet.getRange("A1:F1");
      headerRange.setValues([["제출일시", "학생명", "누락일자", "누락유형", "담당자번호", "확인서_문서링크"]]);
      headerRange.setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
      logSheet.setFrozenRows(1); // 스크롤 시 첫 줄 고정
    }
    
    logSheet.appendRow([
      timeStamp, data.name, data.missingDate, data.missingType, data.managerPhone, docUrl
    ]);

    return createResponse({status: 'success', message: '성공'});
  } catch(e) {
    return createResponse({status: 'error', message: e.toString()});
  }
}

// ==================== [추가] 원장님 화면: 승인 대기 목록 불러오기 ====================
function getPendingApprovals() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var pendingSheet = ss.getSheetByName("누락승인대기");
    if(!pendingSheet) return createResponse({status: 'success', data: []});
    
    var data = pendingSheet.getDataRange().getValues();
    var pendingList = [];
    
    for (var i = 1; i < data.length; i++) {
      if (data[i][6] === "대기") { 
        pendingList.push({
          rowIndex: i + 1, // 누락승인대기 시트의 행 번호
          kakaoId: data[i][1],
          studentName: data[i][2],
          missingDate: data[i][3],
          missingType: data[i][4], 
          managerPhone: data[i][5],
          recordRow: data[i][7], // 출석기록 시트의 행 번호
          inTime: data[i][8],    // 프론트로 시간 전달
          outTime: data[i][9]    // 프론트로 시간 전달
        });
      }
    }
    return createResponse({status: 'success', data: pendingList});
  } catch(e) {
    return createResponse({status: 'error', message: e.toString()});
  }
}

// ==================== [추가] 원장님 화면: 승인 처리 (F열, I열 완벽 분리) ====================
function approveMissingAttendance(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var recordSheet = ss.getSheetByName("출석기록");
    var pendingSheet = ss.getSheetByName("누락승인대기");
    
    var targetRow = parseInt(data.row);
    
    // 1. 출석기록 시트 F열(출근), I열(퇴근)에 학생이 입력한 진짜 시간을 꽂아넣기!
    if (data.type === '출근' || data.type === '출,퇴근') {
      recordSheet.getRange(targetRow, 6).setValue(data.inTime); 
    }
    if (data.type === '퇴근' || data.type === '출,퇴근') {
      recordSheet.getRange(targetRow, 9).setValue(data.outTime); 
    }
    
    // 2. 대기 시트 상태 변경 ('대기' -> '승인완료')
    if(data.recordId) {
       pendingSheet.getRange(parseInt(data.recordId), 7).setValue("승인완료");
    }
    
    return createResponse({status: 'success'});
  } catch(e) {
    return createResponse({status: 'error', message: e.toString()});
  } finally {
    lock.releaseLock();
  }
}

// ==================== 출퇴근 기록 (초고속 버전) ====================
function handleRecordAttendance(data, studentSheet, recordSheet) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); 
    var todayStr = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd");
    
    // 🔥 최신 300줄만 가벼운 getValues()로 불러오기
    var lastRow = recordSheet.getLastRow();
    var startRow = Math.max(2, lastRow - 300);
    var numRows = Math.max(0, lastRow - startRow + 1);
    var records = numRows > 0 ? recordSheet.getRange(startRow, 1, numRows, recordSheet.getLastColumn()).getValues() : [];
    
    var alreadyCheckedIn = false, alreadyCheckedOut = false, latestInTime = "-";
    var targetRowIndex = -1; 
    
    for (var i = records.length - 1; i >= 0; i--) { // 🔥 0까지 탐색
      var rowDateStr = (records[i][0] instanceof Date) ? Utilities.formatDate(records[i][0], "GMT+9", "yyyy-MM-dd") : String(records[i][0]).substring(0, 10);
      
      if (rowDateStr === todayStr && String(records[i][3]) === String(data.kakaoId)) {
        if (records[i][5] && records[i][5] !== "" && !alreadyCheckedIn) { 
          alreadyCheckedIn = true; 
          latestInTime = String(records[i][5]); 
          targetRowIndex = startRow + i; // 🔥 부분으로 잘라왔으므로 실제 줄 번호는 startRow + i
        }
        if (records[i][8] && records[i][8] !== "" && !alreadyCheckedOut) { 
          alreadyCheckedOut = true; 
        }
      }
    }
    
    // [출근 버튼을 눌렀을 때]
    if (data.type === "출근") {
      if (alreadyCheckedIn) return createResponse({ status: 'duplicate', message: '이미 출근 처리되었습니다.' });
      
      recordSheet.appendRow([ todayStr, data.name, data.phone || "", data.kakaoId, data.hospital, data.time, data.accuracy || "", data.distance || "", "", "", "" ]);
      return createResponse({status: 'success'});
      
    // [퇴근 버튼을 눌렀을 때]
    } else if (data.type === "퇴근") {
      if (alreadyCheckedOut) return createResponse({ status: 'duplicate', message: '이미 퇴근 처리되었습니다.' });
      
      if (targetRowIndex !== -1) {
        recordSheet.getRange(targetRowIndex, 9).setValue(data.time);
        recordSheet.getRange(targetRowIndex, 10).setValue(data.accuracy || "");
        recordSheet.getRange(targetRowIndex, 11).setValue(data.distance || "");
      } else {
        recordSheet.appendRow([ todayStr, data.name, data.phone || "", data.kakaoId, data.hospital, "", "", "", data.time, data.accuracy || "", data.distance || "" ]);
      }
      
      // 🔥 통계(지각/조퇴/시간)는 새벽에 도는 syncAllStudentStats에 맡기고 즉시 퇴근 성공 응답! (속도 엄청 빠름)
      return createResponse({status: 'success'});
    }
    
    return createResponse({status: 'error', message: 'Invalid type'});
  } catch(error) { 
    return createResponse({status: 'error', message: error.toString()}); 
  } finally { 
    lock.releaseLock(); 
  }
}

// ==================== 응답 생성 헬퍼 ====================
function createResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==================== 테스트 함수 ====================
function test() {
  // 카카오 API 테스트
  const testData = {
    action: 'getKakaoUser',
    code: 'test_code',
    redirect_uri: 'https://knadlg1.github.io/sahanurse-attendance/'
  };
  
  const result = handleGetKakaoUser(testData);
  console.log('테스트 결과:', result.getContent());
}

function forceAuth() {
  var response = UrlFetchApp.fetch('https://www.google.com');
  Logger.log('권한 승인 성공: ' + response.getResponseCode());
}

function testKakaoToken() {
  var url = 'https://kauth.kakao.com/oauth/token';
  var payload = {
    'grant_type': 'authorization_code',
    'client_id': KAKAO_REST_API_KEY,
    'redirect_uri': 'https://knadlg1.github.io/sahanurse-attendance/',
    'code': 'test_fake_code'
  };
  
  var options = {
    'method': 'post',
    'payload': payload,
    'muteHttpExceptions': true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  Logger.log('응답 코드: ' + response.getResponseCode());
  Logger.log('응답 내용: ' + response.getContentText());
}

// ==================== 월간 서명 데이터 불러오기 ====================
function handleGetMonthlyRecords(data, studentSheet, recordSheet) {
  try {
    var kakaoId = String(data.kakaoId);
    var startDateObj = new Date(data.targetStartDate);
    var endDateObj = new Date(data.targetEndDate);
    
    var records = recordSheet.getDataRange().getDisplayValues(); 
    var studentData = studentSheet.getDataRange().getValues();
    
    var shiftType = "주간";
    var isJabi = false; // 🔥 자비생 여부 확인
    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) === kakaoId) {
        if (studentData[s][19]) shiftType = String(studentData[s][19]).trim();
        if (String(studentData[s][20]).trim() === "자비") isJabi = true;
        break;
      }
    }

    var monthlyData = [];
    var totalHours = 0;
    var diffTime = Math.abs(endDateObj - startDateObj);
    var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    for (var dayOffset = 0; dayOffset < diffDays; dayOffset++) {
      var currentDate = new Date(startDateObj.getTime());
      currentDate.setDate(startDateObj.getDate() + dayOffset);
      var dateStr = Utilities.formatDate(currentDate, "GMT+9", "yyyy-MM-dd");
      
            var isHolidayDay = (currentDate.getDay() === 0 || currentDate.getDay() === 6 || isKoreanHoliday(currentDate));
      var dailyRecord = { date: dateStr, month: currentDate.getMonth() + 1, day: currentDate.getDate(), dayOfWeek: currentDate.getDay(), isAbsent: true, isHoliday: isHolidayDay, checkIn: "-", checkOut: "-", workHours: 0 };
      
      for (var r = records.length - 1; r >= 1; r--) {
        var rowDateStr = records[r][0]; 
        if (rowDateStr === dateStr && String(records[r][3]) === kakaoId) {
          if (records[r][8] && records[r][8] !== "" && dailyRecord.checkOut === "-") dailyRecord.checkOut = String(records[r][8]);
          if (records[r][5] && records[r][5] !== "" && dailyRecord.checkIn === "-") { dailyRecord.isAbsent = false; dailyRecord.checkIn = String(records[r][5]); }
          if (dailyRecord.checkIn !== "-" && dailyRecord.checkOut !== "-") break;
        }
      }
      
      if (dailyRecord.checkIn !== "-" && dailyRecord.checkOut !== "-") {
        // 🔥 자비생 여부까지 함께 계산식에 던져줌
        var logicResult = calculateTimeLogic(dailyRecord.checkIn, dailyRecord.checkOut, shiftType, currentDate, isJabi);
        if (logicResult.isAbsent) { dailyRecord.isAbsent = true; } 
        dailyRecord.workHours = logicResult.hours + "h"; 
        totalHours += logicResult.hours;
      }
      monthlyData.push(dailyRecord);
    }
    return createResponse({ status: 'success', startDate: Utilities.formatDate(startDateObj, "GMT+9", "yyyy-MM-dd"), endDate: Utilities.formatDate(endDateObj, "GMT+9", "yyyy-MM-dd"), totalHours: totalHours, records: monthlyData });
  } catch(error) { return createResponse({status: 'error', message: error.toString()}); }
}

// ==================== 구글 문서 연동 및 제출 (최종) ====================
function handleSubmitToGoogleDoc(data, submitSheet) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var studentSheet = ss.getSheetByName("학생배치");
    var studentData = studentSheet.getDataRange().getValues();
    
    // 🔥 1. 학생배치 시트에서 전체 실습시작일(J) ~ 종료일(K) 찾기
    var totalPeriodStr = "";
    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) === String(data.kakaoId)) {
        var sDate = studentData[s][9] ? Utilities.formatDate(new Date(studentData[s][9]), "GMT+9", "yyyy-MM-dd") : "";
        var eDate = studentData[s][10] ? Utilities.formatDate(new Date(studentData[s][10]), "GMT+9", "yyyy-MM-dd") : "";
        totalPeriodStr = sDate + " ~ " + eDate;
        break;
      }
    }

    // 🔥 선생님이 만들어둔 구글 문서 템플릿 ID 꼭 입력!
    var TEMPLATE_DOC_ID = '1z-OSf6lLiLNmFI2tDzUY7_U_0wzNiqm5Be_Sze2ltzw'; 
    var FOLDER_ID = '1r8NuI3cHADTj06ohBer74FAlHPHj9ZTX'; 

    var templateFile = DriveApp.getFileById(TEMPLATE_DOC_ID);
    var targetFolder = FOLDER_ID ? DriveApp.getFolderById(FOLDER_ID) : DriveApp.getRootFolder();
    
    var phoneLast4 = data.phone.length > 4 ? data.phone.slice(-4) : data.phone;
    var newFileName = "(실습근무카드," + data.name + "," + phoneLast4 + "," + data.intervalStr + ")";
    
    var newFile = templateFile.makeCopy(newFileName, targetFolder);
    var doc = DocumentApp.openById(newFile.getId());
    var body = doc.getBody();

    // 2. 상단 기본 정보 치환 ({{실습기간}} 에 전체 기간 삽입!)
    body.replaceText("{{이름}}", data.name || "");
    body.replaceText("{{실습병원명}}", data.hospital || "");
    body.replaceText("{{실습기간}}", totalPeriodStr || ""); // 👈 전체 기간으로 변경!
    body.replaceText("{{단위기간시작일}}", data.targetStartDate || "");
    body.replaceText("{{단위기간종료일}}", data.targetEndDate || "");

    // 3. 1~30일차 세부 출결 시간 및 서명 이미지 치환
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
        body.replaceText("{{단위기간시작일" + i + "}}", "");
        body.replaceText("{{출근시간" + i + "}}", "");
        body.replaceText("{{퇴근시간" + i + "}}", "");
        body.replaceText("{{실습시간" + i + "}}", "");
        body.replaceText("{{누적시간" + i + "}}", "");
        body.replaceText("{{학생서명" + i + "}}", "");
        body.replaceText("{{담당자서명" + i + "}}", "");
      }
    }
    
    doc.saveAndClose();

    // 4. 서명제출내역 시트에 기록 남기기
    submitSheet.appendRow([
      new Date(), data.name, data.kakaoId, data.intervalStr, newFile.getUrl()
    ]);

    // W열에 완료 회차 기록
var sData = studentSheet.getDataRange().getValues();
for (var si = 1; si < sData.length; si++) {
  if (String(sData[si][1]) === String(data.kakaoId)) {
    var existing = String(sData[si][22] || "");
    studentSheet.getRange(si + 1, 23).setValue(
      existing ? existing + "," + data.intervalStr : data.intervalStr
    );
    break;
  }
}

    return createResponse({ status: 'success', docUrl: newFile.getUrl() });
    
  } catch(error) {
    console.error('문서 제출 오류:', error);
    return createResponse({status: 'error', message: error.toString()});
  }
}

// (기존 handleSubmitToGoogleDoc 함수 끝나는 괄호 } 바로 아래부터 맨 끝까지 싹 지우고 아래로 교체!)

// 📌 텍스트 태그를 찾아 Base64 이미지를 삽입해주는 헬퍼 함수
function replaceTextWithImage(body, searchText, base64String) {
  var found = body.findText(searchText);
  if (found) {
    var textElement = found.getElement().asText();
    if (base64String && base64String !== "") {
      try {
        var blob = Utilities.newBlob(Utilities.base64Decode(base64String), 'image/png', 'signature.png');
        var parent = textElement.getParent();
        
        // 표(Table)나 문단(Paragraph)에 이미지를 가로 50, 세로 30 크기로 삽입
        if (parent.getType() === DocumentApp.ElementType.PARAGRAPH) {
          parent.asParagraph().insertInlineImage(0, blob).setWidth(50).setHeight(30);
        } else if (parent.getType() === DocumentApp.ElementType.LIST_ITEM) {
          parent.asListItem().insertInlineImage(0, blob).setWidth(50).setHeight(30);
        }
      } catch(e) {
        console.log('이미지 삽입 에러:', e);
      }
    }
    // 삽입 후 원래 있던 {{태그}} 글씨는 지워줌
    textElement.replaceText(searchText, "");
  }
}

// ==================== 진짜 확실한 권한 팝업 스위치 ====================
function reallyForceAuth() {
  var tempDoc = DocumentApp.create("권한승인용_임시파일");
  var file = DriveApp.getFileById(tempDoc.getId());
  file.makeCopy("권한승인용_임시파일_복사본");
  Logger.log("권한 승인 완료!");
}

// ==================== 시간 계산 핵심 로직 (주야간 & 주말 & 자비생 분리) ====================
function calculateTimeLogic(inStr, outStr, shiftType, dateObj, isJabi) {
  var result = { hours: 0, isTardy: false, isEarlyLeave: false, isAbsent: false };
  if (!inStr || !outStr || inStr === "-" || outStr === "-") return result;

  try {
    var parseTime = function(tStr) {
      var upperStr = String(tStr).toUpperCase();
      var isPM = upperStr.indexOf("PM") > -1;
      var isAM = upperStr.indexOf("AM") > -1;
      var cleanStr = upperStr.replace(/AM|PM|[가-힣]/g, "").trim();
      var p = cleanStr.split(":");
      var h = parseInt(p[0], 10) || 0; var m = parseInt(p[1], 10) || 0; var s = p.length > 2 ? parseInt(p[2], 10) : 0;
      if (isPM && h !== 12) h += 12;
      if (isAM && h === 12) h = 0;
      return { h: h, m: m, s: s };
    };

    var inT = parseTime(inStr); var outT = parseTime(outStr);
    var inH = inT.h, inM = inT.m, inS = inT.s;
    var outH = outT.h, outM = outT.m, outS = outT.s;

    var isWeekendOrHoliday = false;
    if (dateObj) {
      var day = dateObj.getDay(); 
      if (day === 0 || day === 6 || (typeof isKoreanHoliday === 'function' && isKoreanHoliday(dateObj))) {
        isWeekendOrHoliday = true;
      }
    }

    // 🔥 핵심: 주말이거나 '자비' 수강생이면 지각/조퇴/결석 페널티 완전 면제!
    var skipPenalties = isWeekendOrHoliday || isJabi;

    var isTardy = false;
    var isEarly = false;

    // 페널티 면제 대상이 아닐 때만 지각/조퇴 계산
    if (!skipPenalties) {
      if (shiftType === "야간") {
        if (inH > 18) isTardy = true; else if (inH === 18 && inM > 30) isTardy = true;
        if (outH < 22) isEarly = true; else if (outH === 22 && outM < 29) isEarly = true;
      } else {
        if (inH > 9) isTardy = true; else if (inH === 9 && inM > 0) isTardy = true;
        if (outH < 16) isEarly = true; else if (outH === 16 && outM < 29) isEarly = true;
      }
    }

    var adjInH = inH, adjInM = 0;
    if (inM === 0 && inS <= 59) { adjInM = 0; }
    else if ((inM < 30) || (inM === 30 && inS <= 59)) { adjInM = 30; }
    else { adjInH += 1; adjInM = 0; }

    var adjOutH = outH, adjOutM = 0;
    if ((outM === 59 && outS >= 0) || (outM === 58 && outS === 59)) { adjOutH += 1; adjOutM = 0; } 
    else if (outM >= 29) { adjOutM = 30; } 
    else { adjOutM = 0; } 

    var inTimeDec = adjInH + (adjInM / 60);
    var outTimeDec = adjOutH + (adjOutM / 60);
    var workedDec = outTimeDec - inTimeDec;

    if (workedDec < 0) workedDec = 0;

    // 4시간 초과 시 30분 휴게시간 차감 (이건 자비생도 동일하게 적용)
    if (workedDec > 4.0) { workedDec -= 0.5; }

    var finalHours = Math.floor(workedDec);
    if (finalHours > 8) finalHours = 8;

    if (!skipPenalties) {
      var minHours = (shiftType === "야간") ? 2 : 4; 
      if (finalHours < minHours) {
        result.isAbsent = true; result.isTardy = false; result.isEarlyLeave = false;
      } else {
        result.isAbsent = false; result.isTardy = isTardy; result.isEarlyLeave = isEarly;
      }
    } else {
      // 🔥 자비생 및 주말은 페널티 무조건 없음 (시간만 누적)
      result.isAbsent = false; result.isTardy = false; result.isEarlyLeave = false;
    }

    result.hours = finalHours;
    return result;
  } catch(e) {
    return result;
  }
}

// ==================== 통계 가져오기 (배너 표시 데이터 추가) ====================
function handleGetStudentStats(data, studentSheet) {
  try {
    var studentData = studentSheet.getDataRange().getValues();
    var totalPeriodStr = "-";
    
    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) === String(data.kakaoId)) {
        if (studentData[s][9] && studentData[s][10]) {
          var sDate = new Date(studentData[s][9]);
          var eDate = new Date(studentData[s][10]);
          totalPeriodStr = Utilities.formatDate(sDate, "GMT+9", "yy.MM.dd") + " ~ " + Utilities.formatDate(eDate, "GMT+9", "yy.MM.dd");
        }
        
        var lastUpdated = "업데이트 전";
        if (studentData[s][17]) {
          lastUpdated = Utilities.formatDate(new Date(studentData[s][17]), "GMT+9", "yy.MM.dd HH:mm");
        }

        // 🔥 N열(13)=시간, O열(14)=지각, P열(15)=조퇴, Q열(16)=외출, R열(17)=업데이트, S열(18)=요청!
        var pendingReq = studentData[s][18] ? String(studentData[s][18]) : ""; 

        return createResponse({
          status: 'success',
          totalPeriodStr: totalPeriodStr,
          totalHours: parseInt(studentData[s][13]) || 0,
          tardyCount: parseInt(studentData[s][14]) || 0,
          earlyCount: parseInt(studentData[s][15]) || 0,
          outCount: parseInt(studentData[s][16]) || 0,
          lastUpdated: lastUpdated,
          pendingRequest: pendingReq // 프론트로 S열 글자 전달
        });
      }
    }
    return createResponse({status: 'error', message: '학생 정보를 찾을 수 없습니다.'});
  } catch(e) {
    return createResponse({status: 'error', message: e.toString()});
  }
}

// ==================== 학생 증빙서류 통합 업로드 (DB 기록용으로 진화!) ====================
function uploadProofDocument(data, ss) {
  try {
    // 🔥 1. 여기에 원장님이 만드신 '사진모음' 구글 드라이브 폴더 ID를 넣으세요!
        // 🔥 1. 여기에 원장님이 만드신 '사진모음' 구글 드라이브 폴더 ID를 넣으세요!
    var PROOF_FOLDER_ID = '1mnbwWVPtLBE0ADMHM3AcPhkgldXFqFqn'; 
    var targetFolder = DriveApp.getFolderById(PROOF_FOLDER_ID); // 무조건 이 폴더로 직행!

    var studentSheet = ss.getSheetByName("학생배치");
    var studentData = studentSheet.getDataRange().getValues();
    var totalStartDate = "-";
    
    // 🔥 2. 학생의 전체훈련시작일(L열=11) 찾고, 서류요청(S열=18) 지워주기
    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) === String(data.kakaoId)) {
        if (studentData[s][11]) {
          totalStartDate = Utilities.formatDate(new Date(studentData[s][11]), "GMT+9", "yyyy-MM-dd");
        }
        // 원장님의 요청(S열) 완수했으므로 빈칸으로 지워줌!
        studentSheet.getRange(s + 1, 19).setValue(""); 
        break;
      }
    }

    // 🔥 3. 사진들을 하나의 Google Doc(원본 보관용)에 몰아넣기
    var docName = data.name + "_" + data.date + "_" + data.requestType + "_원본";
    var doc = DocumentApp.create(docName);
    var body = doc.getBody();
    body.appendParagraph("학생명: " + data.name + " | 날짜: " + data.date + " | 사유: " + data.requestType).setBold(true);
    
        data.images.forEach(function(base64Str) {
      if (base64Str) {
        var blob = Utilities.newBlob(Utilities.base64Decode(base64Str), 'image/jpeg', 'proof.jpg');
        var img = body.appendImage(blob);
        
        // 원본 이미지의 가로, 세로 길이 가져오기
        var origW = img.getWidth();
        var origH = img.getHeight();
        
        // 가로를 450으로 고정하고, 원본 비율에 맞춰 세로 길이를 자동 계산
        var targetW = 450; 
        var targetH = Math.round(origH * (targetW / origW));
        
        // 계산된 비율대로 이미지 크기 세팅
        img.setWidth(targetW).setHeight(targetH);
      }
    });
    doc.saveAndClose();
    
    var file = DriveApp.getFileById(doc.getId());
    file.moveTo(targetFolder); // 폴더로 이동
    var docUrl = file.getUrl();

    // 🔥 4. 증빙서류제출내역 시트에 데이터 차곡차곡 쌓기
    var proofSheet = ss.getSheetByName("증빙서류제출내역");
    if (!proofSheet) {
      proofSheet = ss.insertSheet("증빙서류제출내역");
      proofSheet.appendRow(["제출일시", "학생명", "카카오ID", "전체훈련시작일", "서류종류", "해당날짜", "사진원본링크"]);
    }
    proofSheet.appendRow([new Date(), data.name, data.kakaoId, totalStartDate, data.requestType, data.date, docUrl]);

    // 병가제출내역 시트에도 학생이 내역을 볼 수 있게 똑같이 하나 더 적어주기 (호환성 유지)
    var sickSheet = ss.getSheetByName("병가제출내역");
    if (!sickSheet) {
      sickSheet = ss.insertSheet("병가제출내역");
      sickSheet.appendRow(["제출일시", "학생명", "카카오ID", "병가일자", "문서링크"]);
    }
    sickSheet.appendRow([new Date(), data.name, data.kakaoId, data.date, docUrl]);

    return createResponse({status: 'success'});
  } catch (error) {
    return createResponse({status: 'error', message: error.toString()});
  }
}

// ==================== 제출/발급 내역 조회 (텍스트 디테일 개선) ====================
function handleGetHistory(data, ss) {
  try {
    var sheetName = data.type === 'sick' ? "병가제출내역" : "수강증명서발급내역";
    var historySheet = ss.getSheetByName(sheetName);
    var resultData = [];
    
    if (historySheet) {
      var records = historySheet.getDataRange().getDisplayValues();
      // 최신 기록이 위로 오도록 역순으로 탐색
      for (var i = records.length - 1; i >= 1; i--) {
        if (String(records[i][2]) === String(data.kakaoId)) {
          
          // 1. 윗줄 (진한 글씨): 제출일 / 발급일 텍스트 추가
          var rawDate = records[i][0].substring(0, 16); // 날짜와 시간까지만 자르기
          var dateStr = data.type === 'sick' ? "제출일 : " + rawDate : "발급일 : " + rawDate;
          
          // 2. 아랫줄 (회색 글씨): 내용 텍스트 다듬기
          var targetValue = String(records[i][3]); // 병가: "2026-03-12", 수강증명서: "26.03.01 ~ 05.31"
          
          // 병가 날짜가 "2026-03-12" 처럼 길면 앞에 "20" 떼고 "26-03-12"로 예쁘게 만들기
          if (data.type === 'sick' && targetValue.startsWith("20") && targetValue.length === 10) {
            targetValue = targetValue.substring(2);
          }
          
          var desc = data.type === 'sick' ? targetValue + " 병가서류" : targetValue + " 수강증명서";
          var link = records[i][4]; // 문서 링크
          
          resultData.push({ date: dateStr, desc: desc, link: link });
        }
      }
    }
    return createResponse({ status: 'success', data: resultData });
  } catch (e) {
    return createResponse({ status: 'error', message: e.toString() });
  }
}

// ==================== 수강증명서 PDF 자동 발급 로직 ====================
function handleGenerateCertificate(data, ss) {
  try {
    // 🔥 1. 여기에 선생님의 수강증명서 구글 문서 템플릿 ID와 폴더 ID를 넣어주세요! 🔥
    var CERT_TEMPLATE_ID = '12_IAXnELoYksXwWDPeE3N2tde5XjjD_jL5zezTrbQa0';
    var CERT_FOLDER_ID = '1nX2VfF5kmJW4gdQczQ7seMyKjQ4AT7Ph';
    
    var studentSheet = ss.getSheetByName("학생배치");
    var recordSheet = ss.getSheetByName("출석기록");
    var certSheet = ss.getSheetByName("수강증명서발급내역");
    
    // 시트 없으면 생성
    if (!certSheet) {
      certSheet = ss.insertSheet("수강증명서발급내역");
      certSheet.appendRow(["발급일시", "학생명", "카카오ID", "신청기간", "PDF링크"]);
    }

    // 🔥 2. 학생 이름 및 전체 훈련 기간 가져오기 (학생배치 시트 A, L, M열)
    var studentData = studentSheet.getDataRange().getValues();
    var realName = data.name; 
    var totalStartDate = "";
    var totalEndDate = "";
    
    for (var s = 1; s < studentData.length; s++) {
      if (String(studentData[s][1]) === String(data.kakaoId)) {
        realName = studentData[s][0]; // A열(0): 진짜 이름
        if (studentData[s][11]) totalStartDate = Utilities.formatDate(new Date(studentData[s][11]), "GMT+9", "yyyy년 MM월 dd일"); // L열(11)
        if (studentData[s][12]) totalEndDate = Utilities.formatDate(new Date(studentData[s][12]), "GMT+9", "yyyy년 MM월 dd일");   // M열(12)
        break;
      }
    }

        // 🔥 3. 날짜 및 시간 계산 (문서번호, 신청년월일 등)
    var now = new Date();
    var reqYear = Utilities.formatDate(now, "GMT+9", "yyyy");
    var reqMonth = Utilities.formatDate(now, "GMT+9", "MM");
    var reqDay = Utilities.formatDate(now, "GMT+9", "dd");
    var reqTime = Utilities.formatDate(now, "GMT+9", "HHmm");
    
    var docNumber = "사하제일-" + reqYear + "-" + reqMonth + "-" + reqDay + "-" + reqTime;
    
    var reqStartObj = new Date(data.startDate);
    var reqEndObj = new Date(data.endDate);
    
    // PDF 문서 안에 찍힐 공식 포맷 (예: 2026년 03월 01일 ~ 2026년 05월 31일)
    var formalPeriodStr = Utilities.formatDate(reqStartObj, "GMT+9", "yyyy년 MM월 dd일") + " ~ " + Utilities.formatDate(reqEndObj, "GMT+9", "yyyy년 MM월 dd일");
    
    // 폰 화면 기록에 보여줄 예쁘고 짧은 포맷 (예: 26.03.01 ~ 05.31)
    var historyPeriodStr = Utilities.formatDate(reqStartObj, "GMT+9", "yy.MM.dd") + " ~ " + Utilities.formatDate(reqEndObj, "GMT+9", "MM.dd");

        // 🔥 4. 참여일수 및 참여시간 계산 (흩어진 두 줄 짝맞추기 + 평일/공휴일/4시간컷 적용)
    var records = recordSheet.getDataRange().getDisplayValues();
    var participatedDays = 0;
    var participatedHours = 0;
    
    // 4-1. 해당 학생의 흩어진 출퇴근 기록을 날짜별로 짝맞춰 바구니에 담기
    var myDailyRecords = {};
    for (var r = 1; r < records.length; r++) {
      if (String(records[r][3]) === String(data.kakaoId)) {
        var rowDateStr = records[r][0];
        if (!rowDateStr || rowDateStr === "") continue;
        
        var cleanDate = (rowDateStr instanceof Date) ? Utilities.formatDate(rowDateStr, "GMT+9", "yyyy-MM-dd") : String(rowDateStr).substring(0, 10);
        
        if (!myDailyRecords[cleanDate]) {
          myDailyRecords[cleanDate] = { inStr: "-", outStr: "-" };
        }
        
        if (records[r][5] && records[r][5] !== "") myDailyRecords[cleanDate].inStr = String(records[r][5]);
        if (records[r][8] && records[r][8] !== "") myDailyRecords[cleanDate].outStr = String(records[r][8]);
      }
    }

    // 4-2. 날짜별로 묶인 완벽한 바구니를 하나씩 꺼내서 조건 검사하기
    reqStartObj.setHours(0, 0, 0, 0);
    reqEndObj.setHours(23, 59, 59, 999);

    for (var dateKey in myDailyRecords) {
      var rec = myDailyRecords[dateKey];
      var dateObj = new Date(dateKey);
      dateObj.setHours(12, 0, 0, 0); // 시간차이로 전날로 인식되는 버그 방지
      
      // 조건 1: 신청한 기간 내에 있는지?
      if (dateObj >= reqStartObj && dateObj <= reqEndObj) {
        
        // 조건 2: 평일(월=1 ~ 금=5)인지?
        var dayOfWeek = dateObj.getDay();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          
          // 조건 3: 한국 공휴일 자동 패스! (새로 만든 함수 적용)
if (!isKoreanHoliday(dateObj)) {
            
            // 조건 4: 출근과 퇴근이 모두 적혀 있는지?
            if (rec.inStr !== "-" && rec.outStr !== "-") {
              var logic = calculateTimeLogic(rec.inStr, rec.outStr);
              
              // 조건 5: 4시간 미만(결석)이 아닐 때만 인정!
              if (!logic.isAbsent) {
                participatedDays++;
                participatedHours += logic.hours;
              }
            }
          }
        }
      }
    }

    // 🔥 5. 구글 문서 복사 및 치환 태그 입력
        // 🔥 5. 구글 문서 복사 및 치환 태그 입력
    var templateFile = DriveApp.getFileById(CERT_TEMPLATE_ID);
    var targetFolder = DriveApp.getFolderById(CERT_FOLDER_ID); // 무조건 수강증명서 폴더로 직행!
    
    // 임시 문서(Google Doc) 생성
    var tempFile = templateFile.makeCopy("임시수강증명서_" + realName, targetFolder);
    var doc = DocumentApp.openById(tempFile.getId());
    var body = doc.getBody();

    body.replaceText("{{문서번호}}", docNumber);
    body.replaceText("{{이름}}", realName);
    body.replaceText("{{주민등록번호}}", data.rrn);
    body.replaceText("{{전체훈련시작일}}", totalStartDate);
    body.replaceText("{{전체훈련종료일}}", totalEndDate);
    body.replaceText("{{신청기간}}", formalPeriodStr); // PDF에는 길고 격식있게!
    body.replaceText("{{참여일수}}", participatedDays.toString());
    body.replaceText("{{참여시간}}", participatedHours.toString());
    body.replaceText("{{신청년}}", reqYear);
    body.replaceText("{{신청월}}", reqMonth);
    body.replaceText("{{신청일}}", reqDay);
    
    doc.saveAndClose();

    // 🔥 6. PDF로 변환 및 임시 문서 삭제
    var pdfBlob = tempFile.getAs('application/pdf');
    var finalPdfName = reqYear.substring(2) + "." + parseInt(reqMonth) + "." + parseInt(reqDay) + realName + "수강증명서";
    
    var pdfFile = targetFolder.createFile(pdfBlob).setName(finalPdfName);
    var pdfUrl = pdfFile.getUrl();

    // 변환 끝났으므로 임시로 만든 Google Doc은 휴지통으로 버림(깔끔한 파일 관리)
    tempFile.setTrashed(true);

    // 🔥 7. 발급 내역에 저장 (기록용 시트와 폰 화면에는 짧고 예쁘게!)
    certSheet.appendRow([new Date(), realName, data.kakaoId, historyPeriodStr, pdfUrl]);

    return createResponse({ status: 'success', docUrl: pdfUrl });

  } catch (error) {
    return createResponse({ status: 'error', message: error.toString() });
  }
}

// ==================== [수정됨] 전체 통계 새벽 3시 일괄 동기화 (초고속 버전) ====================
function syncAllStudentStats() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var studentSheet = ss.getSheetByName("학생배치");
  var recordSheet = ss.getSheetByName("출석기록");
  
  if (!studentSheet || !recordSheet) return;
  
  var studentData = studentSheet.getDataRange().getValues();
  var records = recordSheet.getDataRange().getValues(); // 👈 getDisplayValues 대신 getValues 써서 데이터 로딩 속도 10배 향상
  
  var dailyRecords = {}; 
  
  for (var r = 1; r < records.length; r++) {
    var dateStr = records[r][0]; 
    var kakaoId = String(records[r][3]); 
    
    if (!kakaoId || kakaoId === "undefined" || kakaoId === "") continue;
    if (!dateStr || dateStr === "") continue;
    
    var cleanDate = (dateStr instanceof Date) ? Utilities.formatDate(dateStr, "GMT+9", "yyyy-MM-dd") : String(dateStr).substring(0, 10);
    var key = kakaoId + "_" + cleanDate;
    
    if (!dailyRecords[key]) {
      dailyRecords[key] = { kakaoId: kakaoId, inStr: "-", outStr: "-" };
    }
    
    // 시간 데이터 안전하게 문자열로 변환
        // 시간 데이터 안전하게 문자열로 변환
    var inVal = records[r][5];
    var outVal = records[r][8];
    if (inVal instanceof Date) inVal = ('0' + inVal.getHours()).slice(-2) + ':' + ('0' + inVal.getMinutes()).slice(-2);
    if (outVal instanceof Date) outVal = ('0' + outVal.getHours()).slice(-2) + ':' + ('0' + outVal.getMinutes()).slice(-2);
    
    if (inVal && inVal !== "") dailyRecords[key].inStr = String(inVal);
    if (outVal && outVal !== "") dailyRecords[key].outStr = String(outVal);
  }
  
  var statsMap = {}; 
  
  // U열(권한) 확실히 체크하기
  var studentMeta = {};
  for(var s=1; s<studentData.length; s++) {
      var sId = String(studentData[s][1]);
      if(sId) {
          var isJabiUser = false;
          // U열이 20번째 칸이므로, 해당 칸에 글자가 있는지 확실하게 검사
          if (studentData[s].length > 20 && studentData[s][20]) {
              isJabiUser = (String(studentData[s][20]).trim() === "자비");
          }
          studentMeta[sId] = {
              shiftType: studentData[s][19] ? String(studentData[s][19]).trim() : "주간",
              isJabi: isJabiUser 
          };
      }
  }

  // 바구니들 꺼내서 통계 계산
  for (var key in dailyRecords) {
    var rec = dailyRecords[key];
    var kId = rec.kakaoId;
    var dateStr = key.split("_")[1];
    var dateObj = new Date(dateStr); 
    
    if (!statsMap[kId]) statsMap[kId] = { hours: 0, tardy: 0, early: 0 };
    
    if (rec.inStr !== "-" && rec.outStr !== "-") {
      var meta = studentMeta[kId] || { shiftType: "주간", isJabi: false };
      var logic = calculateTimeLogic(rec.inStr, rec.outStr, meta.shiftType, dateObj, meta.isJabi);
      
      statsMap[kId].hours += logic.hours;
      if (logic.isTardy) statsMap[kId].tardy++;
      if (logic.isEarlyLeave) statsMap[kId].early++;
    }
  }
  
  // 일괄 덮어쓰기
  var numRows = studentData.length - 1;
  if (numRows <= 0) return; 
  
  var targetRange = studentSheet.getRange(2, 14, numRows, 5); 
  var targetValues = targetRange.getValues(); 
  var nowTime = new Date();
  
  for (var s = 1; s < studentData.length; s++) {
     var kId = String(studentData[s][1]);
     if (statsMap[kId]) {
        targetValues[s - 1][0] = statsMap[kId].hours;
        targetValues[s - 1][1] = statsMap[kId].tardy;
        targetValues[s - 1][2] = statsMap[kId].early;
        targetValues[s - 1][4] = nowTime; 
     }
  }
  targetRange.setValues(targetValues); // 수정 완료 후 시트에 1초만에 일괄 저장!
}

function isKoreanHoliday(dateObj) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var holidaySheet = ss.getSheetByName("공휴일캐시");
  if (!holidaySheet) {
    refreshHolidayCache();
    holidaySheet = ss.getSheetByName("공휴일캐시");
  }
  var data = holidaySheet.getRange("A2:A500").getValues();
  var targetStr = Utilities.formatDate(dateObj, "GMT+9", "yyyy-MM-dd");
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === targetStr) return true;
  }
  return false;
}

// 공휴일 시트 갱신 (연 1회 트리거)
function refreshHolidayCache() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var holidaySheet = ss.getSheetByName("공휴일캐시");
  if (!holidaySheet) {
    holidaySheet = ss.insertSheet("공휴일캐시");
    holidaySheet.appendRow(["날짜(yyyy-MM-dd)", "공휴일명"]);
  }
  var lastRow = holidaySheet.getLastRow();
  if (lastRow > 1) holidaySheet.getRange(2, 1, lastRow - 1, 2).clearContent();
  
  var calendar = CalendarApp.getCalendarById('ko.south_korea#holiday@group.v.calendar.google.com');
  if (calendar) {
    var nowYear = new Date().getFullYear();
    var events = calendar.getEvents(new Date(nowYear - 1, 0, 1), new Date(nowYear + 2, 11, 31));
    var rows = [];
    for (var i = 0; i < events.length; i++) {
      rows.push([Utilities.formatDate(events[i].getStartTime(), "GMT+9", "yyyy-MM-dd"), events[i].getTitle()]);
    }
    if (rows.length > 0) holidaySheet.getRange(2, 1, rows.length, 2).setValues(rows);
  }
}

// ==================== 🔥 원장님 전용 기능 🔥 ====================
// ==================== 🔥 원장님 전용 기능 🔥 ====================
function getStudentList(studentSheet) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = studentSheet.getDataRange().getValues();
    var list = [];
    
    // 학생 명단 가져오기
    for(var i=1; i<data.length; i++) {
      if(data[i][1] && data[i][20] !== "원장님") { // 카카오ID가 있고 원장님이 아닌 일반 학생만
        list.push({name: data[i][0], kakaoId: data[i][1]});
      }
    }
    
    // 병원 목록 가져오기 (새로 추가된 부분)
    var hospitalSheet = ss.getSheetByName("병원목록");
    var hospitals = [];
    if(hospitalSheet) {
      var hData = hospitalSheet.getDataRange().getValues();
      for(var j=1; j<hData.length; j++) {
        if(hData[j][0] && hData[j][0] !== "") {
          hospitals.push({name: hData[j][0], lat: hData[j][1], lon: hData[j][2]});
        }
      }
    }
    
    return createResponse({status: 'success', students: list, hospitals: hospitals});
  } catch(e) { 
    return createResponse({status: 'error', message: e.toString()}); 
  }
}

function sendDocumentRequest(data, studentSheet) {
  try {
    var sData = studentSheet.getDataRange().getValues();
    for(var i=1; i<sData.length; i++) {
      if(String(sData[i][1]) === String(data.targetKakaoId)) {
        // 🔥 선택한 학생의 S열(19번째 칸)에 서류 이름을 강제로 적어버림!
        studentSheet.getRange(i+1, 19).setValue(data.docType); 
        return createResponse({status: 'success'});
      }
    }
    return createResponse({status: 'error', message: '학생을 찾을 수 없습니다.'});
  } catch(e) { return createResponse({status: 'error', message: e.toString()}); }
}

function updateStudentHospital(data, studentSheet) {
  try {
    var sData = studentSheet.getDataRange().getValues();
    for(var i=1; i<sData.length; i++) {
      if(String(sData[i][1]) === String(data.targetKakaoId)) {
        // D열(4): 병원명, E열(5): 위도, F열(6): 경도 덮어쓰기
        studentSheet.getRange(i+1, 4).setValue(data.hospitalName);
        studentSheet.getRange(i+1, 5).setValue(data.hospitalLat);
        studentSheet.getRange(i+1, 6).setValue(data.hospitalLon);
        
        return createResponse({status: 'success'});
      }
    }
    return createResponse({status: 'error', message: '학생을 찾을 수 없습니다.'});
  } catch(e) { 
    return createResponse({status: 'error', message: e.toString()}); 
  }
}

// ==================== 트리거 등록 (1회만 실행!) ====================
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncAllStudentStats').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('refreshHolidayCache').timeBased().everyDays(1).atHour(2).create();
  Logger.log("트리거 등록 완료!");
}