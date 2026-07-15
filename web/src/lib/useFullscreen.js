// web/src/lib/useFullscreen.js
// 브라우저 Fullscreen API 래퍼. 발표장 PC 화면에서 슬라이드만 크게 보여줄 때 쓴다.
// 주의: requestFullscreen()은 브라우저 정책상 "사용자 제스처(클릭 등)" 없이 호출하면
// 대부분 조용히 거부된다. 소켓 이벤트(발표 시작)로 자동 진입을 시도하되, 실패해도 앱이
// 깨지지 않도록 항상 catch로 감싸고, 화면에는 수동으로 누를 수 있는 버튼도 같이 둔다.
import { useCallback, useEffect, useState } from 'react';

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enter = useCallback(() => {
    if (document.fullscreenElement) return Promise.resolve();
    return document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  const exit = useCallback(() => {
    if (!document.fullscreenElement) return Promise.resolve();
    return document.exitFullscreen().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) return exit();
    return enter();
  }, [enter, exit]);

  return { isFullscreen, enter, exit, toggle };
}
