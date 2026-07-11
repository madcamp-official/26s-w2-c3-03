// mobile/store/useKitStore.ts
import { create } from 'zustand';

interface KitState {
  roomId: string | null;
  userId: string | null;
  role: 'presenter' | null;

  setRoomJoined: (roomId: string, userId: string, role: 'presenter' | null) => void;
}

export const useKitStore = create<KitState>((set) => ({
  roomId: null,
  userId: null,
  role: null,

  setRoomJoined: (roomId, userId, role) => set({ roomId, userId, role }),
}));