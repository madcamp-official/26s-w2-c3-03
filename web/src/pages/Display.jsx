// web/src/pages/Display.jsx
// PC(발표장 컴퓨터) 화면. displayCode로 입장 → 대기(QR+코드) → 발표 진행(슬라이드 동기화 + 답변 중인 질문 표시).
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { socket, getOrCreateUserId, fetchSlideImages } from '../lib/socket';
import { useFullscreen } from '../lib/useFullscreen';
import Brand from '../components/Brand';
import FullscreenButton from '../components/FullscreenButton';

export default function Display() {
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinedData, setJoinedData] = useState(null);
  const [isStarted, setIsStarted] = useState(false);
  const [slideIndex, setSlideIndex] = useState(1);
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [slideImages, setSlideImages] = useState({});
  const { isFullscreen, enter: enterFullscreen, exit: exitFullscreen } = useFullscreen();

  const handleJoin = () => {
    if (!code.trim()) return;
    setJoining(true);
    const myUserId = getOrCreateUserId('kit_userId_display');
    socket.emit('room:join_display', { displayCode: code.trim().toUpperCase(), userId: myUserId });
  };

  useEffect(() => {
    const onJoined = (data) => {
      setJoining(false);
      setJoinedData(data);
      if (data.userId) localStorage.setItem('kit_userId_display', data.userId);
      if (data.currentFileUrl) fetchSlideImages(data.roomId, setSlideImages);
      if (data.status === 'progress') setIsStarted(true);
    };
    // 발표 시작 → 슬라이드만 크게 볼 수 있도록 자동으로 전체화면 진입 시도.
    // (브라우저 정책상 사용자 제스처 없이 호출하면 막힐 수 있음 — 그러면 화면의
    // 전체화면 버튼을 한 번 눌러주면 됨)
    const onStarted = (data) => {
      setIsStarted(true);
      enterFullscreen();
      if (data?.currentFileUrl) fetchSlideImages(joinedData?.roomId, setSlideImages);
    };
    // 발표 종료(질문 시간) → 전체화면 해제하고 슬라이드+질문 답변 배너를 같이 보여주는 화면으로.
    const onEnded = () => {
      exitFullscreen();
    };
    const onCancelled = () => {
      setIsStarted(false);
      setSlideIndex(1);
      setActiveQuestion(null);
      exitFullscreen();
    };
    const onFileReady = () => {
      if (joinedData?.roomId) fetchSlideImages(joinedData.roomId, setSlideImages);
    };
    const onSlideChanged = (data) => setSlideIndex(data.slideIndex);
    const onAnsweringStarted = (data) => setActiveQuestion(data);
    const onAnsweredUpdate = () => setActiveQuestion(null);
    const onError = (err) => {
      setJoining(false);
      alert(err.message);
    };

    socket.on('room:joined', onJoined);
    socket.on('presentation:started', onStarted);
    socket.on('presentation:ended', onEnded);
    socket.on('presentation:cancelled', onCancelled);
    socket.on('file:ready', onFileReady);
    socket.on('slide:changed', onSlideChanged);
    socket.on('question:answering_started', onAnsweringStarted);
    socket.on('question:answered_list_update', onAnsweredUpdate);
    socket.on('error', onError);

    return () => {
      socket.off('room:joined', onJoined);
      socket.off('presentation:started', onStarted);
      socket.off('presentation:ended', onEnded);
      socket.off('presentation:cancelled', onCancelled);
      socket.off('file:ready', onFileReady);
      socket.off('slide:changed', onSlideChanged);
      socket.off('question:answering_started', onAnsweringStarted);
      socket.off('question:answered_list_update', onAnsweredUpdate);
      socket.off('error', onError);
    };
  }, [joinedData?.roomId, enterFullscreen, exitFullscreen]);

  if (isStarted) {
    const currentImageUrl = slideImages[slideIndex];

    // 전체화면 중엔 슬라이드 하나만, 헤더/배너 등 다른 UI는 전부 뺀다.
    if (isFullscreen) {
      return (
        <div className="display-fullscreen-slide">
          {currentImageUrl ? (
            <img src={currentImageUrl} alt={`슬라이드 ${slideIndex}`} />
          ) : (
            <span className="slide-frame-empty-dark">슬라이드를 불러오는 중이에요…</span>
          )}
        </div>
      );
    }

    return (
      <div className="display-live">
        <div className="display-live-header">
          <Brand />
          <span className="display-live-title">{joinedData?.title || '발표 진행 중'} · 슬라이드 {slideIndex}</span>
          <FullscreenButton />
        </div>

        <div className="slide-frame">
          {currentImageUrl ? (
            <img src={currentImageUrl} alt={`슬라이드 ${slideIndex}`} />
          ) : (
            <span className="slide-frame-empty">슬라이드를 불러오는 중이에요…</span>
          )}
        </div>

        {activeQuestion && (
          <div className="answering-banner">
            <div className="answering-banner-label">현재 답변 중 · {activeQuestion.nickname}</div>
            <div className="answering-banner-text">{activeQuestion.text}</div>
          </div>
        )}
      </div>
    );
  }

  if (joinedData) {
    const audienceLink = `${window.location.origin}/audience?code=${joinedData.audienceCode}`;
    return (
      <div className="screen">
        <FullscreenButton className="icon-btn-floating" />
        <div className="screen-center">
          <div className="waiting-hero">
            <Brand size="lg" />
            <div>
              <div className="waiting-title">발표 대기실</div>
              <div className="waiting-room-title">{joinedData.title}</div>
            </div>
            <div className="qr-box">
              <QRCodeSVG value={audienceLink} size={220} fgColor="#171A21" />
            </div>
            <div className="code-display">
              <span className="code-display-label">청중 접속 코드</span>
              <span className="code-display-value">{joinedData.audienceCode}</span>
            </div>
            <span className="waiting-title">
              <span className="spinner-dot" /> &nbsp;발표자가 발표를 시작하면 자동으로 화면이 넘어가요
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-center">
        <div className="waiting-hero" style={{ maxWidth: 360 }}>
          <Brand size="lg" />
          <div className="card" style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <span className="field-label">디스플레이 코드</span>
              <input
                className="input input-code"
                placeholder="XXXXXX"
                value={code}
                maxLength={8}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
            </div>
            <button className="btn btn-primary" onClick={handleJoin} disabled={!code.trim() || joining}>
              {joining ? '연결하는 중…' : '화면 띄우기'}
            </button>
          </div>
          <span className="home-tagline">발표자 앱의 대기 화면에서 발급된 디스플레이 코드를 입력해 주세요.</span>
        </div>
      </div>
    </div>
  );
}
