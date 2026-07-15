// mobile/hooks/useSocketListeners.ts (전체, 발표 시작/타이머/슬라이드/질문 리스너 추가된 버전)
import { useEffect } from 'react';
import { Vibration } from 'react-native';
import { router } from 'expo-router';
import { socket, fetchSlideImages, fetchSlideNotes, getLocalUserId } from '../lib/socket';
import { enqueueAlert } from '../lib/alertQueue';
import { useKitStore } from '../store/useKitStore';
import { useAuthStore } from '../store/useAuthStore';
import { EVENTS } from '../../shared/events';

export function useSocketListeners() {
  useEffect(() => {
    const onRoomCreated = (payload: any) => useKitStore.getState().setRoomCreated(payload);
    const onRoomJoined = (payload: any) => {
      useKitStore.getState().setRoomJoined(payload);

      // [수정] room:joined에는 항상 currentFileUrl/slideCount/hasScript가 실려오는데,
      // 지금까지 "업로드 완료" 상태(deckUploaded)는 file:ready 핸들러에서만 켜주고 있었음.
      // file:ready는 업로드하는 "그 순간" 연결돼 있던 소켓에게만 가는 일회성 브로드캐스트라서,
      // 늦게 들어온 발표자(방 생성 후 나중에 참가/재연결)는 이 이벤트를 원천적으로 못 받아
      // 자료가 이미 올라와 있어도 화면엔 "업로드 안 됨"으로 보였음. room:joined 시점에도
      // 같은 판단을 해줘야 함.
      const hasFile = !!payload.currentFileUrl;
      useKitStore.setState({
        deckUploaded: hasFile,
        slideCount: typeof payload.slideCount === 'number' ? payload.slideCount : 0,
        hasScript: !!payload.hasScript,
      });

      // 자료가 있는 방이면 슬라이드 이미지도 REST로 받아옴
      if (hasFile && payload.roomId) {
        fetchSlideImages(payload.roomId).then((images) => useKitStore.getState().setSlideImages(images));
      }
      // 대본/노트까지 이미 준비된 방이면(hasScript) 노트도 같이 받아와서 미리보기/노트 화면에 반영
      if (payload.hasScript && payload.roomId) {
        fetchSlideNotes(payload.roomId).then((slideNotes) => useKitStore.getState().setNotesReady({ slideNotes }));
      }
    };
    const onPresenterList = (payload: any) => useKitStore.getState().setPresenterList(payload.presenters);
    const onAudienceCount = (payload: any) => useKitStore.getState().setAudienceCount(payload.count);
    const onNotesReady = (payload: any) => useKitStore.getState().setNotesReady(payload);

    // [추가] 슬라이드 여러 개를 연달아 수정하면 note:saved가 그만큼 여러 번 오는데, 매번 바로
    // Alert.alert를 띄우면 알림이 큐에 쌓여서(Alert는 한 번에 하나만 뜨고 나머진 대기) 여러 개를
    // 하나씩 닫아야 하는 상황이 됨. 그래서 짧은 시간(NOTE_ALERT_DEBOUNCE_MS) 안에 도착한 수정들을
    // 모아뒀다가, 잠잠해지면 한 번에 합쳐서 알림 하나로 보여줌.
    const NOTE_ALERT_DEBOUNCE_MS = 1200;
    let pendingNoteEdits: { editedByName: string; slideIndex: number }[] = [];
    let noteAlertTimer: ReturnType<typeof setTimeout> | null = null;

    const flushNoteAlerts = () => {
      noteAlertTimer = null;
      if (pendingNoteEdits.length === 0) return;

      // 편집자 이름별로 슬라이드 번호를 모아서 "OO님이 슬라이드 1, 3, 5의 노트를 수정했어요" 형태로
      const bySlides = new Map<string, number[]>();
      pendingNoteEdits.forEach(({ editedByName, slideIndex }) => {
        const list = bySlides.get(editedByName) ?? [];
        list.push(slideIndex);
        bySlides.set(editedByName, list);
      });

      const lines = Array.from(bySlides.entries()).map(([name, slides]) => {
        const sorted = Array.from(new Set(slides)).sort((a, b) => a - b);
        const slideLabel = sorted.length === 1 ? `슬라이드 ${sorted[0]}` : `슬라이드 ${sorted.join(', ')}`;
        return `${name}님이 ${slideLabel}의 노트를 수정했어요`;
      });

      // [수정] Alert.alert를 바로 부르면 이미 다른 알림(다음 배치, 혹은 에러 알림 등)이 떠있을 때
      // 조용히 드롭될 수 있어서, 전역 alertQueue를 거쳐서 순서대로 빠짐없이 보여줌
      enqueueAlert('노트 수정됨', lines.join('\n'));
      pendingNoteEdits = [];
    };

    // [추가] NOTE_SAVED엔 실제 수정된 텍스트가 안 실려있어서(slideIndex, editedByName만 옴),
    // 다른 발표자 기기가 바뀐 내용을 반영하려면 REST로 최신 노트를 다시 받아와야 함
    const onNoteSaved = (payload: any) => {
      const { roomId, nickname } = useKitStore.getState();
      if (!roomId) return;
      fetchSlideNotes(roomId).then((slideNotes) => useKitStore.getState().setNotesReady({ slideNotes }));

      // [추가] 다른 발표자가 수정했을 때만 알림 (내가 방금 저장한 건 서버가 나한테도 다시
      // 브로드캐스트해줘서 나 자신에게 "내가 수정했다"는 알림이 뜨는 걸 막기 위함 —
      // 서버가 editedById 대신 editedByName만 주기 때문에 닉네임 비교로 판별함)
      if (payload?.editedByName && payload.editedByName !== (nickname || '발표자')) {
        pendingNoteEdits.push({ editedByName: payload.editedByName, slideIndex: payload.slideIndex });
        if (noteAlertTimer) clearTimeout(noteAlertTimer);
        noteAlertTimer = setTimeout(flushNoteAlerts, NOTE_ALERT_DEBOUNCE_MS);
      }
    };

    // 자료 업로드 완료 브로드캐스트: 업로드한 사람 이외의 다른 발표자 기기에 슬라이드 개수/이미지를 채워줌
    // (업로드한 사람 본인은 REST 응답으로 이미 직접 반영하므로 중복 처리는 아님)
    const onFileReady = (payload: any) => {
      // [신규] 새 발표자료가 올라오면 예전 AI 요약은 더 이상 최신 상태를 반영하지 않으므로
      // AI 요약 버튼 잠금을 풀어줌 (본인이 아닌 다른 발표자 기기에도 동기화되게)
      useKitStore.setState({ deckUploaded: true, slideCount: payload.slideCount, aiSummaryUsed: false });
      const roomId = useKitStore.getState().roomId;
      if (roomId) {
        fetchSlideImages(roomId).then((images) => useKitStore.getState().setSlideImages(images));
      }
    };

    // 발표 시작/종료: 방 안의 모든 발표자 기기가 함께 화면 전환됨 (발표자 본인이든 아니든)
    const onPresentationStarted = (payload: any) => {
      useKitStore.getState().setPresentationStarted(payload);
      router.replace('/remote');
    };
    const onPresentationEnded = (payload: any) => {
      useKitStore.getState().setPresentationEnded(payload);
      router.replace('/questions');
    };

    // [추가] 리모컨에서 첫 슬라이드보다 더 앞으로 스와이프해서 발표 시작을 취소한 경우.
    // PRESENTATION_ENDED와 달리 Q&A 화면이 아니라 대기화면으로 되돌아가야 함
    const onPresentationCancelled = () => {
      useKitStore.getState().setPresentationCancelled();
      router.replace('/waiting');
    };

    const onSlideChanged = (payload: any) => useKitStore.getState().setSlideChanged(payload.slideIndex);
    // [신규] 타이머가 "초과 시간"으로 넘어가는 그 순간에만 진동을 울림. TIMER_UPDATE는 매초
    // 오는데 isOvertime이 true인 동안 매번 진동시키면 계속 부르르 떨게 되니까, 직전 상태(false)
    // → 지금(true)로 바뀌는 딱 한 번의 전환(edge)만 감지해서 한 번만 울린다.
    const onTimerUpdate = (payload: any) => {
      const wasOvertime = useKitStore.getState().isOvertime;
      useKitStore.getState().setTimerUpdate(payload);
      if (!wasOvertime && payload.isOvertime) {
        Vibration.vibrate([0, 400, 200, 400, 200, 400]);
      }
    };

    const onQuestionNew = (payload: any) => useKitStore.getState().setQuestionNew(payload);
    const onQuestionAnsweringStarted = (payload: any) => useKitStore.getState().setQuestionAnsweringStarted(payload);
    const onAnsweredQuestionsUpdate = (payload: any) => useKitStore.getState().setAnsweredQuestionsUpdate(payload);

    // [추가] 서버가 검증 실패 시 조용히 무시(return)하고 아무 응답도 안 주는 경우가 많아서
    // (예: PRESENTATION_START가 호스트/room_id 매칭에 실패하면 그냥 리턴됨), 최소한 서버가
    // 'error'를 보내주는 경우라도 화면에 표시되게 전역으로 받아둠
    const onError = (payload: any) => {
      enqueueAlert('오류', payload?.message || '서버에서 오류가 발생했어요');
    };

    // [추가] 소켓이 재연결되면(폰 백그라운드 갔다옴, 와이파이 끊김 등) socket_id가 바뀌는데,
    // 서버 DB의 users 테이블엔 예전 socket_id가 남아있어서 그 상태로 PRESENTATION_START 등을
    // 보내면 서버가 "이 소켓의 유저"를 못 찾고 조용히 무시해버림(대표 증상: "발표 시작" 눌러도
    // 무한 로딩). 이미 방에 들어와 있던 상태(roomId/presenterCode 보유)에서 재연결되면, 같은
    // userId로 ROOM_JOIN_PRESENTER를 다시 보내서 서버의 socket_id 매핑을 갱신해준다.
    const onConnect = () => {
      const { roomId, presenterCode, nickname } = useKitStore.getState();
      if (roomId && presenterCode) {
        // [수정] index.tsx의 handleJoinWithCode와 같은 이유로 token을 같이 보내야 재연결
        // 시에도 계정 연결이 계속 유지됨(안 그러면 재연결마다 계정 연결이 끊긴 채로 남을 수 있음)
        const authToken = useAuthStore.getState().token;
        socket.emit(EVENTS.ROOM_JOIN_PRESENTER, {
          roomId,
          presenterCode,
          name: nickname || '발표자',
          userId: getLocalUserId(),
          ...(authToken ? { token: authToken } : {}),
        });
      }
    };

    socket.on(EVENTS.ROOM_CREATED, onRoomCreated);
    socket.on(EVENTS.ROOM_JOINED, onRoomJoined);
    socket.on(EVENTS.PRESENTER_LIST_UPDATE, onPresenterList);
    socket.on(EVENTS.AUDIENCE_COUNT_UPDATE, onAudienceCount);
    socket.on(EVENTS.NOTES_READY, onNotesReady);
    socket.on(EVENTS.NOTE_SAVED, onNoteSaved);
    socket.on(EVENTS.FILE_READY, onFileReady);

    socket.on(EVENTS.PRESENTATION_STARTED, onPresentationStarted);
    socket.on(EVENTS.PRESENTATION_ENDED, onPresentationEnded);
    socket.on(EVENTS.PRESENTATION_CANCELLED, onPresentationCancelled);
    socket.on(EVENTS.SLIDE_CHANGED, onSlideChanged);
    socket.on(EVENTS.TIMER_UPDATE, onTimerUpdate);

    socket.on(EVENTS.QUESTION_NEW, onQuestionNew);
    socket.on(EVENTS.QUESTION_ANSWERING_STARTED, onQuestionAnsweringStarted);
    socket.on(EVENTS.ANSWERED_QUESTIONS_UPDATE, onAnsweredQuestionsUpdate);
    socket.on('error', onError);
    socket.on('connect', onConnect);

    if (!socket.connected) socket.connect();

    return () => {
      if (noteAlertTimer) clearTimeout(noteAlertTimer);
      socket.off(EVENTS.ROOM_CREATED, onRoomCreated);
      socket.off(EVENTS.ROOM_JOINED, onRoomJoined);
      socket.off(EVENTS.PRESENTER_LIST_UPDATE, onPresenterList);
      socket.off(EVENTS.AUDIENCE_COUNT_UPDATE, onAudienceCount);
      socket.off(EVENTS.NOTES_READY, onNotesReady);
      socket.off(EVENTS.NOTE_SAVED, onNoteSaved);
      socket.off(EVENTS.FILE_READY, onFileReady);

      socket.off(EVENTS.PRESENTATION_STARTED, onPresentationStarted);
      socket.off(EVENTS.PRESENTATION_ENDED, onPresentationEnded);
      socket.off(EVENTS.PRESENTATION_CANCELLED, onPresentationCancelled);
      socket.off(EVENTS.SLIDE_CHANGED, onSlideChanged);
      socket.off(EVENTS.TIMER_UPDATE, onTimerUpdate);

      socket.off(EVENTS.QUESTION_NEW, onQuestionNew);
      socket.off(EVENTS.QUESTION_ANSWERING_STARTED, onQuestionAnsweringStarted);
      socket.off(EVENTS.ANSWERED_QUESTIONS_UPDATE, onAnsweredQuestionsUpdate);
      socket.off('error', onError);
      socket.off('connect', onConnect);
    };
  }, []);
}
