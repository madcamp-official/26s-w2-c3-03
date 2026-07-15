// mobile/app/waiting.tsx
import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Switch, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { socket, SERVER_URL } from '../lib/socket';
import { EVENTS } from '../../shared/events';
import { useKitStore } from '../store/useKitStore';
import { colors, radius } from '../constants/theme';

// 방 생성자 = 발표 시작 전엔 항상 현재 발표자 (shared/events.js 컨벤션 참고)
function useIsHost() {
  return useKitStore((s) => {
    const me = s.presenters.find((p) => p.userId === s.userId);
    return me?.isCurrentPresenter ?? false;
  });
}

function AudienceCount() {
  const count = useKitStore((s) => s.audienceCount);
  return <Text style={styles.value}>청중 {count}명 입장</Text>;
}

function PresenterList() {
  const presenters = useKitStore((s) => s.presenters);
  return (
    <View>
      <Text style={styles.label}>발표자 ({presenters.length}명)</Text>
      {presenters.map((p) => (
        <Text key={p.userId} style={styles.value}>
          {p.name} {p.isCurrentPresenter ? '(현재 발표자)' : ''}
        </Text>
      ))}
    </View>
  );
}

function TimeStepper() {
  const minutes = useKitStore((s) => s.durationMinutes);
  const roomId = useKitStore((s) => s.roomId);

  const change = (delta: number) => {
    const next = Math.min(60, Math.max(1, minutes + delta));
    useKitStore.setState({ durationMinutes: next });
    socket.emit(EVENTS.ROOM_SETTINGS_UPDATE, { roomId, durationMinutes: next });
  };

  return (
    <View style={styles.row}>
      <Text style={styles.label}>발표 시간</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.stepperBtn} onPress={() => change(-1)}>
          <Text style={styles.stepperBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{minutes}분</Text>
        <Pressable style={styles.stepperBtn} onPress={() => change(1)}>
          <Text style={styles.stepperBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SettingsToggles() {
  const allowMidQuestions = useKitStore((s) => s.allowMidQuestions);
  const anonymous = useKitStore((s) => s.anonymous);
  const roomId = useKitStore((s) => s.roomId);

  const toggleMidQ = () => {
    const next = !allowMidQuestions;
    useKitStore.setState({ allowMidQuestions: next });
    socket.emit(EVENTS.ROOM_SETTINGS_UPDATE, { roomId, allowMidQuestions: next });
  };
  const toggleAnon = () => {
    const next = !anonymous;
    useKitStore.setState({ anonymous: next });
    socket.emit(EVENTS.ROOM_SETTINGS_UPDATE, { roomId, anonymous: next });
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.label}>질문자 익명 처리</Text>
        <Switch
          value={anonymous}
          onValueChange={toggleAnon}
          trackColor={{ false: colors.surfaceRaised, true: colors.spot }}
        />
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.label}>발표 중간 질문 허용</Text>
        <Switch
          value={allowMidQuestions}
          onValueChange={toggleMidQ}
          trackColor={{ false: colors.surfaceRaised, true: colors.spot }}
        />
      </View>
    </View>
  );
}

function DeckUploadButton() {
  const [uploading, setUploading] = useState(false);
  const deckUploaded = useKitStore((s) => s.deckUploaded);
  const roomId = useKitStore((s) => s.roomId);

  const handlePick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    if (result.canceled) return;

    const file = result.assets[0];
    setUploading(true);

    const formData = new FormData();
    formData.append('presentationFile', {
      uri: file.uri,
      name: file.name,
      type: 'application/pdf',
    } as any);
    // [수정] 서버가 x-user-id 헤더 대신 ownerId form 필드로 업로더를 식별함 (min 브랜치 병합 이후 계약)
    formData.append('ownerId', useKitStore.getState().userId ?? '');

    try {
      const res = await fetch(`${SERVER_URL}/rooms/${roomId}/presentation`, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const data = await res.json();
      if (data.success) {
        // [신규] 새 자료를 올렸으니 예전 AI 요약 잠금은 무의미해짐 — 다시 눌러서 새로 만들 수 있게 풀어줌
        useKitStore.setState({ deckUploaded: true, slideCount: data.slideCount, aiSummaryUsed: false });
        // 응답에 이미 슬라이드별 이미지 URL이 실려오므로, 별도 GET 없이 바로 store에 반영
        const images: Record<number, string> = {};
        (data.images || []).forEach((img: { slideIndex: number; imageUrl: string }) => {
          images[img.slideIndex] = `${SERVER_URL}${img.imageUrl}`;
        });
        useKitStore.getState().setSlideImages(images);
      } else {
        alert(data.message);
      }
    } catch (e) {
      alert('업로드 실패, 서버 연결을 확인해주세요');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Pressable style={styles.uploadRow} onPress={handlePick}>
      <View style={[styles.uploadIcon, deckUploaded && styles.uploadIconDone]}>
        <Text style={{ color: deckUploaded ? colors.cue : colors.inkDim }}>{deckUploaded ? '✓' : '↑'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.uploadTitle}>
          {uploading ? '업로드 중...' : deckUploaded ? `발표 자료 업로드 완료 · ${useKitStore.getState().slideCount}슬라이드` : '발표자료 업로드'}
        </Text>
        <Text style={styles.uploadSub}>PDF</Text>
      </View>
    </Pressable>
  );
}

function ScriptUploadButton() {
  const [uploading, setUploading] = useState(false);
  const deckUploaded = useKitStore((s) => s.deckUploaded);
  const scriptProcessing = useKitStore((s) => s.scriptProcessing);
  const slideNotes = useKitStore((s) => s.slideNotes);
  const roomId = useKitStore((s) => s.roomId);

  const handlePick = async () => {
    if (!deckUploaded) {
      alert('발표 자료(PDF)를 먼저 업로드해주세요');
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({ type: 'text/plain' });
    if (result.canceled) return;

    const file = result.assets[0];
    setUploading(true);
    useKitStore.setState({ scriptProcessing: true });

    const formData = new FormData();
    formData.append('scriptFile', {
      uri: file.uri,
      name: file.name,
      type: 'text/plain',
    } as any);

    try {
      const res = await fetch(`${SERVER_URL}/rooms/${roomId}/script`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
          'x-user-id': useKitStore.getState().userId ?? '',
        },
      });
      const data = await res.json();

      if (data.success) {
        // 소켓 이벤트를 기다리지 않고, REST 응답으로 바로 상태 갱신
        // [신규] 새 대본을 올렸으니 AI 요약 잠금도 다시 풀어줌 (이 대본을 대상으로 새로 요약할 수 있어야 함)
        useKitStore.setState({
          slideNotes: data.slideNotes,
          scriptProcessing: false,
          hasScript: true,
          aiSummaryUsed: false,
        });
      } else {
        alert(data.message);
        useKitStore.setState({ scriptProcessing: false });
      }
    } catch (e) {
      alert('업로드 실패, 서버 연결을 확인해주세요');
      useKitStore.setState({ scriptProcessing: false });
    } finally {
      setUploading(false);
    }
  };

  const label = uploading
    ? '전송 중...'
    : scriptProcessing
    ? 'AI가 슬라이드별로 정리 중...'
    : slideNotes.length > 0
    ? `대본 업로드 완료 · ${slideNotes.length}개 노트 생성됨`
    : '대본 업로드';

  return (
    <Pressable style={[styles.uploadRow, !deckUploaded && styles.disabled]} onPress={handlePick}>
      <View style={[styles.uploadIcon, slideNotes.length > 0 && styles.uploadIconDone]}>
        <Text style={{ color: slideNotes.length > 0 ? colors.cue : colors.inkDim }}>
          {scriptProcessing ? '…' : slideNotes.length > 0 ? '✓' : '↑'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.uploadTitle}>{label}</Text>
        <Text style={styles.uploadSub}>TXT</Text>
      </View>
    </Pressable>
  );
}

// [신규] 대본 업로드 창 끝에 놓는 AI 요약 버튼. 서버(POST /rooms/:roomId/slides/note/ai)가
// rooms.has_script를 직접 확인해서 알아서 갈라줌 — 대본이 있으면 그 대본을 3~4줄로 요약하고,
// 없으면 PDF 슬라이드만 보고 새로 노트를 생성한다. 그래서 모바일 쪽은 두 케이스를 구분해서
// 다른 요청을 보낼 필요 없이 그냥 호출만 하면 됨 — 버튼 라벨만 hasScript로 미리 알려줌.
function AiSummaryButton() {
  const deckUploaded = useKitStore((s) => s.deckUploaded);
  const scriptProcessing = useKitStore((s) => s.scriptProcessing);
  const hasScript = useKitStore((s) => s.hasScript);
  // [신규] 한 번 성공적으로 AI 요약/생성을 돌렸으면 잠금. 계속 눌러서 API 호출 제한에 걸리는 걸
  // 막기 위함 — 발표자료를 새로 올리거나(DeckUploadButton) 대본을 새로 올리면(ScriptUploadButton)
  // 다시 풀림. 방 안 다른 발표자가 눌러도 NOTES_READY 브로드캐스트로 이 값이 동기화됨.
  const aiSummaryUsed = useKitStore((s) => s.aiSummaryUsed);
  const roomId = useKitStore((s) => s.roomId);
  const [requesting, setRequesting] = useState(false);

  const handlePress = async () => {
    if (!deckUploaded) {
      alert('먼저 발표 자료를 업로드해주세요');
      return;
    }
    if (aiSummaryUsed) {
      alert('이미 AI 요약을 만들었어요. 다시 만들려면 발표자료나 대본을 새로 올려주세요');
      return;
    }
    setRequesting(true);
    useKitStore.setState({ scriptProcessing: true });
    try {
      const res = await fetch(`${SERVER_URL}/rooms/${roomId}/slides/note/ai`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        // 소켓(NOTES_READY)으로도 곧 같은 내용이 오지만, REST 응답으로 먼저 반영해서 체감 속도를 높임
        useKitStore.setState({
          slideNotes: data.slideNotes,
          scriptProcessing: false,
          hasScript: !!data.hasScript,
          aiSummaryUsed: true,
        });
      } else {
        alert(data.message || 'AI 요약에 실패했어요');
        useKitStore.setState({ scriptProcessing: false });
      }
    } catch (e) {
      alert('AI 요약 실패, 서버 연결을 확인해주세요');
      useKitStore.setState({ scriptProcessing: false });
    } finally {
      setRequesting(false);
    }
  };

  const label = scriptProcessing
    ? 'AI 처리 중...'
    : aiSummaryUsed
    ? 'AI 요약 완료 ✓'
    : hasScript
    ? '대본 AI 요약하기'
    : '슬라이드로 AI 노트 생성하기';

  return (
    <Pressable
      style={[styles.ghostButton, (!deckUploaded || aiSummaryUsed) && styles.disabled]}
      onPress={handlePress}
      disabled={requesting || scriptProcessing || aiSummaryUsed}
    >
      <Text style={styles.ghostButtonText}>✨ {label}</Text>
    </Pressable>
  );
}

function NoteEditButton() {
  const slideCount = useKitStore((s) => s.slideCount);

  const handlePress = () => {
    if (slideCount === 0) {
      alert('먼저 발표 자료를 업로드해주세요');
      return;
    }
    useKitStore.setState({ currentNoteSlideIndex: 1 });
    router.push('/note-editor');
  };

  return (
    <Pressable style={styles.ghostButton} onPress={handlePress}>
      <Text style={styles.ghostButtonText}>노트 수정</Text>
    </Pressable>
  );
}

function StartPresentingButton() {
  const [starting, setStarting] = useState(false);
  // [수정] 아래 타임아웃 콜백은 "6초 뒤에도 presenting이 안 켜져 있으면 실패로 간주"하는 로직인데,
  // 발표가 짧게(6초 이내) 끝나버리면 그 시점엔 presenting이 다시 false가 돼있어서 이미 성공적으로
  // 시작하고 끝난 발표인데도 뒤늦게 "응답 없음" 알림이 떠버렸음(질문 화면 등 완전히 다른 화면으로
  // 넘어간 뒤에 나타남). router.replace로 이 화면 자체가 unmount되는 성공 케이스에서는 타임아웃을
  // 확실히 취소해서, 그 뒤에 발표가 얼마나 빨리 끝나든 이 알림이 절대 안 뜨게 함.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleStart = () => {
    setStarting(true);
    // PRESENTATION_STARTED 수신 시 useSocketListeners에서 store 갱신 + /remote로 자동 이동됨
    socket.emit(EVENTS.PRESENTATION_START, {
      durationMinutes: useKitStore.getState().durationMinutes,
      allowMidQuestions: useKitStore.getState().allowMidQuestions,
      anonymous: useKitStore.getState().anonymous,
    });
    // [추가] 서버가 host_user_id/room_id 매칭에 실패하면 아무 응답도 안 주고 조용히 무시하는
    // 케이스가 있어서(재연결로 socket_id가 바뀐 경우 등), 일정 시간 안에 화면 전환이 안 되면
    // 버튼을 다시 눌러볼 수 있게 풀어준다. presenting이 되면 어차피 화면이 바뀌어 이 컴포넌트는 사라짐.
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      if (!useKitStore.getState().presenting) {
        setStarting(false);
        alert('발표 시작 응답이 없어요. 다시 시도해주세요 (계속되면 재접속 후 시도)');
      }
    }, 6000);
  };

  return (
    <Pressable style={styles.primaryButton} onPress={handleStart} disabled={starting}>
      <Text style={styles.primaryButtonText}>{starting ? '시작하는 중...' : '발표 시작'}</Text>
    </Pressable>
  );
}

