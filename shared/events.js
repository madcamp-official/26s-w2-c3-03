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

const EVENTS = {
  // ══════════════════════════════════════════════
  // 룸 생성 & 코드 발급
  // ══════════════════════════════════════════════

  ROOM_CREATE: 'room:create',
  // payload: { title: string }  // 제목 입력 필수

  ROOM_CREATED: 'room:created',
  // payload: { roomId: string, title: string, displayCode: string, audienceCode: string, presenterCode: string }

  ROOM_JOIN_PRESENTER: 'room:join_presenter',
  // payload: { roomId: string, presenterCode: string, name: string }

  ROOM_JOIN_DISPLAY: 'room:join_display',
  // payload: { displayCode: string }

  // 청중 웹 → 서버: 입장. name은 기명 모드에서만 사용, 익명 모드면 서버가 자동 생성
  ROOM_JOIN_AUDIENCE: 'room:join_audience',
  // payload: { audienceCode: string, name?: string }

  ROOM_JOINED: 'room:joined',
  // payload: {
  //   roomId: string,
  //   role: 'presenter' | 'display' | 'audience',
  //   userId: string,
  //   nickname: string | null,
  //   currentFileUrl: string | null
  // }

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
  // payload: { newPresenterId: string }


  // ══════════════════════════════════════════════
  // 파일 업로드 & 대본 & AI 노트
  // ══════════════════════════════════════════════

  FILE_READY: 'file:ready',
  // payload: { fileId: string, slideCount: number }

  NOTES_READY: 'notes:ready',
  // payload: {
  //   slideNotes: Array<{ slideIndex: number, text: string }>,
  //   source: 'auto_split' | 'ai_summarize' | 'ai_generate' | 'manual'
  // }


  NOTE_SAVED: 'note:saved',
  // payload: { slideIndex: number, editedByName: string }

  NOTES_READY: 'notes:ready',
  // payload: {
  //   slideNotes: Array<{ slideIndex: number, text: string }>,
  //   source: 'auto_split' | 'ai_summarize' | 'ai_generate' | 'manual'
  // }

  NOTE_SAVED: 'note:saved',
  // payload: { slideIndex: number, editedByName: string }


  // ══════════════════════════════════════════════
  // 질문 시스템
  // ══════════════════════════════════════════════

  QUESTION_SUBMIT: 'question:submit',
  // payload: { text: string, category: 'during' | 'after' }

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