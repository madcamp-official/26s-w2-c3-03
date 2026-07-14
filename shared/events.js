// shared/events.js
// Kit 프로젝트 전체(mobile, web, server)가 공통으로 참조하는 Socket.io 이벤트 이름 + payload 스펙
//
// 접속 주체 정리:
// - 발표자(여러 명 가능): 모바일 앱으로만 입장. presenterCode로만 입장 가능
// - PC(데스크톱): 딱 1대, 웹(/display)으로 displayCode 입력해서 슬라이드 보여주기 전용
// - 청중: 웹(/audience)으로 audienceCode 입력해서 입장, 질문 등록 + 발표자료 독립 열람
//
// ※ 인원수(발표자/청중)는 PC·청중웹에는 노출 안 함. 발표자 앱에서만 확인 가능
// ※ "방장" 개념 없음 — 방 생성자가 최초 currentPresenter가 되고, 설정변경/발표시작 등의
//   권한은 전부 "현재 currentPresenterId인가"로 통일해서 검증. 발표자 교체는 발표 시작 이후
//   (리모컨 화면)에서만 발생하므로, 설정 변경 시점(대기화면)엔 항상 방 생성자 = 현재 발표자
// ※ 노트 저장/AI 처리는 실시간성이 없어 REST API로 처리 (하단 별도 명시)
// ※ [신규] 아래 두 REST GET API는 소켓 이벤트를 놓쳤을 때(재연결, 늦은 입장 등) 상태를
//   다시 조회하기 위한 용도. 소켓 이벤트가 아니라 서버 index.js에 직접 구현되어 있음.
//   - GET /rooms/:roomId        → 방 현재 상태(진행 상태, 현재 발표자, 설정값, 현재 슬라이드 등)
//   - GET /rooms/:roomId/slides → 슬라이드별 원본 대본 + AI 노트 목록 (미리보기 화면용)

