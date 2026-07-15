// mobile/app/questions.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { socket } from '../lib/socket';
import { EVENTS } from '../../shared/events';
import { useKitStore } from '../store/useKitStore';
import { colors, radius } from '../constants/theme';

function fmt(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// 방 생성자/현재 발표자 여부 — remote.tsx와 동일한 판별 기준(슬라이드 제어권 = 현재 발표자)
function useIsCurrentPresenter() {
  return useKitStore((s) => {
    const me = s.presenters.find((p) => p.userId === s.userId);
    return me?.isCurrentPresenter ?? false;
  });
}

function DuringQuestionsView() {
  const allowMidQuestions = useKitStore((s) => s.allowMidQuestions);
  const questionsDuring = useKitStore((s) => s.questionsDuring);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    useKitStore.setState({ unreadQuestionCount: 0 });
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.headbar}>
        <Pressable style={styles.iconBtn} onPress={() => router.back()}>
          <Text style={styles.iconBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.headTitle}>발표 중 질문</Text>
      </View>

      {!allowMidQuestions ? (
        <View style={styles.emptyHint}>
          <Text style={styles.emptyHintText}>이번 발표는 발표 중 질문을 받지 않아요.{'\n'}질문은 발표가 끝난 뒤에 확인할 수 있어요.</Text>
        </View>
      ) : (
        // [수정] 질문이 많이 쌓여서 끝까지 스크롤했을 때 마지막 질문 카드가 안드로이드 3버튼
        // 제스처 바에 가려지지 않도록 하단 안전영역만큼 여백 추가 (remote.tsx/waiting.tsx와 동일 패턴)
        <ScrollView contentContainerStyle={[styles.scrollBody, { paddingBottom: 20 + insets.bottom }]}>
          {questionsDuring.length === 0 ? (
            <View style={styles.emptyHint}>
              <Text style={styles.emptyHintText}>아직 들어온 질문이 없어요.</Text>
            </View>
          ) : (
            questionsDuring.map((q) => (
              <View key={q.questionId} style={styles.qcard}>
                <Text style={styles.qcardText}>{q.text}</Text>
                <View style={styles.qcardMeta}>
                  <Text style={styles.qcardNick}>{q.nickname}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

// [신규] 발표 종료 후에도 슬라이드를 다시 띄워서 질문에 답할 수 있도록, PC/청중 화면에
// 이미 떠있는 슬라이드를 여기서도 넘길 수 있게 하는 미니 컨트롤. remote.tsx의 슬라이드
// 제어와 동일한 이벤트(SLIDE_NEXT/SLIDE_PREV)를 그대로 쓴다 — 서버가 발표 상태(status)와
// 무관하게 "현재 발표자인가"만 검사하므로 발표 종료 후에도 그대로 동작한다.
function SlideNav() {
  const isCurrentPresenter = useIsCurrentPresenter();
  const currentSlideIndex = useKitStore((s) => s.currentSlideIndex);
  const slideCount = useKitStore((s) => s.slideCount);
  const imageUrl = useKitStore((s) => s.slideImages[s.currentSlideIndex]);

  // [수정] 예전엔 슬라이드 제어권 없는 사람에게 이 카드 자체를 안 보여줬는데, 그러면 "질문에 답하면서
  // 슬라이드도 넘길 수 있다"는 걸 아무도 미리 알 수 없었음. 이제 전원에게 보여주되, 제어권이 없으면
  // 이전/다음 버튼만 비활성화해서 "지금은 못 넘기지만 이런 기능이 있다"는 걸 알 수 있게 함.
  // 질문에 "답변하기"를 누르면 서버가 제어권을 그 사람에게 넘겨주면서 버튼이 자동으로 켜진다.
  const prevDisabled = !isCurrentPresenter || currentSlideIndex <= 1;
  const nextDisabled = !isCurrentPresenter || (slideCount > 0 && currentSlideIndex >= slideCount);

  return (
    <View style={styles.slideNavCard}>
      <View style={styles.slideNavThumbWrap}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFillObject}
            contentFit="contain"
            contentPosition="center"
          />
        ) : (
          <Text style={styles.slideNavThumbText}>슬라이드 없음</Text>
        )}
      </View>
      <View style={styles.slideNavRight}>
        <Text style={styles.slideNavIdx}>SLIDE {currentSlideIndex} / {slideCount || '-'}</Text>
        <Text style={styles.slideNavHint}>
          {isCurrentPresenter ? 'PC·청중 화면에 그대로 반영돼요' : '질문에 답변하면 슬라이드 제어권을 받아요'}
        </Text>
        <View style={styles.slideNavBtnRow}>
          <Pressable
            style={[styles.slideNavBtn, prevDisabled && styles.disabled]}
            disabled={prevDisabled}
            onPress={() => socket.emit(EVENTS.SLIDE_PREV, {})}
          >
            <Text style={styles.slideNavBtnText}>‹ 이전</Text>
          </Pressable>
          <Pressable
            style={[styles.slideNavBtn, nextDisabled && styles.disabled]}
            disabled={nextDisabled}
            onPress={() => socket.emit(EVENTS.SLIDE_NEXT, {})}
          >
            <Text style={styles.slideNavBtnText}>다음 ›</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function EndedQuestionsView() {
  const userId = useKitStore((s) => s.userId);
  const totalElapsedSeconds = useKitStore((s) => s.totalElapsedSeconds);
  const questionsAfter = useKitStore((s) => s.questionsAfter);
  const answeredQuestions = useKitStore((s) => s.answeredQuestions);
  const answeringQuestion = useKitStore((s) => s.answeringQuestion);
  const [mySelectedId, setMySelectedId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const iAmAnswering = answeringQuestion !== null && answeringQuestion.answeringPresenterId === userId;
  const someoneElseAnswering = answeringQuestion !== null && answeringQuestion.answeringPresenterId !== userId;

  const handleSelect = (questionId: string) => {
    setMySelectedId((prev) => (prev === questionId ? null : questionId));
  };

  const handleStartAnswering = () => {
    if (!mySelectedId) return;
    socket.emit(EVENTS.QUESTION_ANSWERING_START, { questionId: mySelectedId });
  };

  const handleEndAnswering = () => {
    socket.emit(EVENTS.QUESTION_ANSWERING_END, {});
    setMySelectedId(null);
  };

  const handleFinish = () => {
    socket.emit(EVENTS.ROOM_LEAVE, {});
    useKitStore.getState().resetRoomState();
    router.replace('/');
  };

  let bottomButton: { label: string; onPress?: () => void; disabled?: boolean } | null = null;
  if (iAmAnswering) {
    bottomButton = { label: '답변 종료하기', onPress: handleEndAnswering };
  } else if (someoneElseAnswering) {
    bottomButton = { label: `${answeringQuestion?.answeringPresenterName ?? '다른 발표자'}님이 답변 중이에요`, disabled: true };
  } else if (mySelectedId) {
    bottomButton = { label: '답변하기', onPress: handleStartAnswering };
  } else if (questionsAfter.length > 0) {
    bottomButton = { label: '질문을 선택해주세요', disabled: true };
  }

  return (
    <View style={styles.container}>
      <View style={styles.headbar}>
        <Pressable style={styles.iconBtn} onPress={handleFinish}>
          <Text style={styles.iconBtnText}>✕</Text>
        </Pressable>
        <Text style={styles.headTitle}>질문</Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollBody,
          // 아래 고정 버튼(bottomButton)이 떠있을 땐 그 버튼 높이만큼, 없을 땐 그냥 안전영역만큼
          // 스크롤 콘텐츠 맨 아래에 여유를 줘서 마지막 카드가 버튼/제스처 바에 가려지지 않게 함
          { paddingBottom: (bottomButton ? 90 : 20) + insets.bottom },
        ]}
      >
        <View style={styles.endedBanner}>
          <Text style={styles.endedEyebrow}>발표 종료됨</Text>
          <Text style={styles.endedTime}>{fmt(totalElapsedSeconds)}</Text>
        </View>

        <SlideNav />

        <Text style={styles.hintText}>질문을 선택한 뒤 답변하기를 누르면 디스플레이 화면에 크게 뜨고, 청중 화면 목록 위에 고정돼요.</Text>

        {answeringQuestion && (
          <>
            <Text style={styles.sectionTitle}>답변 중인 질문</Text>
            <View style={[styles.qcard, styles.qcardLive]}>
              <Text style={styles.qcardText}>{answeringQuestion.text}</Text>
              <View style={styles.qcardMeta}>
                <Text style={styles.qcardNick}>{answeringQuestion.nickname}</Text>
                <Text style={styles.qcardTagLive}>
                  {/* [수정] 본인이 답변 중일 때 '나'로 하드코딩해서 보여주고 있었음 — 실제 등록된
                      이름이 뜨도록 고침 (서버가 이 이벤트에 실어주는 이름을 그대로 사용) */}
                  {answeringQuestion.answeringPresenterName}님이 답변 중
                </Text>
              </View>
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>답변 안된 질문 ({questionsAfter.length})</Text>
        {questionsAfter.length === 0 ? (
          !answeringQuestion && (
            <View style={styles.emptyHint}>
              <Text style={styles.emptyHintText}>아직 남은 질문이 없어요.{'\n'}새 질문이 오면 여기 쌓여요.</Text>
            </View>
          )
        ) : (
          questionsAfter.map((q) => {
            const selected = mySelectedId === q.questionId;
            return (
              <Pressable
                key={q.questionId}
                style={[styles.qcard, selected && styles.qcardSelected]}
                onPress={() => handleSelect(q.questionId)}
              >
                <Text style={styles.qcardText}>{q.text}</Text>
                <View style={styles.qcardMeta}>
                  <Text style={styles.qcardNick}>{q.nickname}</Text>
                  <Text style={styles.qcardTagPending}>답변 안됨</Text>
                </View>
                {selected && (
                  <View style={styles.qcardCheck}>
                    <Text style={styles.qcardCheckText}>✓</Text>
                  </View>
                )}
              </Pressable>
            );
          })
        )}

        {answeredQuestions.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>답변된 질문 ({answeredQuestions.length})</Text>
            {answeredQuestions.map((q) => (
              <View key={q.questionId} style={[styles.qcard, styles.qcardAnswered]}>
                <Text style={styles.qcardText}>{q.text}</Text>
                <View style={styles.qcardMeta}>
                  <Text style={styles.qcardNick}>{q.nickname}</Text>
                  <Text style={styles.qcardTagDone}>답변됨</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {bottomButton && (
        // [수정] remote.tsx의 발표 종료 버튼과 같은 원인 — 안드로이드 edge-to-edge에서 화면 맨 아래
        // 고정 버튼이 3버튼 제스처 바와 겹쳐 보였음. 하단 안전영역만큼 여백을 더해서 그 위로 띄움.
        <View style={[styles.bottomAction, { paddingBottom: 20 + insets.bottom }]}>
          <Pressable
            style={[styles.primaryButton, bottomButton.disabled && styles.disabled]}
            disabled={bottomButton.disabled}
            onPress={bottomButton.onPress}
          >
            <Text style={styles.primaryButtonText}>{bottomButton.label}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function QuestionsScreen() {
  const sessionEnded = useKitStore((s) => s.sessionEnded);
  return sessionEnded ? <EndedQuestionsView /> : <DuringQuestionsView />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },

  headbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 56, paddingHorizontal: 12, paddingBottom: 6 },
  headTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  iconBtn: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: { fontSize: 18, color: colors.ink },

  scrollBody: { padding: 20, paddingTop: 8 },

  emptyHint: { paddingVertical: 30, paddingHorizontal: 14, alignItems: 'center' },
  emptyHintText: { textAlign: 'center', color: colors.inkFaint, fontSize: 12.5, lineHeight: 19 },

  endedBanner: {
    padding: 16, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', marginBottom: 14,
  },
  endedEyebrow: { color: colors.spot, fontSize: 11, fontWeight: '700' },
  endedTime: { fontSize: 24, fontWeight: '700', color: colors.cue, marginTop: 4 },

  slideNavCard: {
    flexDirection: 'row', gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline, marginBottom: 14,
  },
  slideNavThumbWrap: {
    width: 84, height: 84, borderRadius: 10, backgroundColor: colors.surfaceRaised,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  slideNavThumbText: { fontSize: 10, color: colors.inkFaint, textAlign: 'center', paddingHorizontal: 4 },
  slideNavRight: { flex: 1, justifyContent: 'center', gap: 4 },
  slideNavIdx: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  slideNavHint: { fontSize: 10.5, color: colors.inkFaint },
  slideNavBtnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  slideNavBtn: {
    flex: 1, height: 32, borderRadius: 8, backgroundColor: colors.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
  },
  slideNavBtnText: { fontSize: 12, fontWeight: '600', color: colors.ink },

  hintText: { fontSize: 12.5, color: colors.inkFaint, lineHeight: 19, marginBottom: 14 },

  sectionTitle: { fontSize: 14, color: colors.inkDim, fontWeight: '600', marginBottom: 10, marginTop: 6 },

  qcard: {
    padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.hairline, marginBottom: 9, position: 'relative',
  },
  qcardSelected: { borderColor: colors.spot, backgroundColor: 'rgba(47,95,224,0.05)' },
  qcardLive: { borderColor: colors.cue, backgroundColor: 'rgba(14,138,125,0.06)' },
  qcardAnswered: { opacity: 0.72 },
  qcardText: { fontSize: 13.5, lineHeight: 20, color: colors.ink, paddingRight: 20 },
  qcardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  qcardNick: { fontSize: 11.5, color: colors.cue, fontWeight: '600' },
  qcardTagPending: { fontSize: 11.5, color: colors.spot, fontWeight: '700' },
  qcardTagLive: { fontSize: 11.5, color: colors.cue, fontWeight: '700' },
  qcardTagDone: { fontSize: 11.5, color: colors.inkDim, fontWeight: '600' },
  qcardCheck: {
    position: 'absolute', top: 12, right: 12, width: 22, height: 22, borderRadius: 999,
    backgroundColor: colors.spot, alignItems: 'center', justifyContent: 'center',
  },
  qcardCheckText: { color: colors.spotInk, fontSize: 12, fontWeight: '700' },

  bottomAction: { padding: 20, paddingTop: 8 },
  primaryButton: {
    height: 52, borderRadius: radius.md, backgroundColor: colors.spot,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryButtonText: { color: colors.spotInk, fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.4 },
});
