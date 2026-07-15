// web/src/pages/Home.jsx
// 웹 진입 랜딩. 발표장 컴퓨터인지 청중인지 고른다. (발표자는 모바일 앱 전용)
import { Link } from 'react-router-dom';
import Brand from '../components/Brand';

export default function Home() {
  return (
    <div className="screen">
      <div className="screen-center">
        <div className="home-hero">
          <Brand size="lg" />
          <p className="home-tagline">
            발표 자료를 화면에 띄우거나, 청중으로 참여해 질문을 남겨보세요.
            <br />
            발표자는 Kit 모바일 앱을 이용해 주세요.
          </p>

          <div className="home-choices">
            <Link to="/display" className="choice-card">
              <div className="choice-icon display">
                {/* [수정] 이모지 아이콘(🖥️)이 OS/폰트마다 다르게 렌더링돼서 다른 아이콘들(전체화면
                    버튼 등)과 스타일이 안 맞았음 — FullscreenButton과 같은 outline SVG 스타일로 통일 */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="13" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div>
                <div className="choice-title">PC 디스플레이</div>
                <div className="choice-sub">발표장 컴퓨터 화면에 슬라이드를 띄워요</div>
              </div>
            </Link>
            <Link to="/audience" className="choice-card">
              <div className="choice-icon audience">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div>
                <div className="choice-title">청중으로 참여</div>
                <div className="choice-sub">발표 자료를 보고 질문을 남겨요</div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
