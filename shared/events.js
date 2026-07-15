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
  // ※ ROOM_CREATE_FROM_HISTORY 성공 시에도 동일한 이벤트로 응답한다 (아래 참고).

  // [신규] "다시 발표하기" — 이전 발표 기록(GET /rooms/:roomId/history 로 봤던 것)의
  // 발표 자료(PDF+슬라이드 이미지)와 노트를 그대로 복사해 새 방을 만든다.
  ROOM_CREATE_FROM_HISTORY: 'room:create_from_history',
  // payload: { sourceRoomId: string, title: string, token: string }  // 로그인 필수, 제목 입력 필수
  // ※ sourceRoomId는 status='end'인 과거 방이어야 하고, 요청 계정이 그 방의 방장이었거나
  //   참여 발표자였어야 한다(GET /rooms/:roomId/history와 동일한 권한 검사, 아니면 에러).
  // ※ 응답은 ROOM_CREATED와 동일. 추가로 자료/노트가 이미 준비돼 있다는 걸 알리기 위해
  //   FILE_READY, NOTES_READY도 같이 방출한다 — 프론트는 재업로드 없이 기존 업로드-완료
  //   플로우 그대로(미리보기 등) 처리하면 된다.

  ROOM_JOIN_PRESENTER: 'room:join_presenter',
  // payload: { presenterCode: string, name: string, userId?: string, token?: string }
  // ※ [수정] roomId는 더 이상 필요 없음. display/audience 입장과 동일하게 presenterCode
  //   하나만으로 방을 찾는다 — 방을 만든 사람이 아닌 다른 발표자는 애초에 roomId를 알 수 없고
  //   "발표자 접속 코드"만 전달받으므로, roomId를 같이 요구하면 항상 실패했다.
  // ※ role은 서버가 (전달된) userId === room.host_user_id 여부로 판단해서 'host' | 'presenter'로 응답한다.
  // ※ [수정] token(로그인 JWT)이 유효하면 ROOM_CREATE와 동일하게 userId 대신 accountId를 신원으로
  //   사용한다. 방장뿐 아니라 다른 발표자도 로그인 계정에 연결되어야 "이전 발표 기록"에 각자의
  //   참여 이력이 남는다 (스펙: 방장 말고 다른 발표자들도 기록 저장).

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
  //   currentFileUrl: string | null,
  //   slideCount?: number,        // presenter 입장에만 포함. currentFileUrl이 있을 때만 의미 있는 값
  //   hasScript?: boolean,        // presenter 입장에만 포함
  //   aiNotesGenerated?: boolean, // presenter 입장에만 포함. true면 "AI 요약" 버튼 비활성화 상태로 그려야 함
  //   status?: 'wait' | 'progress' | 'end',   // display/audience 입장에만 포함
  //   allowMidQuestions?: boolean // audience 입장에만 포함
  // }
  // ※ 클라이언트는 여기서 받은 userId를 로컬에 저장해서 다음 재연결에 그대로 재사용해야 함.
  // ※ [수정] slideCount/hasScript 추가. 자료가 이미 업로드된 방에 나중에 들어온 발표자는
  //   file:ready(업로드 시점에만 방출)를 놓쳤기 때문에, currentFileUrl만으로는 "업로드는 됐는데
  //   몇 장인지/대본이 있는지" 알 수 없어서 화면이 "업로드 안 됨" 상태로 잘못 뜨는 문제가 있었다.
  // ※ [수정] status/allowMidQuestions 추가. 발표가 이미 시작된 뒤에 PC/청중이 (재)접속하면
  //   이미 지나간 presentation:started 브로드캐스트를 영영 못 받아서 대기 화면에 멈춰있었다.
  //   클라이언트는 status==='progress'면 join 응답만으로 바로 발표 화면으로 전환해야 한다.

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

  // [신규] 현재 발표자 앱 → 서버: 발표 "시작 취소". 첫 번째 슬라이드에서만 발생하는
  // UX(오른쪽 스와이프 + 확인 팝업)로, PRESENTATION_END(발표 "종료")와는 다르다 —
  // 종료가 아니라 시작 자체를 무른 것이므로 질문 화면이 아니라 시작 전 대기 화면으로 돌아간다.
  // ※ 권한: PRESENTATION_END와 동일하게 보낸 사람이 현재 currentPresenterId인지 검증.
  PRESENTATION_CANCEL: 'presentation:cancel',
  // payload: {}

  // 서버 → 모든 발표자 앱 + PC웹 + 청중웹: 발표 시작 취소 브로드캐스트.
  // ※ 서버는 room.status를 다시 'wait'로 되돌리고, 타이머를 멈추고, 슬라이드 위치를 1로 리셋한다.
  // ※ PC웹은 QR코드 대기 화면으로, 청중웹은 "입장 완료, 시작 대기" 화면으로 복귀해야 한다.
  PRESENTATION_CANCELLED: 'presentation:cancelled',
  // payload: {}


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
  // payload: { fileId: string, ownerId: string, slideCount: number, fileUrl: string }
  // ※ [수정] fileUrl 추가. 업로드 이전부터 방에 있던 다른 발표자는 이 이벤트 전까지
  //   파일 URL을 받을 방법이 없었기 때문(그전엔 slideCount만 왔음).

  NOTES_READY: 'notes:ready',
  // payload: {
  //   slideNotes: Array<{ slideIndex: number, text: string, imageUrl: string | null }>,
  //   source: 'auto_split' | 'ai_summarize' | 'ai_generate' | 'manual',
  //   hasScript: boolean,
  //   aiNotesGenerated: boolean
  // }
  // ※ [수정] imageUrl 추가. 노트 수정 화면이 이 이벤트만으로 텍스트+슬라이드 이미지를
  //   같이 그릴 수 있도록(별도로 GET /rooms/:roomId/slides를 다시 호출할 필요 없게) 함.
  // ※ [수정] hasScript 추가. "대본이 있다"는 사실이 rooms.has_script로 서버에 저장되므로,
  //   대본을 업로드/AI처리한 사람뿐 아니라 같은 방의 다른 발표자도 이 이벤트로 상태를 맞출 수 있다.
  //   재연결/늦은 입장 시엔 GET /rooms/:roomId의 hasScript 필드로 복구한다.
  // ※ [신규] aiNotesGenerated 추가. rooms.ai_notes_generated 기준 — true면 "AI 요약" 버튼을
  //   비활성화해야 함(같은 대본으로 Gemini를 또 호출하지 못하게 막기 위함). 대본을 다시
  //   업로드하면(이 이벤트가 source:'ai_context_split'로 다시 오며 aiNotesGenerated:false를
  //   실어 보냄) 버튼이 재활성화된다. POST /rooms/:roomId/slides/note/ai는 이미 생성된
  //   상태에서 다시 호출되면 409를 응답하니, 프론트는 방어적으로 이 값을 신뢰하고 버튼을 막아야 한다.

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
  // ※ [수정] role이 'audience'가 아니면 에러 응답 — 청중 전용 이벤트

  QUESTION_NEW: 'question:new',
  // payload: { questionId: string, text: string, nickname: string, category: 'during' | 'after', createdAt: number }

  // [신규] 답변할 발표자 앱 → 서버: "답변하기" 버튼 클릭 (아무도 답변 중이 아닐 때만 성공)
  // ※ 질문 "선택"(강조 표시)은 순수 로컬 UI 상태라 서버 이벤트 없음. 이 이벤트부터가 서버 동기화 시작점
  QUESTION_ANSWERING_START: 'question:answering_start',
  // payload: { questionId: string }
  // ※ 서버는 현재 answeringPresenterId가 null인지 검증. 이미 다른 사람이 답변 중이면 에러 응답
  // ※ [수정] 대상 질문이 이미 status='completed'(답변 완료)면 다시 answering으로 못 돌림 — 에러 응답

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