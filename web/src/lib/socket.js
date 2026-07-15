// web/src/lib/socket.js
// 소켓 연결 + REST 헬퍼 모음. 기존 App.jsx(테스트 하네스)에 있던 로직을 그대로 옮겨온 것으로,
// 서버(shared/events.js) 프로토콜과의 계약은 동일하게 유지한다.
import { io } from 'socket.io-client';

export const API_BASE = `http://${window.location.hostname}:4000`;

export const socket = io(API_BASE);

// [신규] 재연결해도 같은 사람으로 인식되도록, 역할별로 고정 userId를 localStorage에 보관해두고
// 매번 join/create 이벤트에 실어보낸다. (서버가 이 값을 신원으로 그대로 신뢰함 — events.js 참고)
export const getOrCreateUserId = (storageKey) => {
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = 'usr_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem(storageKey, id);
  }
  return id;
};

// [테스트용] 로그인 토큰(JWT) + 계정 정보를 localStorage에 보관/조회 — /dev 테스트 화면에서만 사용
export const getStoredAuth = () => {
  const token = localStorage.getItem('kit_jwt');
  const accountRaw = localStorage.getItem('kit_account');
  if (!token || !accountRaw) return { token: null, account: null };
  try {
    return { token, account: JSON.parse(accountRaw) };
  } catch {
    return { token: null, account: null };
  }
};
export const storeAuth = (token, account) => {
  localStorage.setItem('kit_jwt', token);
  localStorage.setItem('kit_account', JSON.stringify(account));
};
export const clearAuth = () => {
  localStorage.removeItem('kit_jwt');
  localStorage.removeItem('kit_account');
};

// 서버가 PDF를 페이지별 PNG로 변환해 저장해두므로, 슬라이드 목록(이미지 URL 포함)을
// REST로 받아와 슬라이드 번호 → 이미지 URL 맵으로 만들어둔다.
export const fetchSlideImages = async (roomId, setSlideImages) => {
  try {
    const res = await fetch(`${API_BASE}/rooms/${roomId}/slides`);
    if (!res.ok) return;
    const data = await res.json();
    const map = {};
    (data.slides || []).forEach((s) => {
      if (s.imageUrl) map[s.slideIndex] = `${API_BASE}${s.imageUrl}`;
    });
    setSlideImages(map);
  } catch (e) {
    console.error('슬라이드 이미지 목록을 불러오지 못했습니다.', e);
  }
};

// 새로고침/재접속 시에도 지금까지 등록된 질문을 채팅처럼 그대로 다시 보여주기 위해
// REST로 전체 질문 목록을 받아온다(상태별로 pending/answering/completed).
export const fetchQuestions = async (roomId, setQuestions) => {
  try {
    const res = await fetch(`${API_BASE}/rooms/${roomId}/questions`);
    if (!res.ok) return;
    const data = await res.json();
    const mapped = (data.questions || [])
      .map((q) => ({ questionId: q.questionId, text: q.text, nickname: q.nickname, category: q.category, createdAt: q.createdAt, status: q.status }))
      .sort((a, b) => a.createdAt - b.createdAt);
    setQuestions(mapped);
  } catch (e) {
    console.error('질문 목록을 불러오지 못했습니다.', e);
  }
};