const EVENTS = {
  // ══════════════════════════════════════════════
  // 룸 생성 & 코드 발급
  // ══════════════════════════════════════════════

  // ※ [신규] 4개 이벤트 모두 payload에 optional userId를 추가함.
  //   클라이언트(모바일 앱/웹)는 최초 접속 시 userId를 로컬에 저장해두고(기기 UUID 등),
  //   재연결할 때마다 같은 값을 실어보내야 한다. 서버는 이 값이 있으면 그대로 신원으로 인정하고
  //   socket_id만 최신으로 갱신한다 — 없으면(첫 실행) 서버가 새로 발급해서 응답으로 돌려준다.
  //   이렇게 해야 소켓이 끊겼다 재연결돼도 발표 제어권(current_presenter_id 등)을 잃지 않는다.

  ROOM_CREATE: 'room:create',
  // payload: { title: string, name?: string, userId?: string, token?: string }  // 제목 입력 필수
  // ※ [신규] token(로그인 JWT)이 유효하면 서버가 userId 대신 accountId를 신원으로 사용하고
  //   rooms.owner_account_id를 채워서 이후 "이전 발표 기록" 조회에 쓸 수 있게 한다.
  //   token이 없거나 무효하면(비로그인) 기존처럼 userId(로컬 익명 ID)를 그대로 쓴다.

  ROOM_CREATED: 'room:created',
  // payload: { roomId: string, title: string, displayCode: string, audienceCode: string, presenterCode: string, userId: string }

  ROOM_JOIN_PRESENTER: 'room:join_presenter',
  // payload: { roomId: string, presenterCode: string, name: string, userId?: string }
  // ※ role은 서버가 (전달된) userId === room.host_user_id 여부로 판단해서 'host' | 'presenter'로 응답한다.

  ROOM_JOIN_DISPLAY: 'room:join_display',
  // payload: { displayCode: string, userId?: string }

  // 청중 웹 → 서버: 입장. name은 기명 모드에서만 사용, 익명 모드면 서버가 자동 생성
  ROOM_JOIN_AUDIENCE: 'room:join_audience',
  // payload: { audienceCode: string, name?: string, userId?: string }

  ROOM_JOINED: 'room:joined',
  // payload: {
  //   roomId: string,
  //   role: 'host' | 'presenter' | 'display' | 'audience',
  //   userId: string,
  //   nickname: string | null,
  //   currentFileUrl: string | null
  // }
  // ※ 클라이언트는 여기서 받은 userId를 로컬에 저장해서 다음 재연결에 그대로 재사용해야 함.

  // 서버 → 모든 발표자 앱: 발표자 목록 (배열 길이 = 발표자 인원수)
  PRESENTER_LIST_UPDATE: 'presenter:list_update',
  // payload: { presenters: Array<{ userId: string, name: string, isCurrentPresenter: boolean }> }

  AUDIENCE_COUNT_UPDATE: 'room:audience_count',
  // payload: { count: number }

  ROOM_LEAVE: 'room:leave',
  // payload: {}


  // ══════════════════════════════════════════════
  // 발표 환경설정 & 시작/종료
  // ══════════════════════════════════════════════

  // 현재 발표자 앱 → 서버: 발표 시작 전 설정 변경 (실시간 미리보기 공유용)
  // ※ 권한: 보낸 사람 == 현재 currentPresenterId
  ROOM_SETTINGS_UPDATE: 'room:settings_update',
  // payload: { durationMinutes?: number, allowMidQuestions?: boolean, anonymous?: boolean }

  ROOM_SETTINGS_UPDATED: 'room:settings_updated',
  // payload: { durationMinutes: number, allowMidQuestions: boolean, anonymous: boolean }

  // 현재 발표자 앱 → 서버: 발표 시작 (최종 확정값, DB에 고정됨)
  PRESENTATION_START: 'presentation:start',
  // payload: { durationMinutes: number, allowMidQuestions: boolean, anonymous: boolean }

  PRESENTATION_STARTED: 'presentation:started',
  // payload: {
  //   startedAt: number, durationMinutes: number, allowMidQuestions: boolean,
  //   anonymous: boolean, currentFileUrl: string
  // }

  PRESENTATION_END: 'presentation:end',
  // payload: {}

  PRESENTATION_ENDED: 'presentation:ended',
  // payload: { totalElapsedSeconds: number, presenterCount: number, audienceCount: number }


  // ══════════════════════════════════════════════
  // 슬라이드 제어
  // ══════════════════════════════════════════════

  SLIDE_NEXT: 'slide:next',
  SLIDE_PREV: 'slide:prev',
  // payload: {} (둘 다) — 서버는 보낸 사람이 currentPresenterId인지 검증

  SLIDE_CHANGED: 'slide:changed',
  // payload: { slideIndex: number }
  // ※ 청중웹 수신 대상 아님 (독립 열람)


  // ══════════════════════════════════════════════
  // 타이머
  // ══════════════════════════════════════════════

  TIMER_UPDATE: 'timer:update',
  // payload: { elapsedSeconds: number, durationSeconds: number, isOvertime: boolean }


  // ══════════════════════════════════════════════
  // 발표자 교체
  // ══════════════════════════════════════════════

  PRESENTER_TRANSFER: 'presenter:transfer',
  // payload: { targetUserId: string }

  PRESENTER_CHANGED: 'presenter:changed',
  // payload: { newPresenterId: string, fileUrl: string }


  // ══════════════════════════════════════════════
  // 파일 업로드 & 대본 & AI 노트
  // ══════════════════════════════════════════════

  FILE_READY: 'file:ready',
  // payload: { fileId: string, ownerId: string, slideCount: number, fileUrl: string }
  // ※ [수정] fileUrl 추가. 업로드 이전부터 방에 있던 다른 발표자는 이 이벤트 전까지
  //   파일 URL을 받을 방법이 없었기 때문(그전엔 slideCount만 왔음).

  NOTES_READY: 'notes:ready',
  // payload: {
  //   slideNotes: Array<{ slideIndex: number, text: string, imageUrl: string | null }>,
  //   source: 'auto_split' | 'ai_summarize' | 'ai_generate' | 'manual'
  // }
  // ※ [수정] imageUrl 추가. 노트 수정 화면이 이 이벤트만으로 텍스트+슬라이드 이미지를
  //   같이 그릴 수 있도록(별도로 GET /rooms/:roomId/slides를 다시 호출할 필요 없게) 함.

  NOTE_SAVED: 'note:saved',
  // payload: { slideIndex: number, editedByName: string, newNote: string, imageUrl: string | null }
  // ※ [수정] newNote/imageUrl 추가. 다른 발표자 화면이 이 이벤트만으로 수정된 노트 내용과
  //   해당 슬라이드 이미지를 그대로 반영할 수 있게 함.


  // ══════════════════════════════════════════════
  // 질문 시스템
  // ══════════════════════════════════════════════

  QUESTION_SUBMIT: 'question:submit',
  // payload: { text: string }
  // ※ [수정] category는 더 이상 클라이언트가 정하지 않음. 클라이언트를 신뢰하면
  //   항상 같은 값(예: 'during')만 보내는 등 신뢰할 수 없어서, 서버가 room.status로
  //   'during'(진행중) | 'after'(종료 후)를 직접 판단해 저장한다.

  QUESTION_NEW: 'question:new',
  // payload: { questionId: string, text: string, nickname: string, category: 'during' | 'after', createdAt: number }

  // [신규] 답변할 발표자 앱 → 서버: "답변하기" 버튼 클릭 (아무도 답변 중이 아닐 때만 성공)
  // ※ 질문 "선택"(강조 표시)은 순수 로컬 UI 상태라 서버 이벤트 없음. 이 이벤트부터가 서버 동기화 시작점
  QUESTION_ANSWERING_START: 'question:answering_start',
  // payload: { questionId: string }
  // ※ 서버는 현재 answeringPresenterId가 null인지 검증. 이미 다른 사람이 답변 중이면 에러 응답

  // [신규] 서버 → 모든 발표자 앱 + PC웹 + 청중웹: 답변 시작 브로드캐스트
  QUESTION_ANSWERING_STARTED: 'question:answering_started',
  // payload: {
  //   questionId: string, text: string, nickname: string,
  //   answeringPresenterId: string, answeringPresenterName: string
  // }
  // ※ PC웹/청중웹: 이 질문을 목록 최상단에 고정 표시
  // ※ 답변 중이 아닌 다른 발표자 앱: "답변하기" 버튼 비활성화 (질문 선택 자체는 계속 가능)
  // ※ 답변 중인 본인 앱: 버튼이 "답변 종료하기"로 전환

  // [신규] 답변 중인 발표자 앱 → 서버: "답변 종료하기" 버튼 클릭
  QUESTION_ANSWERING_END: 'question:answering_end',
  // payload: {}
  // ※ 서버는 보낸 사람이 현재 answeringPresenterId인지 검증

  // 서버 → 모든 발표자 앱 + PC웹 + 청중웹: 답변 종료 → 답변완료 리스트 갱신 (최신순)
  // ※ 이 이벤트 수신 시 answeringPresenterId는 서버에서 null로 리셋되고,
  //   모든 발표자 앱의 "답변하기" 버튼이 다시 활성화됨
  ANSWERED_QUESTIONS_UPDATE: 'question:answered_list_update',
  // payload: { answered: Array<{ questionId: string, text: string, nickname: string, answeredAt: number }> }
};

module.exports = { EVENTS };