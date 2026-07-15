// web/src/components/FullscreenButton.jsx
// 발표장 PC에서 브라우저 주소창/탭 없이 슬라이드만 크게 보여줄 수 있도록 전체화면 토글.
import { useFullscreen } from '../lib/useFullscreen';

export default function FullscreenButton({ className = '' }) {
  const { isFullscreen, toggle } = useFullscreen();

  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      onClick={toggle}
      title={isFullscreen ? '전체화면 종료' : '전체화면으로 보기'}
      aria-label={isFullscreen ? '전체화면 종료' : '전체화면으로 보기'}
    >
      {isFullscreen ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3v4a2 2 0 0 1-2 2H3M15 3v4a2 2 0 0 0 2 2h4M9 21v-4a2 2 0 0 0-2-2H3M15 21v-4a2 2 0 0 1 2-2h4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      )}
    </button>
  );
}
