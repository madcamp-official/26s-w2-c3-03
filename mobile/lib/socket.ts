// mobile/lib/socket.ts
import { io, Socket } from 'socket.io-client';

// B의 서버가 실행 중인 로컬 IP:포트 (변경 시 여기만 고치면 됨)
export const SERVER_URL = 'http://10.249.89.40:4000';

export const socket: Socket = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true, // 기본값이지만 명시
});

// [추가] 서버는 socket_id가 아니라 이 userId로 "같은 사람"을 판별함 (재연결돼도 같은 값을 계속 보내야
// current_presenter_id 등 발표 제어권을 안 잃음). 앱을 껐다 켜기 전까지는 메모리에 고정해서 재사용.
// 소켓이 재연결될 때(폰 백그라운드 갔다옴, 네트워크 끊김 등) socket_id가 바뀌는데, 서버 DB엔 예전
// socket_id가 남아있어서 그 상태로 PRESENTATION_START 등을 보내면 서버가 "이 소켓의 유저"를 못 찾고
// 조용히 무시해버림 — 재연결 시 이 userId로 ROOM_JOIN_PRESENTER를 다시 보내 socket_id를 갱신해야 함.
let cachedUserId: string | null = null;
export function getLocalUserId(): string {
  if (!cachedUserId) {
    cachedUserId = 'usr_' + Math.random().toString(36).substring(2, 10);
  }
  return cachedUserId;
}

// 서버가 PDF를 슬라이드별 PNG로 변환해 저장해둔 걸 REST로 받아와
// slideIndex -> 전체 이미지 URL(SERVER_URL 접두) 맵으로 만들어준다.
// (web/src/App.jsx의 fetchSlideImages와 동일한 계약: GET /rooms/:roomId/slides -> { slides: [{ slideIndex, imageUrl }] })
export async function fetchSlideImages(roomId: string): Promise<Record<number, string>> {
  try {
    const res = await fetch(`${SERVER_URL}/rooms/${roomId}/slides`);
    if (!res.ok) return {};
    const data = await res.json();
    const map: Record<number, string> = {};
    (data.slides || []).forEach((s: { slideIndex: number; imageUrl?: string | null }) => {
      if (s.imageUrl) map[s.slideIndex] = `${SERVER_URL}${s.imageUrl}`;
    });
    return map;
  } catch (e) {
    console.error('슬라이드 이미지 목록을 불러오지 못했습니다.', e);
    return {};
  }
}

// [추가] NOTE_SAVED 소켓 이벤트엔 실제로 바뀐 노트 내용이 안 실려있고(slideIndex, editedByName만
// 옴 — shared/events.js 스펙 참고), 그래서 다른 발표자 기기가 바뀐 내용을 알려면 이걸로 다시
// 받아와야 함. ai_summary_note가 AI 요약/수동 수정본, original_note가 대본 분할 원본이라
// ai_summary_note를 우선하고 없으면 original_note로 대체한다.
export async function fetchSlideNotes(roomId: string): Promise<{ slideIndex: number; text: string }[]> {
  try {
    const res = await fetch(`${SERVER_URL}/rooms/${roomId}/slides`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.slides || []).map(
      (s: { slideIndex: number; originalNote?: string | null; aiSummaryNote?: string | null }) => ({
        slideIndex: s.slideIndex,
        text: s.aiSummaryNote || s.originalNote || '',
      })
    );
  } catch (e) {
    console.error('슬라이드 노트를 불러오지 못했습니다.', e);
    return [];
  }
}

// ══════════════════════════════════════════════
// 발표 기록(History) — B가 구현 완료함 (아래 3개 REST 엔드포인트 실제 스펙 기준으로 작성):
//   GET    /accounts/me/rooms      → 내 발표 기록 목록
//   GET    /rooms/:roomId/history  → 상세(자료/노트/답변된 질문/발표자 목록 한 번에)
//   DELETE /rooms/:roomId/history  → 내 기록 목록에서만 숨김(방 자체는 안 지워짐 — 같이 발표한
//                                    다른 사람 기록엔 영향 없음)
// 셋 다 로그인 필요 (Authorization: Bearer <token>).
// ══════════════════════════════════════════════

export interface HistoryListItem {
  roomId: string;
  title: string;
  endedAt: number | null;
  totalTimeSeconds: number;
  durationMinutes: number;
  totalPresenters: number;
  totalAudience: number;
}

export async function fetchMyHistory(token: string): Promise<HistoryListItem[]> {
  try {
    const res = await fetch(`${SERVER_URL}/accounts/me/rooms`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.rooms || [];
  } catch (e) {
    console.error('발표 기록을 불러오지 못했습니다.', e);
    return [];
  }
}

export interface HistorySlide {
  slideIndex: number;
  originalNote: string | null;
  aiSummaryNote: string | null;
  imageUrl: string | null;
}

export interface HistoryAnsweredQuestion {
  questionId: string;
  text: string;
  nickname: string;
  answeredAt: number | null;
}

export interface HistoryPresenter {
  accountId: string | null;
  name: string;
  joinedAt: number;
}

export interface RoomHistoryDetail {
  roomId: string;
  title: string;
  fileUrl: string | null;
  hasScript: boolean;
  scriptUrl: string | null;
  totalTimeSeconds: number;
  durationMinutes: number;
  startedAt: number | null;
  endedAt: number | null;
  presenters: HistoryPresenter[];
  slides: HistorySlide[];
  answeredQuestions: HistoryAnsweredQuestion[];
}

export async function fetchHistoryDetail(roomId: string, token: string): Promise<RoomHistoryDetail | null> {
  try {
    const res = await fetch(`${SERVER_URL}/rooms/${roomId}/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.history ?? null;
  } catch (e) {
    return null;
  }
}

export async function deleteHistoryRoom(roomId: string, token: string): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await fetch(`${SERVER_URL}/rooms/${roomId}/history`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    return { success: res.ok && data.success !== false, message: data.message };
  } catch (e) {
    return { success: false, message: '서버에 연결할 수 없어요' };
  }
}