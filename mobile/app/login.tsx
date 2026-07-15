// mobile/app/login.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Image } from 'react-native';
import { router } from 'expo-router';
import { SERVER_URL } from '../lib/socket';
import { colors, radius } from '../constants/theme';
import { useAuthStore } from '../store/useAuthStore';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      alert('이메일과 비밀번호를 입력해주세요');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }), // TODO: B 확인 후 필드명 조정
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.message || '로그인에 실패했어요');
        return;
      }
      // [수정] 토큰만 저장하던 걸 useAuthStore로 옮기고, 이름/이메일도 같이 저장해서 다른 화면에서
      // "OO님" 표시나 방 생성 시 이름 자동입력에 쓸 수 있게 함. 응답 형태가 확정 안 돼있어서
      // (B 쪽 TODO) name 필드 위치를 최대한 방어적으로 찾음.
      const accountName = data.user?.name ?? data.name ?? email.trim();
      useAuthStore.getState().setAuth({ token: data.token, name: accountName, email: email.trim() });
      router.replace('/');
    } catch (e) {
      alert('서버에 연결할 수 없어요');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.closeBtn} onPress={() => router.back()}>
        <Text style={styles.closeBtnText}>✕</Text>
      </Pressable>

      <View style={styles.brandBadge}>
        {/* [수정] 옛날 텍스트 "K" 배지를 index.tsx와 동일하게 실제 로고 마크 이미지로 교체 —
            브랜딩이 화면마다 다르게 보이던 문제 */}
        <Image
          source={require('../assets/images/logo-mark.png')}
          style={styles.brandBadgeMark}
          resizeMode="contain"
        />
      </View>
      <Text style={styles.title}>Kit에 로그인</Text>

      <TextInput
        style={styles.input}
        placeholder="이메일"
        placeholderTextColor={colors.inkFaint}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="비밀번호"
        placeholderTextColor={colors.inkFaint}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Pressable style={styles.primaryButton} onPress={handleLogin}>
        <Text style={styles.primaryButtonText}>{loading ? '로그인 중...' : '로그인'}</Text>
      </Pressable>

      <Pressable onPress={() => router.push('/signup')}>
        <Text style={styles.link}>계정이 없으신가요? 회원가입</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas, justifyContent: 'center', padding: 24, gap: 10 },
  closeBtn: {
    position: 'absolute', top: 56, right: 20, width: 36, height: 36, borderRadius: 999,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: 15, color: colors.inkDim },
  brandBadge: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: colors.spot,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12,
  },
  brandBadgeMark: { width: 30, height: 30 },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink, textAlign: 'center', marginBottom: 20 },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline,
    borderRadius: 14, height: 50, paddingHorizontal: 14, fontSize: 14, color: colors.ink,
  },
  primaryButton: {
    height: 52, borderRadius: 16, backgroundColor: colors.spot,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  primaryButtonText: { color: colors.spotInk, fontWeight: '700', fontSize: 15.5 },
  link: { color: colors.cue, textAlign: 'center', marginTop: 14, fontSize: 13 },
});
