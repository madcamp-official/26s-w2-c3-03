// shared/events.js
// Kit 프로젝트 전체(mobile, web, server)가 공통으로 참조하는 Socket.io 이벤트 이름 + payload 스펙
//
// 접속 주체 정리:
// - 발표자(여러 명 가능): 모바일 앱으로만 입장. presenterCode로만 입장 가능
// - PC(데스크톱): 딱 1대, 웹(/display)으로 displayCode 입력해서 슬라이드 보여주기 전용
// - 청중: 웹(/audience)으로 audienceCode 입력해서 입장, 질문 등록 + 발표자료 독립 열람
//
// ※ 인원수(발표자/청중)는 PC·청중웹에는 노출 안 함. 발표자 앱에서만 확인 가능
// ※ 발표자 수는 별도 이벤트 없이 PRESENTER_LIST_UPDATE의 presenters.length로 파생
// ※ "방장" 개념 없음 — 방 생성자가 최초 currentPresenter가 되고, 설정변경/발표시작 등의
//   권한은 전부 "현재 currentPresenterId인가"로 통일해서 검증. 발표자 교체 시 권한도 같이 이전됨
// ※ 노트 저장/AI 처리는 실시간성이 없어 REST API로 처리 (하단 별도 명시).
//   단, "처리 완료" "누가 저장했는지" 알림은 소켓으로 가벼운 브로드캐스트

const EVENTS = {
  // ══════════════════════════════════════════════
  // 룸 생성 & 코드 발급
  // ══════════════════════════════════════════════

  ROOM_CREATE: 'room:create',
  // payload: {}

  ROOM_CREATED: 'room:created',
  // payload: { roomId: string, displayCode: string, audienceCode: string, presenterCode: string }

  ROOM_JOIN_PRESENTER: 'room:join_presenter',
  // payload: { roomId: string, presenterCode: string, name: string }

  ROOM_JOIN_DISPLAY: 'room:join_display',
  // payload: { displayCode: string }

  // 청중 웹 → 서버: 입장. nickname은 기명 모드에서만 사용, 익명 모드면 서버가 자동 생성
  ROOM_JOIN_AUDIENCE: 'room:join_audience',
  // payload: { audienceCode: string, nickname?: string }

  ROOM_JOINED: 'room:joined',
  // payload: {
  //   roomId: string,
  //   role: 'presenter' | 'display' | 'audience',
  //   userId: string,
  //   nickname: string | null,   // audience인 경우 서버가 확정한 표시용 이름
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
  // payload: { durationMinutes?: number, allowMidQuestions?: boolean, questionIdentityMode?: 'anonymous' | 'named' }

  // 서버 → 모든 발표자 앱: 변경된 설정 브로드캐스트
  ROOM_SETTINGS_UPDATED: 'room:settings_updated',
  // payload: { durationMinutes: number, allowMidQuestions: boolean, questionIdentityMode: 'anonymous' | 'named' }

  // 현재 발표자 앱 → 서버: 발표 시작 (최종 확정값, DB에 고정됨)
  PRESENTATION_START: 'presentation:start',
  // payload: { durationMinutes: number, allowMidQuestions: boolean, questionIdentityMode: 'anonymous' | 'named' }

  PRESENTATION_STARTED: 'presentation:started',
  // payload: {
  //   startedAt: number, durationMinutes: number, allowMidQuestions: boolean,
  //   questionIdentityMode: 'anonymous' | 'named', currentFileUrl: string
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
  // payload: {} (둘 다)

  SLIDE_CHANGED: 'slide:changed',
  // payload: { slideIndex: number }
  // ※ 청중웹 수신 대상 아님


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
  // payload: { fileId: string, ownerId: string, slideCount: number }

  // 서버 → 요청 발표자 앱: 대본 자동분배 완료 or AI버튼 처리 완료
  NOTES_READY: 'notes:ready',
  // payload: {
  //   slideNotes: Array<{ slideIndex: number, text: string }>,
  //   source: 'auto_split' | 'ai_summarize' | 'ai_generate' | 'manual'
  // }

  // 서버 → 다른 발표자 앱들: 누군가 노트 저장했을 때 알림
  NOTE_SAVED: 'note:saved',
  // payload: { slideIndex: number, editedByName: string }


  // ══════════════════════════════════════════════
  // 질문 시스템
  // ══════════════════════════════════════════════

  QUESTION_SUBMIT: 'question:submit',
  // payload: { text: string, category: 'during' | 'after' }

  QUESTION_NEW: 'question:new',
  // payload: { questionId: string, text: string, nickname: string, category: 'during' | 'after', createdAt: number }

  QUESTION_ANSWER_SELECT: 'question:answer_select',
  // payload: { questionId: string }

  // 서버 → PC웹 + 청중웹: 답변 이력 전체 (최신순 내림차순)
  ANSWERED_QUESTIONS_UPDATE: 'question:answered_list_update',
  // payload: { answered: Array<{ questionId: string, text: string, nickname: string, answeredAt: number }> }
};

module.exports = { EVENTS };