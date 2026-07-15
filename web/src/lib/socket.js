// web/src/lib/socket.js
// 소켓 연결 + REST 헬퍼 모음. 기존 App.jsx(테스트 하네스)에 있던 로직을 그대로 옮겨온 것으로,
// 서버(shared/events.js) 프로토콜과의 계약은 동일하게 유지한다.
import { io } from 'socket.io-client';

// [수정] 로컬 개발(vite dev) 중엔 지금처럼 접속한 호스트의 4000번 포트(로컬 서버)를 그대로 쓰고,
// 빌드된 프로덕션 번들(vite build)에서는 Railway에 배포된 공개 서버로 고정한다.
// (Vercel/Netlify 등에 web을 올렸을 때도 항상 이 주소로 API를 호출하게 됨)
export const API_BASE = import.meta.env.DEV
  ? `http://${window.location.hostname}:4000`
  : 'https://kit-production-1af1.up.railway.app';

export const socket = io(API_BASE);

// [수정] localStorage는 같은 브라우저의 모든 탭이 공유하는 저장소라서, 청중 여러 명을 한 컴퓨터에서
// 탭 여러 개로 테스트/입장시키면(실제로 흔한 상황) 전부 같은 userId를 받아버렸음. 그 결과 나중에
// 입장한 탭이 서버 users 테이블의 socket_id 매핑을 덮어써서, 먼저 입장한 탭은 질문 등록(question:submit)
// 시 서버가 "SELECT ... WHERE socket_id = ?"로 자신을 못 찾아 조용히 무시당함(버튼은 눌리는데
// 아무 반응 없음). sessionStorage는 탭마다 독립적이라 이 충돌이 안 생기고, 새로고침 시 같은 사람으로
// 인식되는 기존 동작(재연결 시 신원 유지)은 그대로 유지된다(탭을 닫기 전까지는 값이 살아있음).
export const getOrCreateUserId = (storageKey) => {
  let id = sessionStorage.getItem(storageKey);
  if (!id) {
    id = 'usr_' + Math.random().toString(36).substring(2, 10);
    sessionStorage.setItem(storageKey, id);
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
