// mobile/app/history.tsx
//
// GET /rooms/:roomId/history (로그인 필요)로 자료/노트/답변된 질문/발표자 목록을 한 번에 받아오고,
// DELETE /rooms/:roomId/history로 "내 기록 목록에서만" 삭제한다(방 자체나 다른 참여자의 기록에는
// 영향 없음 — B의 실제 구현 기준).
import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, ActivityIndicator, Linking } from 'react-native';
// [수정] expo-file-system v19(SDK 54)부터 기본 진입점(expo-file-system)이 새 File/Directory
// 클래스 기반 API로 바뀌면서 downloadAsync/cacheDirectory가 전부 빠졌음(둘 다 undefined가 되어
// 호출 시 조용히 TypeError가 나고 아래 try/catch에 걸려 "다운로드 실패"만 계속 떴던 원인).
// 예전 방식 그대로 쓰려면 legacy 서브패스로 임포트해야 함.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Ionicons from '@expo/vector-icons/Ionicons';
import { socket, fetchHistoryDetail, deleteHistoryRoom, SERVER_URL, type RoomHistoryDetail } from '../lib/socket';
import { EVENTS } from '../../shared/events';
import { useAuthStore } from '../store/useAuthStore';
import { useKitStore } from '../store/useKitStore';
import { colors, radius } from '../constants/theme';

