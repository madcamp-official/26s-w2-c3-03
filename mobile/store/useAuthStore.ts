// mobile/store/useAuthStore.ts
// 로그인 상태 전용 스토어. useKitStore(방/발표 상태)와는 관심사가 달라서 분리함.
// 로그인은 선택사항 — shared/events.js의 ROOM_CREATE 스펙대로, 로그인 안 해도 기존처럼 익명(userId)
// 으로 방을 만들 수 있고, 로그인했을 때만 token을 같이 보내서 서버가 방을 계정에 연결해준다
// (그래야 "이전 발표 기록"에 뜸). 토큰은 기기에 SecureStore로 저장해서 앱을 껐다 켜도 유지된다.
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY_TOKEN = 'kit_auth_token';
const KEY_NAME = 'kit_auth_name';
const KEY_EMAIL = 'kit_auth_email';

interface AuthState {
  token: string | null;
  name: string | null;
  email: string | null;
  hydrated: boolean; // 앱 시작 시 SecureStore에서 복원 완료됐는지
  setAuth: (payload: { token: string; name: string; email: string }) => void;
  clearAuth: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  name: null,
  email: null,
  hydrated: false,

  setAuth: ({ token, name, email }) => {
    set({ token, name, email });
    SecureStore.setItemAsync(KEY_TOKEN, token);
    SecureStore.setItemAsync(KEY_NAME, name);
    SecureStore.setItemAsync(KEY_EMAIL, email);
  },

  clearAuth: () => {
    set({ token: null, name: null, email: null });
    SecureStore.deleteItemAsync(KEY_TOKEN);
    SecureStore.deleteItemAsync(KEY_NAME);
    SecureStore.deleteItemAsync(KEY_EMAIL);
  },

  hydrate: async () => {
    try {
      const [token, name, email] = await Promise.all([
        SecureStore.getItemAsync(KEY_TOKEN),
        SecureStore.getItemAsync(KEY_NAME),
        SecureStore.getItemAsync(KEY_EMAIL),
      ]);
      set({ token, name, email, hydrated: true });
    } catch (e) {
      set({ hydrated: true });
    }
  },
}));
