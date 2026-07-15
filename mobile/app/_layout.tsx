import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSocketListeners } from '../hooks/useSocketListeners';
import { useAuthStore } from '../store/useAuthStore';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useSocketListeners();

  // 앱 시작 시 SecureStore에 저장된 로그인 토큰을 한 번만 복원 (있으면 로그인 상태 유지)
  useEffect(() => {
    useAuthStore.getState().hydrate();
  }, []);

  return (
    // [수정] GestureHandlerRootView를 여기(앱 전체 루트)에 걸었더니, Expo Go + 안드로이드 조합에서
    // remote.tsx와 전혀 상관없는 다른 화면(waiting.tsx 등)의 일반 ScrollView 스크롤까지 먹통이
    // 되는 문제가 있었음(iOS에서는 재현 안 됨 — RNGH가 안드로이드에서 터치 디스패치 자체를 새로
    // 설치하는 방식이라, 앱 전체에 걸면 그 화면에서 제스처를 안 쓰는 다른 컴포넌트까지 영향을 줄
    // 수 있음). remote.tsx의 스와이프 넘기기에만 필요한 거라, GestureHandlerRootView를 거기로
    // 옮기고(그 화면 안에서만 감싸도록) 여기서는 제거해서 다른 화면들의 터치 처리에 영향이 없게 함.
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="waiting" />
          {/* [수정] remote.tsx에 자체 좌우 스와이프(슬라이드 넘기기)가 있는데, 기본으로 켜져있는
              iOS/OS 자체의 "오른쪽 스와이프 = 뒤로가기" 제스처와 충돌해서 화면이 통째로 팝되며
              index.tsx로 돌아가버리고(뒤로가기 시 방 정리 로직 때문에) 방에서 나가지는 문제가 있었음.
              발표 종료 버튼 + 첫 슬라이드에서 스와이프 시 취소 확인 팝업으로 나가는 길은 이미
              충분하므로, 이 화면에서는 시스템 뒤로가기 스와이프 자체를 꺼서 충돌을 없앰 */}
          <Stack.Screen name="remote" options={{ gestureEnabled: false }} />
          <Stack.Screen name="questions" />
          <Stack.Screen name="history" />
          {/* [수정] note-editor는 이제 슬라이드별로 저장 안 한 초안(drafts)을 들고 있다가 저장
              버튼 한 번에 한꺼번에 반영하는데, 모달 화면은 iOS에서 아래로 스와이프해서 그냥
              닫아버릴 수 있어서(뒤로가기 버튼의 "저장 안 하고 나가기" 확인 절차를 완전히 건너뜀)
              그 상태로 나가면 초안이 소리 없이 사라져버림. 그래서 스와이프로 닫는 것 자체를 막고
              반드시 헤더의 뒤로가기 버튼(확인창 있음)으로만 나가게 함 */}
          <Stack.Screen name="note-editor" options={{ presentation: 'modal', gestureEnabled: false }} />
          <Stack.Screen name="login" />
          <Stack.Screen name="signup" />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}