function formatDate(ms: number | null | undefined) {
  if (!ms) return '-';
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

// fileUrl(/files/xxxx_presentation.pdf)에서 파일명만 뽑아냄 — 서버가 원본 파일명을 따로 안 줘서 최선.
// 쿼리스트링(?...)이 붙어있으면 파일명에 섞여 들어가므로 잘라내고, URL 인코딩된 한글 파일명도 복원함
function fileNameFromUrl(url: string | null | undefined) {
  if (!url) return null;
  const withoutQuery = url.split('?')[0];
  const parts = withoutQuery.split('/');
  const raw = parts[parts.length - 1] || withoutQuery;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// [신규] 확장자로 파일 종류를 판별해서 아이콘/라벨을 결정 — 호출부에서 매번 아이콘을 안 넘겨도 되게 함
function fileKindFromName(name: string | null) {
  const ext = (name?.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return { icon: 'document-text-outline' as const, label: '발표 자료 · PDF' };
  if (ext === 'txt' || ext === 'doc' || ext === 'docx') return { icon: 'reader-outline' as const, label: '발표 대본 · ' + ext.toUpperCase() };
  return { icon: 'document-outline' as const, label: '파일' };
}

function toAbsoluteUrl(url: string) {
  return url.startsWith('http') ? url : `${SERVER_URL}${url}`;
}

// fileUrl이 서버가 내려주는 상대경로(/files/xxxx.pdf)라서, 실제로 열람하려면 SERVER_URL을
// 붙여서 절대 URL로 만든 다음 기기의 기본 브라우저/PDF 뷰어로 열어야 함
async function openFile(url: string | null | undefined) {
  if (!url) return;
  try {
    await Linking.openURL(toAbsoluteUrl(url));
  } catch (e) {
    Alert.alert('열람 실패', '파일을 열 수 없어요. 잠시 후 다시 시도해주세요.');
  }
}

// [신규] 그냥 브라우저로 "열람"만 하던 것과 달리, 파일을 기기 캐시에 내려받은 다음
// 시스템 공유 시트(Sharing.shareAsync)를 띄워서 "파일 앱에 저장" 등으로 실제 다운로드가
// 되게 함. Expo Go에서는 앱이 공용 다운로드 폴더에 직접 쓸 수 있는 권한이 없어서, 공유
// 시트를 거치는 게 표준적인 우회 방법임(사용자가 저장 위치를 직접 고름).
async function downloadFile(url: string, fileName: string) {
  const localUri = `${FileSystem.cacheDirectory}${fileName}`;
  const { uri } = await FileSystem.downloadAsync(toAbsoluteUrl(url), localUri);
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('공유 기능을 사용할 수 없어요');
  }
  await Sharing.shareAsync(uri);
}

// [수정] 아이콘만 있는 작은 다운로드 버튼 하나로 "미리보기"와 "다운로드"를 구분 없이 눌러야 했던
// 것을, 파일 정보(아이콘+이름+종류)와 "미리보기"/"다운로드" 두 버튼을 명확히 분리한 카드로 바꿈 —
// 어떤 버튼이 뭘 하는지 라벨이 바로 보이게.
function FileRow({ url, style }: { url: string; style?: any }) {
  const [downloading, setDownloading] = useState(false);
  const name = fileNameFromUrl(url);
  const { icon, label } = fileKindFromName(name);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadFile(url, name || 'file');
    } catch (e) {
      Alert.alert('다운로드 실패', '파일을 다운로드할 수 없어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <View style={[styles.fileCard, style]}>
      <View style={styles.fileCardHeader}>
        <View style={styles.fileIcon}>
          <Ionicons name={icon} size={19} color={colors.cue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fileName} numberOfLines={1}>{name}</Text>
          <Text style={styles.fileType}>{label}</Text>
        </View>
      </View>
      <View style={styles.fileActions}>
        <Pressable style={styles.fileActionBtn} onPress={() => openFile(url)}>
          <Ionicons name="eye-outline" size={15} color={colors.ink} />
          <Text style={styles.fileActionText}>미리보기</Text>
        </Pressable>
        <Pressable
          style={[styles.fileActionBtn, styles.fileActionBtnPrimary]}
          onPress={handleDownload}
          disabled={downloading}
        >
          {downloading ? (
            <ActivityIndicator size="small" color={colors.spotInk} />
          ) : (
            <Ionicons name="download-outline" size={15} color={colors.spotInk} />
          )}
          <Text style={[styles.fileActionText, styles.fileActionTextPrimary]}>
            {downloading ? '다운로드 중...' : '다운로드'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// [신규] "이 설정으로 다시 발표하기" — 서버의 ROOM_CREATE_FROM_HISTORY 이벤트를 그대로 씀.
// 이 방의 발표 자료(PDF+슬라이드 이미지)와 노트를 서버가 그대로 복사해서 새 방을 만들어주기
// 때문에, 모바일에서 PDF를 다시 골라 업로드할 필요가 없음(FILE_READY/NOTES_READY도 같이
// 와서 useSocketListeners가 알아서 store에 반영해줌). 발표 시간 등 세부 설정은 서버가
// 그대로 복사해주지 않아서, 다음 대기화면에서 다시 정하면 됨.
function RestartButton({ roomId, title, hasFile }: { roomId: string; title: string; hasFile: boolean }) {
  const token = useAuthStore((s) => s.token);
  const [starting, setStarting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const doRestart = () => {
    if (!token) return;
    setStarting(true);

    socket.once(EVENTS.ROOM_CREATED, (payload: any) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // [수정] 이전 방 상태(끝난 발표의 슬라이드 위치/노트 등)가 새 방에 섞여 보이지 않게 먼저 리셋
      useKitStore.getState().resetRoomState();
      useKitStore.getState().setRoomCreated({
        ...payload,
        role: 'presenter',
        nickname: useAuthStore.getState().name || '발표자',
      });
      setStarting(false);
      router.push('/waiting');
    });

    const doEmit = () => {
      socket.emit(EVENTS.ROOM_CREATE_FROM_HISTORY, { sourceRoomId: roomId, title, token });
    };
    if (socket.connected) {
      doEmit();
    } else {
      socket.once('connect', doEmit);
      socket.connect();
    }

    // 서버가 권한 검사 실패 등으로 조용히 무시할 수 있는 경우를 대비한 타임아웃 (다른 화면의
    // StartPresentingButton과 동일한 패턴)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setStarting(false);
      Alert.alert('응답이 없어요', '잠시 후 다시 시도해주세요.');
    }, 8000);
  };

  const handlePress = () => {
    if (!token) {
      Alert.alert('로그인이 필요해요', '다시 발표하려면 로그인해주세요.');
      return;
    }
    Alert.alert(
      '이 설정으로 다시 발표하기',
      hasFile
        ? '이 발표에 올렸던 자료와 노트를 그대로 복사해서 새 발표방을 시작해요. 발표 시간 등 세부 설정은 다음 화면에서 다시 정할 수 있어요.'
        : '자료 없이 새 발표방을 시작해요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '시작', onPress: doRestart },
      ]
    );
  };

  return (
    <Pressable style={[styles.restartButton, starting && styles.disabled]} onPress={handlePress} disabled={starting}>
      <Ionicons name="reload-outline" size={16} color={colors.spotInk} style={{ marginRight: 8 }} />
      <Text style={styles.restartButtonText}>{starting ? '방 만드는 중...' : '이 설정으로 다시 발표하기'}</Text>
    </Pressable>
  );
}

export default function HistoryDetailScreen() {
  const { id: roomId, totalAudience: totalAudienceParam } = useLocalSearchParams<{ id?: string; totalAudience?: string }>();
  const token = useAuthStore((s) => s.token);

  const [detail, setDetail] = useState<RoomHistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // 목록 화면(GET /accounts/me/rooms)엔 참여 청중 수가 있는데, 상세 API(GET /rooms/:roomId/history)엔
  // 없어서 목록에서 넘어올 때 navigation param으로 같이 받아둠. 기록 링크를 직접 열람하는 등 param이
  // 없는 경로로 들어오면 그냥 숨김.
  const totalAudience = totalAudienceParam ? Number(totalAudienceParam) : null;

  const load = useCallback(() => {
    if (!roomId || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchHistoryDetail(roomId, token).then((d) => {
      setDetail(d);
      setLoading(false);
    });
  }, [roomId, token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = () => {
    if (!roomId) return;
    Alert.alert('발표 기록 삭제', '내 발표 기록 목록에서 삭제할까요? 같이 발표했던 다른 분의 기록엔 영향 없어요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          if (!token) {
            Alert.alert('로그인이 필요해요', '기록을 삭제하려면 다시 로그인해주세요.');
            return;
          }
          setDeleting(true);
          const result = await deleteHistoryRoom(roomId, token);
          setDeleting(false);
          if (result.success) {
            router.back();
          } else {
            Alert.alert('삭제 실패', result.message || '잠시 후 다시 시도해주세요.');
          }
        },
      },
    ]);
  };

  const presenterNames = detail?.presenters.map((p) => p.name).filter(Boolean) ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.headbar}>
        <Pressable style={styles.iconBtn} onPress={() => router.back()}>
          <Text style={styles.iconBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.headTitle}>상세 기록</Text>
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.spot} />
        </View>
      ) : !token ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyHint}>로그인 후 볼 수 있어요</Text>
        </View>
      ) : !detail ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyHint}>기록을 불러올 수 없어요</Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scrollBody}>
            <Text style={styles.eyebrow}>{formatDate(detail.endedAt ?? detail.startedAt)}</Text>
            <Text style={styles.title}>{detail.title}</Text>

            <View style={styles.heroCard}>
              <View style={styles.heroRow}>
                <View style={styles.heroIcon}>
                  <Ionicons name="time-outline" size={18} color={colors.cue} />
                </View>
                <View>
                  <Text style={styles.heroValue}>{formatDuration(detail.totalTimeSeconds ?? 0)}</Text>
                  <Text style={styles.heroLabel}>발표 소요 시간</Text>
                </View>
              </View>

              <View style={[styles.heroRow, styles.heroRowDivider]}>
                {presenterNames.length > 0 && (
                  <View style={styles.avatarStack}>
                    {presenterNames.map((n, i) => (
                      <View key={`${n}-${i}`} style={[styles.avatar, i > 0 && { marginLeft: -12 }]}>
                        <Text style={styles.avatarText}>{n.slice(0, 1)}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View>
                  <Text style={styles.heroValue}>
                    {presenterNames.length > 0 ? presenterNames.join(', ') : '기록 없음'}
                  </Text>
                  <Text style={styles.heroLabel}>발표자</Text>
                </View>
              </View>

              {totalAudience !== null && (
                <View style={[styles.heroRow, styles.heroRowDivider]}>
                  <View style={styles.heroIcon}>
                    <Ionicons name="people-outline" size={18} color={colors.cue} />
                  </View>
                  <View>
                    <Text style={styles.heroValue}>{totalAudience}명</Text>
                    <Text style={styles.heroLabel}>참여 청중</Text>
                  </View>
                </View>
              )}
            </View>

            {roomId && (
              <RestartButton roomId={roomId} title={detail.title} hasFile={!!detail.fileUrl} />
            )}

            {detail.fileUrl && <FileRow url={detail.fileUrl} style={{ marginTop: 16 }} />}
            {detail.scriptUrl && <FileRow url={detail.scriptUrl} style={{ marginTop: 8 }} />}

            <Text style={styles.sectionTitle}>답변한 질문 ({detail.answeredQuestions.length})</Text>
            {detail.answeredQuestions.length === 0 ? (
              <Text style={styles.emptyHint}>답변한 질문이 없어요.</Text>
            ) : (
              detail.answeredQuestions.map((q) => (
                <View key={q.questionId} style={styles.qcard}>
                  <Text style={styles.qcardText}>{q.text}</Text>
                  <View style={styles.qcardMeta}>
                    <Text style={styles.qcardNick}>{q.nickname}</Text>
                    <Text style={styles.qcardTag}>답변완료</Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.bottomAction}>
            <Pressable style={styles.dangerButton} onPress={handleDelete} disabled={deleting}>
              <Text style={styles.dangerButtonText}>{deleting ? '삭제하는 중...' : '기록 삭제'}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  headbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 56, paddingHorizontal: 12, paddingBottom: 6 },
  headTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  iconBtn: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: { fontSize: 22, color: colors.ink },

  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scrollBody: { padding: 20, paddingTop: 8 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.spot },
  title: { fontSize: 19, fontWeight: '700', color: colors.ink, marginTop: 8 },

  heroCard: {
    marginTop: 16, borderRadius: radius.lg, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  heroRowDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  heroIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
  },
  heroValue: { fontSize: 18, fontWeight: '700', color: colors.ink },
  heroLabel: { fontSize: 11, color: colors.inkFaint, marginTop: 3 },
  avatarStack: { flexDirection: 'row' },
  avatar: {
    width: 40, height: 40, borderRadius: 999, backgroundColor: colors.surfaceRaised,
    borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontWeight: '700', fontSize: 14, color: colors.ink },

  restartButton: {
    marginTop: 16, height: 50, borderRadius: radius.md, backgroundColor: colors.spot,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  restartButtonText: { color: colors.spotInk, fontWeight: '700', fontSize: 14.5 },
  disabled: { opacity: 0.5 },

  fileCard: {
    padding: 14, borderRadius: 16, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline,
  },
  fileCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  fileIcon: {
    width: 38, height: 38, borderRadius: 11, backgroundColor: colors.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
  },
  fileName: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  fileType: { fontSize: 11, color: colors.inkFaint, marginTop: 2 },
  fileActions: { flexDirection: 'row', gap: 8 },
  fileActionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 40, borderRadius: 11, backgroundColor: colors.surfaceRaised,
  },
  fileActionBtnPrimary: { backgroundColor: colors.cue },
  fileActionText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  fileActionTextPrimary: { color: colors.spotInk },

  sectionTitle: { fontSize: 14, color: colors.inkDim, fontWeight: '600', marginTop: 20, marginBottom: 10 },
  emptyHint: { color: colors.inkFaint, fontSize: 12.5, textAlign: 'center', paddingVertical: 20 },

  qcard: {
    padding: 13, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.hairline, marginBottom: 9,
  },
  qcardText: { fontSize: 13.5, lineHeight: 20, color: colors.ink },
  qcardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  qcardNick: { fontSize: 11.5, color: colors.cue, fontWeight: '600' },
  qcardTag: { fontSize: 11.5, color: colors.inkDim, fontWeight: '600' },

  bottomAction: { padding: 20, paddingTop: 8 },
  dangerButton: {
    height: 52, borderRadius: radius.md, backgroundColor: colors.alert,
    alignItems: 'center', justifyContent: 'center',
  },
  dangerButtonText: { color: colors.alertInk, fontWeight: '700', fontSize: 15 },
});
