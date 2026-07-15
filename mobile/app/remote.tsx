// mobile/app/remote.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { socket } from '../lib/socket';
import { EVENTS } from '../../shared/events';
import { useKitStore, type Presenter } from '../store/useKitStore';
import { colors, radius } from '../constants/theme';

// 스와이프로 슬라이드를 넘기려면 이만큼 이상 가로로 밀려야 "탭"이 아니라 "스와이프"로 인정함
const SWIPE_DISTANCE_THRESHOLD = 50;
const SWIPE_VELOCITY_THRESHOLD = 400;

function useIsCurrentPresenter() {
  return useKitStore((s) => {
    const me = s.presenters.find((p) => p.userId === s.userId);
    return me?.isCurrentPresenter ?? false;
  });
}

function fmt(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function QuestionBell() {
  const allowMidQuestions = useKitStore((s) => s.allowMidQuestions);
  const unread = useKitStore((s) => s.unreadQuestionCount);

  if (!allowMidQuestions) return null;

  return (
    <Pressable style={styles.iconBtn} onPress={() => router.push('/questions')}>
      <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.ink} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

function SlidePreview() {
  const currentSlideIndex = useKitStore((s) => s.currentSlideIndex);
  const slideCount = useKitStore((s) => s.slideCount);
  const imageUrl = useKitStore((s) => s.slideImages[s.currentSlideIndex]);
  const isCurrentPresenter = useIsCurrentPresenter();
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [currentSlideIndex]);

  const handlePress = () => {
    if (!isCurrentPresenter) return;
    if (slideCount > 0 && currentSlideIndex >= slideCount) return;
    socket.emit(EVENTS.SLIDE_NEXT, {});
  };

  return (
    <View>
      <View style={styles.slideIdxRow}>
        <Text style={styles.slideIdx}>SLIDE {currentSlideIndex} / {slideCount || '-'}</Text>
      </View>
      <Pressable
        style={[styles.slideFrame, !isCurrentPresenter && styles.slideFrameReadonly]}
        onPress={handlePress}
      >
        {imageUrl && !imageFailed ? (
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFillObject}
            contentFit="contain"
            contentPosition="center"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Text style={styles.slideTitle}>슬라이드 미리보기 준비 중</Text>
        )}
      </Pressable>
    </View>
  );
}

