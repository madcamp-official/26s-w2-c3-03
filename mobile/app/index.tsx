// mobile/app/index.tsx
import { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { socket, getLocalUserId, fetchMyHistory, type HistoryListItem } from '../lib/socket';
import { EVENTS } from '../../shared/events';
import { useKitStore } from '../store/useKitStore';
import { useAuthStore } from '../store/useAuthStore';
import { colors, radius } from '../constants/theme';

function formatHistoryDate(ms: number | null) {
  if (!ms) return '-';
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function formatHistoryDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  return m > 0 ? `${m}분` : `${totalSeconds}초`;
}

// 로그인은 선택사항: 로그인 안 해도 기존처럼 익명으로 방을 만들 수 있고, 로그인했을 때만
// 우측 상단에 계정 정보가 뜨고 방 생성 시 계정에 연결됨(이전 발표 기록 조회용)
function AccountRow() {
  const name = useAuthStore((s) => s.name);
  const hydrated = useAuthStore((s) => s.hydrated);

  const handleLogout = () => {
    Alert.alert('로그아웃', '로그아웃할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => useAuthStore.getState().clearAuth() },
    ]);
  };

  // 로그인 상태를 SecureStore에서 아직 복원 중이면(hydrate 완료 전) 깜빡임 방지를 위해 자리만 비워둠
  if (!hydrated) return <View style={styles.accountRow} />;

  return (
    <View style={styles.accountRow}>
      {name ? (
        <>
          <Text style={styles.accountName}>{name}님</Text>
          <Pressable onPress={handleLogout}>
            <Text style={styles.accountLink}>로그아웃</Text>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={() => router.push('/login')}>
          <Text style={styles.accountLink}>로그인</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function StartScreen() {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const accountName = useAuthStore((s) => s.name);
  const accountToken = useAuthStore((s) => s.token);
  const authHydrated = useAuthStore((s) => s.hydrated);

  const [historyList, setHistoryList] = useState<HistoryListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 로그인돼있고 아직 이름을 직접 안 건드렸으면, 계정 이름을 발표자 이름 칸에 미리 채워줌
  useEffect(() => {
    if (accountName && !name) setName(accountName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountName]);

  // 로그인 상태일 때만 발표 기록을 불러옴 (게스트는 계정에 연결된 방이 없어서 조회 불가).
  // 화면에 돌아올 때마다 다시 불러와서, 상세 화면에서 기록을 삭제하고 돌아오면 목록에도 바로 반영됨.
  useFocusEffect(
    useCallback(() => {
      if (!accountToken) {
        setHistoryList([]);
        return;
      }
      setHistoryLoading(true);
      fetchMyHistory(accountToken)
        .then(setHistoryList)
        .finally(() => setHistoryLoading(false));
    }, [accountToken])
  );

  // [추가] 뒤로가기 등으로 방(대기화면/리모컨 등)에서 시작화면으로 돌아오면, 소켓을 완전히 끊었다
  // 다시 붙게 만들어서 서버 쪽에 남아있던 예전 방 멤버십(및 그 방의 타이머 브로드캐스트 수신)을
  // 정리한다. 서버에 ROOM_LEAVE 처리 로직이 아직 없어서, 연결을 통째로 끊는 게 지금 확실히
  // 청소되는 유일한 방법 — disconnect되면 소켓은 서버의 모든 room에서 자동으로 빠짐.
  useFocusEffect(
    useCallback(() => {
      const { roomId } = useKitStore.getState();
      if (roomId) {
        socket.emit(EVENTS.ROOM_LEAVE, {});
        socket.disconnect();
        useKitStore.getState().resetRoomState();
      }
    }, [])
  );

  const handleCreateRoom = () => {
    if (!title.trim()) {
      alert('발표 제목을 입력해주세요');
      return;
    }

    const doEmit = () => {
      socket.once(EVENTS.ROOM_CREATED, (payload: any) => {
        useKitStore.getState().setRoomCreated({
          ...payload,
          role: 'presenter',
          nickname: name || '발표자',
        });
        router.push('/waiting');
      });
      // [수정] 로그인돼있으면 token도 같이 보냄 — shared/events.js 스펙상 서버가 유효한 token을
      // 받으면 userId 대신 accountId를 신원으로 써서 이 방을 계정에 연결해줌(이전 발표 기록용)
      const authToken = useAuthStore.getState().token;
      socket.emit(EVENTS.ROOM_CREATE, {
        title: title.trim(),
        name: name || '발표자',
        userId: getLocalUserId(),
        ...(authToken ? { token: authToken } : {}),
      });
    };

    if (socket.connected) {
      doEmit();
    } else {
      socket.once('connect', doEmit);
      socket.connect();
    }
  };

  const handleJoinWithCode = () => {
    if (!joinCode.trim()) return;
    if (!socket.connected) socket.connect();

    socket.once(EVENTS.ROOM_JOINED, (payload: any) => {
      useKitStore.getState().setRoomJoined(payload);
      router.push('/waiting');
    });

    // [수정] 방장(ROOM_CREATE)은 token을 같이 보내서 계정에 연결되는데, 코드로 참가하는
    // 다른 발표자(ROOM_JOIN_PRESENTER)는 여태 token을 안 보내고 있었음 — 그래서 로그인한
    // 상태로 참가해도 서버가 이 사람을 계정에 연결 못 해서 session_presenters에 account_id가
    // 안 남고, "최근 발표"(GET /accounts/me/rooms)에도 영영 안 잡혔음(방장만 정상적으로 보임).
    const authToken = useAuthStore.getState().token;
    socket.emit(EVENTS.ROOM_JOIN_PRESENTER, {
      presenterCode: joinCode.trim().toUpperCase(),
      name: name || '발표자',
      userId: getLocalUserId(),
      ...(authToken ? { token: authToken } : {}),
    });
  };

  return (
    // [수정] "코드로 참가하기" 입력창이 화면 아래쪽에 있어서, 키보드가 올라오면 그 위를 덮어버려
    // 입력 중인 코드가 안 보이던 문제 — 포커스된 입력창 위로 화면이 밀려 올라가게 함
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* 브랜드 마크 + 로그인 상태 */}
      <View style={styles.brandRow}>
        <View style={styles.brandBadge}>
          {/* [수정] 새 로고(K + 시그널)로 교체 — 텍스트 "K" 대신 실제 마크 이미지를 배지 안에 표시 */}
          <Image
            source={require('../assets/images/logo-mark.png')}
            style={styles.brandBadgeMark}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.brandName}>Kit</Text>
        <View style={{ flex: 1 }} />
        <AccountRow />
      </View>

      {/* 방 생성 카드 */}
      <View style={styles.heroCard}>
        <Text style={styles.eyebrow}>READY WHEN YOU ARE</Text>
        <Text style={styles.heroTitle}>새 발표방을 열까요?</Text>
        <Text style={styles.heroSub}>자료를 올리고, 코드를 공유하고, 바로 시작하세요.</Text>

        <TextInput
          style={styles.input}
          placeholder="발표 제목"
          placeholderTextColor={colors.inkFaint}
          value={title}
          onChangeText={setTitle}
        />
        <TextInput
          style={styles.input}
          placeholder="이름"
          placeholderTextColor={colors.inkFaint}
          value={name}
          onChangeText={setName}
        />

        <Pressable style={styles.primaryButton} onPress={handleCreateRoom}>
          <Text style={styles.primaryButtonText}>발표 방 만들기</Text>
        </Pressable>
      </View>

      {/* 코드로 참가 카드 */}
      <View style={styles.joinCard}>
        <Text style={styles.joinLabel}>코드로 참가하기</Text>
        <View style={styles.joinRow}>
          <TextInput
            style={styles.joinInput}
            placeholder="발표자 코드"
            placeholderTextColor={colors.inkFaint}
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
          />
          <Pressable style={styles.joinButton} onPress={handleJoinWithCode}>
            <Text style={styles.joinButtonText}>참가</Text>
          </Pressable>
        </View>
        <Text style={styles.joinHint}>다른 발표자는 발표자 코드를 입력해 방에 들어와요</Text>
      </View>

      {/* 최근 발표 목록 */}
      <Text style={styles.sectionTitle}>최근 발표</Text>
      {!authHydrated ? null : !accountToken ? (
        <View style={styles.historyPromptCard}>
          <Text style={styles.historyPromptText}>로그인하면 발표 기록이 여기 쌓여요</Text>
          <Pressable onPress={() => router.push('/login')}>
            <Text style={styles.accountLink}>로그인하기</Text>
          </Pressable>
        </View>
      ) : historyLoading ? (
        <Text style={styles.historyHint}>불러오는 중...</Text>
      ) : historyList.length === 0 ? (
        <Text style={styles.historyHint}>아직 발표 기록이 없어요</Text>
      ) : (
        historyList.map((item) => (
          <Pressable
            key={item.roomId}
            style={styles.recentCard}
            onPress={() =>
              router.push({
                pathname: '/history',
                // [추가] 상세 화면(GET /rooms/:roomId/history)엔 참여 청중 수가 안 내려오는데
                // 목록 API(GET /accounts/me/rooms)엔 있어서, 그냥 navigation param으로 같이 넘겨줌
                params: { id: item.roomId, totalAudience: String(item.totalAudience) },
              })
            }
          >
            <View style={styles.recentThumb}>
              <Ionicons name="document-text-outline" size={18} color={colors.cue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.recentTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.recentMeta}>
                {formatHistoryDate(item.endedAt)} · {formatHistoryDuration(item.totalTimeSeconds)}
              </Text>
            </View>
            <Text style={styles.recentChevron}>›</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  brandBadge: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: colors.spot,
    alignItems: 'center', justifyContent: 'center',
  },
  brandBadgeMark: { width: 22, height: 22 },
  brandName: { fontSize: 17, fontWeight: '700', color: colors.ink },

  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 20 },
  accountName: { fontSize: 13, color: colors.inkDim, fontWeight: '600' },
  accountLink: { fontSize: 13, color: colors.cue, fontWeight: '600' },

  heroCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: radius.lg, padding: 22, marginBottom: 16,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.spot, marginBottom: 8 },
  heroTitle: { fontSize: 21, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  heroSub: { fontSize: 13, color: colors.inkDim, marginBottom: 18 },

  input: {
    backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: 14, height: 48, paddingHorizontal: 14, fontSize: 14, color: colors.ink,
    marginBottom: 10,
  },

  primaryButton: {
    height: 52, borderRadius: 16, backgroundColor: colors.spot,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  primaryButtonText: { color: colors.spotInk, fontWeight: '700', fontSize: 15.5 },

  joinCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: radius.lg, padding: 18, marginBottom: 26,
  },
  joinLabel: { fontSize: 13.5, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  joinRow: { flexDirection: 'row', gap: 8 },
  joinInput: {
    flex: 1, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: 14, height: 48, paddingHorizontal: 14, fontSize: 14, color: colors.ink,
  },
  joinButton: {
    width: 84, height: 48, borderRadius: 14, backgroundColor: colors.spot,
    alignItems: 'center', justifyContent: 'center',
  },
  joinButtonText: { color: colors.spotInk, fontWeight: '700', fontSize: 14 },
  joinHint: { fontSize: 11.5, color: colors.inkFaint, marginTop: 10 },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.inkDim, marginBottom: 10 },
  historyPromptCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: 14, marginBottom: 10,
  },
  historyPromptText: { fontSize: 13, color: colors.inkDim },
  historyHint: { fontSize: 12.5, color: colors.inkFaint, textAlign: 'center', paddingVertical: 16 },

  recentCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: 14, marginBottom: 10,
  },
  recentThumb: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceRaised,
    alignItems: 'center', justifyContent: 'center',
  },
  recentTitle: { fontSize: 14.5, fontWeight: '600', color: colors.ink },
  recentMeta: { fontSize: 12, color: colors.inkFaint, marginTop: 3 },
  recentChevron: { fontSize: 18, color: colors.inkFaint },
});
