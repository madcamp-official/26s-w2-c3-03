// shared/events.js
// Kit 프로젝트 전체(mobile, web, server)가 공통으로 참조하는 Socket.io 이벤트 이름 + payload 스펙
// 이벤트 이름 오타로 인한 프론트-백엔드 불일치를 막기 위해, 실제 문자열은 여기서만 관리합니다.
//
// 접속 주체 정리:
// - 발표자(여러 명 가능): 모바일 앱으로만 입장. presenterCode로만 입장 가능(청중 코드와 분리).
//   슬라이드 제어 권한은 그중 1명(현재 발표자)만 보유
// - PC(데스크톱): 딱 1대, 웹(/display)으로 displayCode 입력해서 슬라이드 보여주기 전용
// - 청중: 웹(/audience)으로 audienceCode 입력해서 입장, 질문 등록 + 발표자료 독립 열람(비동기, 슬라이드 동기화 안 됨)

const EVENTS = {
  // ══════════════════════════════════════════════
  // 룸 생성 & 코드 발급
  // ══════════════════════════════════════════════

  ROOM_CREATE: 'room:create',
  // payload: {} (없음)

  ROOM_CREATED: 'room:created',
  // payload: {
  //   roomId: string,
  //   displayCode: string,
  //   audienceCode: string,
  //   presenterCode: string
  // }

  ROOM_JOIN_PRESENTER: 'room:join_presenter',
  // payload: { roomId: string, presenterCode: string, name: string }

  ROOM_JOIN_DISPLAY: 'room:join_display',
  // payload: { displayCode: string }

  ROOM_JOIN_AUDIENCE: 'room:join_audience',
  // payload: { audienceCode: string, nickname: string }

  ROOM_JOINED: 'room:joined',
  // payload: {
  //   roomId: string,
  //   role: 'presenter' | 'display' | 'audience',
  //   userId: string,
  //   currentFileUrl: string | null   // [추가] 늦게 입장해도 현재 발표 파일 바로 알 수 있도록
  // }
  // ※ currentFileUrl 추가 — 청중/PC가 입장 시점에 이미 발표가 시작돼있다면
  //   그 즉시 현재 파일을 알아야 자료 열람이 가능하므로 입장 응답에 포함

  PRESENTER_LIST_UPDATE: 'presenter:list_update',
  // payload: {
  //   presenters: Array<{ userId: string, name: string, isCurrentPresenter: boolean }>
  // }

  AUDIENCE_COUNT_UPDATE: 'room:audience_count',
  // payload: { count: number }

  ROOM_LEAVE: 'room:leave',
  // payload: {}


  // ══════════════════════════════════════════════
  // 발표 환경설정 & 시작/종료
  // ══════════════════════════════════════════════
  
  ROOM_SETTINGS_UPDATE: 'room:settings_update', // [추가] 앱 -> 서버: 발표 시작 전 설정 수시 변경 (익명/기명, 질문타이밍, 시간)
  ROOM_SETTINGS_UPDATED: 'room:settings_updated', // [추가] 서버 -> 전체: 변경된 설정 브로드캐스트

  // 현재 발표자 앱 → 서버: 발표 시작 (환경설정값 포함 — 별도 설정 이벤트 없이 시작 시점에 한번에 전송)
  PRESENTATION_START: 'presentation:start',
  // payload: {
  //   durationMinutes: number,              // 분단위 스크롤로 선택한 발표 시간
  //   allowMidQuestions: boolean,            // 발표 중간 질문 허용 여부
  //   questionIdentityMode: 'anonymous' | 'named'  // 질문자 익명/기명
  // }
  // ※ 서버는 반드시 "보낸 사람 == 현재 currentPresenterId"인지 검증 후 처리

  PRESENTATION_STARTED: 'presentation:started',
  // payload: {
  //   startedAt: number(timestamp),
  //   durationMinutes: number,
  //   allowMidQuestions: boolean,
  //   questionIdentityMode: 'anonymous' | 'named',
  //   currentFileUrl: string
  // }
  // ※ PC웹, 청중웹, 모든 발표자 앱에 브로드캐스트.
  //   청중웹은 이 시점에 currentFileUrl 받아서 자기 폰에 독립 뷰어 띄움

  PRESENTATION_END: 'presentation:end',
  // payload: {}

  PRESENTATION_ENDED: 'presentation:ended',
  // payload: { totalElapsedSeconds: number }


  // ══════════════════════════════════════════════
  // 슬라이드 제어
  // ══════════════════════════════════════════════

  SLIDE_NEXT: 'slide:next',
  // payload: {}
  SLIDE_PREV: 'slide:prev',
  // payload: {}
  // ※ 서버는 보낸 사람이 현재 currentPresenterId인지 검증 후 처리

  // [수정] 서버 → PC웹, 모든 발표자 앱: 슬라이드 변경 브로드캐스트
  SLIDE_CHANGED: 'slide:changed',
  // payload: { slideIndex: number }
  // ※ 청중웹은 수신 대상에서 제외 — 청중은 발표자와 별개로 자기 페이스로
  //   자료를 넘겨보므로 슬라이드 동기화가 오히려 불필요/혼란을 줄 수 있음


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

  // 서버 → 전체(PC웹+모든 발표자 앱+청중웹): 발표자 변경 브로드캐스트
  PRESENTER_CHANGED: 'presenter:changed',
  // payload: { newPresenterId: string, fileUrl: string }
  // ※ 청중웹도 이 이벤트로 fileUrl 갱신 받아서, 새 발표자 자료로 독립 뷰어 전환


  // ══════════════════════════════════════════════
  // 파일 업로드 & AI 노트 시스템
  // ══════════════════════════════════════════════

  FILE_READY: 'file:ready',
  // payload: { fileId: string, ownerId: string, slideCount: number }
  SCRIPT_READY: 'script:ready',               // [추가] 앱 -> 서버: 대본 파일(또는 텍스트) 업로드 완료

  AI_GENERATE_REQUEST: 'ai:generate_request', // [추가] 앱 -> 서버: AI 요약 버튼 클릭 (대본 유무 상태 포함)
  AI_GENERATE_COMPLETE: 'ai:generate_complete', // [추가] 서버 -> 앱: AI 요약 완료 (슬라이드별 노트 배열 반환)
  
  SLIDE_NOTE_UPDATE: 'slide:note_update',     // [추가] 앱 -> 서버: 발표자가 슬라이드 노트를 직접 수동으로 수정함


  // ══════════════════════════════════════════════
  // 질문 시스템
  // ══════════════════════════════════════════════

  QUESTION_SUBMIT: 'question:submit',
  // payload: {
  //   text: string,
  //   visibility: 'public' | 'private',
  //   isAnonymous: boolean,
  //   nickname: string | null,
  //   category: 'during' | 'after'
  // }

  QUESTION_NEW: 'question:new',
  // payload: {
  //   questionId: string,
  //   text: string,
  //   visibility: 'public' | 'private',
  //   isAnonymous: boolean,
  //   nickname: string | null,
  //   category: 'during' | 'after',
  //   createdAt: number
  // }

  QUESTION_ANSWER_SELECT: 'question:answer_select',
  // payload: { questionId: string }

  QUESTION_ANSWERED: 'question:answered',
  // payload: { questionId: string, text: string }
  // ※ PC웹 + 청중웹 둘 다 수신
};

module.exports = { EVENTS };