function TimerBar() {
  const elapsedSeconds = useKitStore((s) => s.elapsedSeconds);
  const durationSeconds = useKitStore((s) => s.durationSeconds);
  const isOvertime = useKitStore((s) => s.isOvertime);

  const remain = isOvertime ? elapsedSeconds - durationSeconds : durationSeconds - elapsedSeconds;
  const frac = isOvertime || durationSeconds <= 0 ? 1 : Math.min(1, Math.max(0, elapsedSeconds / durationSeconds));
  const barColor = isOvertime ? colors.alert : colors.spot;

  return (
    <View style={styles.timerCard}>
      <View style={styles.timerTop}>
        <Text style={[styles.timerTime, isOvertime && { color: colors.alert }]}>
          {isOvertime ? '+' : ''}{fmt(remain)}
        </Text>
        <Text style={styles.timerCaption}>{isOvertime ? '초과 시간' : '남은 시간'}</Text>
      </View>
      <View style={styles.timerTrack}>
        <View style={[styles.timerFill, { width: `${frac * 100}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

function NavButtons() {
  const isCurrentPresenter = useIsCurrentPresenter();
  const currentSlideIndex = useKitStore((s) => s.currentSlideIndex);
  const slideCount = useKitStore((s) => s.slideCount);

  const prevDisabled = !isCurrentPresenter || currentSlideIndex <= 1;
  const nextDisabled = !isCurrentPresenter || (slideCount > 0 && currentSlideIndex >= slideCount);

  return (
    <View style={styles.navRow}>
      <Pressable
        style={[styles.navBtn, prevDisabled && styles.navBtnDisabled]}
        disabled={prevDisabled}
        onPress={() => socket.emit(EVENTS.SLIDE_PREV, {})}
      >
        <Text style={styles.navBtnText}>‹ 이전</Text>
      </Pressable>
      <Pressable
        style={[styles.navBtn, nextDisabled && styles.navBtnDisabled]}
        disabled={nextDisabled}
        onPress={() => socket.emit(EVENTS.SLIDE_NEXT, {})}
      >
        <Text style={styles.navBtnText}>다음 ›</Text>
      </Pressable>
    </View>
  );
}

function NotesBlock() {
  const currentSlideIndex = useKitStore((s) => s.currentSlideIndex);
  const slideNotes = useKitStore((s) => s.slideNotes);
  const note = slideNotes.find((n) => n.slideIndex === currentSlideIndex);

  return (
    <View style={styles.notesBlock}>
      <Text style={styles.notesLabel}>발표자 노트</Text>
      {/* [수정] notesBlock이 flex:1이라 노트 내용이 길면 남은 공간을 넘어가는 부분이 화면 밖으로
          잘려서 안 보였음. 라벨은 고정해두고 내용만 자체 스크롤되게 감싸서, 아무리 길어도
          손가락으로 밀어서 끝까지 볼 수 있게 함. */}
      <ScrollView style={styles.notesScroll} showsVerticalScrollIndicator>
        <Text style={styles.notesText}>{note?.text || '이 슬라이드에는 등록된 노트가 없어요'}</Text>
      </ScrollView>
    </View>
  );
}

function HandoffSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const presenters = useKitStore((s) => s.presenters);
  const userId = useKitStore((s) => s.userId);
  const [pickedId, setPickedId] = useState<string | null>(null);

  const others = presenters.filter((p) => p.userId !== userId);

  const handleConfirm = () => {
    if (!pickedId) return;
    socket.emit(EVENTS.PRESENTER_TRANSFER, { targetUserId: pickedId });
    setPickedId(null);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetScrim} onPress={onClose}>
        <Pressable style={styles.sheetPanel} onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>발표자 교체</Text>
            <Pressable onPress={onClose}>
              <Text style={styles.sheetClose}>✕</Text>
            </Pressable>
          </View>

          {others.length === 0 ? (
            <Text style={styles.value}>교체할 다른 발표자가 없어요</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {others.map((p: Presenter) => (
                <Pressable
                  key={p.userId}
                  style={[styles.sheetItem, pickedId === p.userId && styles.sheetItemPicked]}
                  onPress={() => setPickedId(p.userId)}
                >
                  <View style={styles.sheetAvatar}>
                    <Text style={styles.sheetAvatarText}>{p.name.slice(0, 1)}</Text>
                  </View>
                  <Text style={styles.value}>{p.name}</Text>
                  <View style={[styles.radio, pickedId === p.userId && styles.radioPicked]} />
                </Pressable>
              ))}
            </View>
          )}

          <Pressable
            style={[styles.primaryButton, !pickedId && styles.disabled]}
            disabled={!pickedId}
            onPress={handleConfirm}
          >
            <Text style={styles.primaryButtonText}>권한 넘기기</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BottomActions() {
  const isCurrentPresenter = useIsCurrentPresenter();
  const [handoffVisible, setHandoffVisible] = useState(false);
  // [수정] 안드로이드 edge-to-edge라 화면 맨 아래(발표 종료 버튼 등)가 3버튼 제스처 바 영역과
  // 겹쳐서 보였음(삼성 등). waiting.tsx에서 했던 것과 동일하게, 기기의 하단 안전영역만큼
  // 버튼 줄 아래에 여백을 더 줘서 제스처 바 위로 밀어올림.
  const insets = useSafeAreaInsets();

  const handleEnd = () => {
    Alert.alert('발표 종료', '발표를 종료할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '종료', style: 'destructive', onPress: () => socket.emit(EVENTS.PRESENTATION_END, {}) },
    ]);
  };

  return (
    <View style={[styles.bottomRow, { paddingBottom: 16 + insets.bottom }]}>
      <Pressable
        style={[styles.ghostButton, !isCurrentPresenter && styles.disabled]}
        disabled={!isCurrentPresenter}
        onPress={() => setHandoffVisible(true)}
      >
        <Ionicons name="swap-horizontal-outline" size={16} color={colors.ink} />
        <Text style={styles.ghostButtonText}>발표자 교체</Text>
      </Pressable>
      <Pressable
        style={[styles.dangerButton, !isCurrentPresenter && styles.disabled]}
        disabled={!isCurrentPresenter}
        onPress={handleEnd}
      >
        <Text style={styles.dangerButtonText}>발표 종료</Text>
      </Pressable>

      <HandoffSheet visible={handoffVisible} onClose={() => setHandoffVisible(false)} />
    </View>
  );
}

export default function RemoteScreen() {
  const isCurrentPresenter = useIsCurrentPresenter();
  const presenters = useKitStore((s) => s.presenters);
  const presenterName = presenters.find((p) => p.isCurrentPresenter)?.name ?? '발표자';

  // 왼쪽으로 스와이프 = 다음 슬라이드, 오른쪽으로 스와이프 = 이전 슬라이드
  // (아이폰 뒤로가기 제스처처럼, 화면 어디서든 손가락으로 밀면 넘어감)
  const goNext = () => {
    const { currentSlideIndex, slideCount } = useKitStore.getState();
    if (slideCount > 0 && currentSlideIndex >= slideCount) return;
    socket.emit(EVENTS.SLIDE_NEXT, {});
  };
  const goPrev = () => {
    const { currentSlideIndex } = useKitStore.getState();
    if (currentSlideIndex <= 1) {
      // 첫 슬라이드보다 더 앞으로 넘기려는 스와이프 = "발표 시작 취소" 의도로 간주
      Alert.alert('발표 준비 화면으로 돌아갈까요?', '진행 중인 발표가 취소되고, 모든 화면이 시작 전 상태로 돌아가요.', [
        { text: '취소', style: 'cancel' },
        { text: '돌아가기', style: 'destructive', onPress: () => socket.emit(EVENTS.PRESENTATION_CANCEL, {}) },
      ]);
      return;
    }
    socket.emit(EVENTS.SLIDE_PREV, {});
  };

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onEnd((e) => {
      if (!isCurrentPresenter) return;
      const distanceOk = Math.abs(e.translationX) > SWIPE_DISTANCE_THRESHOLD;
      const velocityOk = Math.abs(e.velocityX) > SWIPE_VELOCITY_THRESHOLD;
      if (!distanceOk && !velocityOk) return;
      if (e.translationX < 0) {
        runOnJS(goNext)();
      } else {
        runOnJS(goPrev)();
      }
    });

  return (
    // [수정] GestureHandlerRootView를 앱 전체(_layout.tsx)에 걸어뒀더니 Expo Go + 안드로이드에서
    // 이 화면과 무관한 다른 화면들의 ScrollView 스크롤까지 먹통이 되는 부작용이 있었음. 이 스와이프
    // 제스처는 remote 화면에서만 쓰이므로, 여기서만 감싸서 다른 화면에 영향이 없게 함.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={swipeGesture}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerEyebrow}>{isCurrentPresenter ? '발표 진행 중' : `${presenterName}님 발표 중`}</Text>
            <View style={{ flex: 1 }} />
            <QuestionBell />
          </View>

          <SlidePreview />
          <TimerBar />
          <NavButtons />
          <NotesBlock />
          <BottomActions />
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas, paddingTop: 56 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 4 },
  headerEyebrow: { color: colors.spot, fontSize: 12.5, fontWeight: '700' },

  iconBtn: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: { fontSize: 16 },
  badge: {
    position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, paddingHorizontal: 4,
    borderRadius: 999, backgroundColor: colors.alert, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.alertInk, fontSize: 10, fontWeight: '800' },

  slideIdxRow: { marginHorizontal: 20, marginTop: 12, alignItems: 'flex-end' },
  slideIdx: { fontSize: 11, color: colors.inkFaint, fontWeight: '600' },
  slideFrame: {
    aspectRatio: 16 / 9, marginHorizontal: 20, marginTop: 6, borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.hairline,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', alignSelf: 'stretch',
  },
  slideFrameReadonly: { opacity: 0.92 },
  slideTitle: { fontSize: 15, fontWeight: '700', color: colors.inkDim, paddingHorizontal: 20, textAlign: 'center' },

  timerCard: {
    marginHorizontal: 20, marginTop: 12, padding: 14, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
  },
  timerTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  timerTime: { fontSize: 22, fontWeight: '700', color: colors.ink },
  timerCaption: { fontSize: 11, color: colors.inkFaint, textTransform: 'uppercase' },
  timerTrack: { height: 6, borderRadius: 999, backgroundColor: colors.surfaceRaised, marginTop: 10, overflow: 'hidden' },
  timerFill: { height: '100%', borderRadius: 999 },

  navRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 10 },
  navBtn: {
    flex: 1, height: 50, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.32 },
  navBtnText: { color: colors.ink, fontSize: 13.5, fontWeight: '600' },

  notesBlock: {
    flex: 1, marginHorizontal: 20, marginTop: 12, padding: 14, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
  },
  notesLabel: { fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.inkFaint, marginBottom: 8 },
  notesScroll: { flex: 1 },
  // [수정] 발표하면서 흘깃 보기엔 14px가 너무 작다는 피드백 — 눈에 바로 들어오도록 크게 키움
  notesText: { fontSize: 19, lineHeight: 28, fontWeight: '600', color: colors.ink },

  bottomRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 16 },
  ghostButton: {
    flex: 1, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline,
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent',
  },
  ghostButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  dangerButton: {
    flex: 1, height: 52, borderRadius: radius.md, backgroundColor: colors.alert,
    alignItems: 'center', justifyContent: 'center',
  },
  dangerButtonText: { color: colors.alertInk, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.35 },

  value: { color: colors.ink, fontSize: 15 },
  primaryButton: {
    height: 52, borderRadius: radius.md, backgroundColor: colors.spot,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  primaryButtonText: { color: colors.spotInk, fontWeight: '700', fontSize: 15 },

  sheetScrim: { flex: 1, backgroundColor: 'rgba(6,7,10,0.5)', justifyContent: 'flex-end' },
  sheetPanel: {
    backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    padding: 20, gap: 14, borderWidth: 1, borderColor: colors.hairline, borderBottomWidth: 0,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 14, fontWeight: '700', color: colors.inkDim },
  sheetClose: { fontSize: 16, color: colors.ink },
  sheetItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surfaceRaised,
  },
  sheetItemPicked: { borderColor: colors.spot, backgroundColor: 'rgba(47,95,224,0.06)' },
  sheetAvatar: {
    width: 36, height: 36, borderRadius: 999, backgroundColor: colors.canvas,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetAvatarText: { fontWeight: '700', fontSize: 13, color: colors.ink },
  radio: {
    marginLeft: 'auto', width: 18, height: 18, borderRadius: 999, borderWidth: 2, borderColor: colors.inkFaint,
  },
  radioPicked: { borderColor: colors.spot, backgroundColor: colors.spot },
});