// 눌러서 복사할 수 있는 코드 칩. 값이 없으면(아직 발급 전) 눌러도 아무 반응 없음.
function CodeChip({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = async () => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1400);
  };

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return (
    <Pressable style={styles.codeChip} onPress={handleCopy} disabled={!value}>
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={14}
        color={copied ? colors.cue : colors.inkFaint}
        style={styles.codeChipIcon}
      />
      <Text style={styles.codeLabel}>{label}</Text>
      <Text style={styles.codeValue}>{copied ? '복사됨' : (value ?? '-')}</Text>
    </Pressable>
  );
}

export default function WaitingScreen() {
  const title = useKitStore((s) => s.title);
  const displayCode = useKitStore((s) => s.displayCode);
  const presenterCode = useKitStore((s) => s.presenterCode);
  const audienceCode = useKitStore((s) => s.audienceCode);
  const isHost = useIsHost();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.container}
      // [수정] 하드코딩된 paddingTop:60 대신 실제 기기의 안전영역(status bar 등)만큼만 여백을 줌.
      // 특히 paddingBottom은 android.edgeToEdgeEnabled 때문에 화면 아래를 침범하는 시스템 내비게이션
      // 바(제스처 바 등)의 높이(insets.bottom)를 더해줘야 함 — 이게 없으면 마지막 버튼이 그 내비게이션
      // 바 영역 안에 놓여서, 그 지점에서 시작하는 드래그는 스크롤이 아니라 OS의 뒤로가기/홈 제스처로
      // 먹혀버려 "스크롤 자체가 안 되는" 것처럼 보였음(삼성 등 안드로이드에서만 재현되던 문제).
      contentContainerStyle={[
        styles.scrollBody,
        { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 48 },
      ]}
    >
      <Text style={styles.roomTitle}>{title ?? '제목 없는 발표'}</Text>

      <View style={styles.codeRow}>
        <CodeChip label="디스플레이 코드" value={displayCode} />
        <CodeChip label="발표자 코드" value={presenterCode} />
        <CodeChip label="청중 코드" value={audienceCode} />
      </View>

      <View style={styles.card}>
        <PresenterList />
        <View style={styles.divider} />
        <AudienceCount />
      </View>

      <View style={{ height: 16 }} />
      <DeckUploadButton />
      <View style={{ height: 10 }} />
      <ScriptUploadButton />
      <View style={{ height: 10 }} />
      <AiSummaryButton />
      <View style={{ height: 10 }} />
      <NoteEditButton />

      {isHost ? (
        <>
          <View style={{ height: 16 }} />
          <SettingsToggles />
          <View style={{ height: 10 }} />
          <View style={styles.card}>
            <TimeStepper />
          </View>
          <View style={{ height: 20 }} />
          <StartPresentingButton />
        </>
      ) : (
        <>
          <View style={{ height: 16 }} />
          <View style={styles.waitingCard}>
            <ActivityIndicator size="small" color={colors.spot} />
            <Text style={styles.waitingTitle}>발표자를 기다리는 중이에요</Text>
            <Text style={styles.waitingSub}>현재 발표자가 발표를 시작하면{'\n'}자동으로 화면이 넘어가요</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  // [수정] 예전엔 container(View)에 직접 padding을 주고 스크롤이 아예 없어서, 화면이 짧은
  // 기기(안드로이드 등)에서 아랫부분(발표 시작 버튼 등)이 화면 밖으로 잘리고 스크롤도 안 됐음.
  // ScrollView로 감싸고, 상/하 padding은 이제 WaitingScreen에서 useSafeAreaInsets()로 동적으로
  // 계산해서 contentContainerStyle에 얹어줌 (여기 paddingHorizontal만 고정값으로 남김)
  scrollBody: { paddingHorizontal: 20, gap: 4 },
  roomTitle: { color: colors.ink, fontSize: 19, fontWeight: '700', marginBottom: 16 },

  codeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  codeChip: {
    flexGrow: 1, flexBasis: '30%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: radius.md, padding: 12, position: 'relative',
  },
  codeChipIcon: { position: 'absolute', top: 10, right: 10 },
  codeLabel: { color: colors.inkFaint, fontSize: 11 },
  codeValue: { color: colors.cue, fontSize: 16, fontWeight: '700', marginTop: 3 },

  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: radius.md, padding: 14,
  },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 10 },

  // [수정] 발표자가 아닌 참여자에게 보이던 안내 문구가 다른 카드와 똑같은 스타일에 텍스트 한 줄만
  // 덜렁 있어서 대충 만든 것처럼 보였음 — 스피너 + 제목/부제 2단 구성으로 "대기 중" 상태를 명확히 표현
  waitingCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: radius.md, paddingVertical: 28, paddingHorizontal: 20,
    alignItems: 'center', gap: 10,
  },
  waitingTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  waitingSub: { color: colors.inkDim, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  label: { color: colors.inkDim, fontSize: 13 },
  value: { color: colors.ink, fontSize: 15 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn: {
    width: 26, height: 26, borderRadius: 999, backgroundColor: colors.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperBtnText: { color: colors.inkDim, fontSize: 16, fontWeight: '700' },
  stepperValue: { color: colors.ink, fontSize: 14, fontWeight: '700', minWidth: 34, textAlign: 'center' },

  uploadRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: 14,
  },
  disabled: { opacity: 0.45 },
  uploadIcon: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: colors.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
  },
  uploadIconDone: { backgroundColor: 'rgba(14,138,125,0.12)' },
  uploadTitle: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  uploadSub: { color: colors.inkFaint, fontSize: 11, marginTop: 2 },

  ghostButton: {
    height: 46, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  ghostButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },

  primaryButton: {
    height: 52, borderRadius: radius.md, backgroundColor: colors.spot,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  primaryButtonText: { color: colors.spotInk, fontWeight: '700', fontSize: 15.5 },
});
