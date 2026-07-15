// web/src/pages/Audience.jsx
// 청중 화면. audienceCode(+이름)로 입장 → 대기 → 발표 진행 중엔 슬라이드를 독립적으로 열람하며
// 질문을 채팅처럼 등록/열람할 수 있다. (슬라이드는 발표자 화면과 동기화되지 않음 — 스펙대로 독립 열람)
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socket, getOrCreateUserId, fetchSlideImages, fetchQuestions } from '../lib/socket';
import Brand from '../components/Brand';

export default function Audience() {
  const [searchParams] = useSearchParams();
  const initialCode = searchParams.get('code') || '';

  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinedData, setJoinedData] = useState(null);

  const [isStarted, setIsStarted] = useState(false);
  const [presentationEnded, setPresentationEnded] = useState(false);
  const [localSlideIndex, setLocalSlideIndex] = useState(1);

  const [questionText, setQuestionText] = useState('');
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [canAskQuestion, setCanAskQuestion] = useState(true);
  const [slideImages, setSlideImages] = useState({});
  const questionsEndRef = useRef(null);

  const handleJoin = () => {
    if (!code.trim() || !name.trim()) return;
    setJoining(true);
    const myUserId = getOrCreateUserId('kit_userId_audience');
    socket.emit('room:join_audience', { audienceCode: code.trim().toUpperCase(), name: name.trim(), userId: myUserId });
  };

  const handleSubmitQuestion = () => {
    if (!questionText.trim() || !canAskQuestion) return;
    socket.emit('question:submit', { text: questionText.trim() });
    setQuestionText('');
  };

  useEffect(() => {
    const onJoined = (data) => {
      setJoining(false);
      setJoinedData(data);
      if (data.userId) localStorage.setItem('kit_userId_audience', data.userId);
      if (data.currentFileUrl) fetchSlideImages(data.roomId, setSlideImages);
      fetchQuestions(data.roomId, setQuestions);
      if (data.status === 'progress') {
        setIsStarted(true);
        setCanAskQuestion(!!data.allowMidQuestions);
      } else if (data.status === 'end') {
        setIsStarted(true);
        setPresentationEnded(true);
        setCanAskQuestion(true);
      }
    };
    const onStarted = (data) => {
      setIsStarted(true);
      setPresentationEnded(false);
      setCanAskQuestion(!!data.allowMidQuestions);
      if (data?.currentFileUrl) fetchSlideImages(joinedData?.roomId, setSlideImages);
    };
    const onQuestionNew = (data) => {
      setQuestions((prev) => [...prev, { ...data, status: 'pending' }]);
    };
    const onFileReady = () => {
      if (joinedData?.roomId) fetchSlideImages(joinedData.roomId, setSlideImages);
    };
    const onEnded = () => {
      setPresentationEnded(true);
      setCanAskQuestion(true);
    };
    const onCancelled = () => {
      setIsStarted(false);
      setPresentationEnded(false);
      setLocalSlideIndex(1);
      setActiveQuestion(null);
      setCanAskQuestion(true);
    };
    const onAnsweringStarted = (data) => {
      setActiveQuestion(data);
      setQuestions((prev) => prev.map((q) => (q.questionId === data.questionId ? { ...q, status: 'answering' } : q)));
    };
    const onAnsweredUpdate = (data) => {
      setActiveQuestion(null);
      const answeredIds = new Set(data.answered.map((a) => a.questionId));
      setQuestions((prev) => prev.map((q) => (answeredIds.has(q.questionId) ? { ...q, status: 'completed' } : q)));
    };
    const onError = (err) => {
      setJoining(false);
      alert(err.message);
    };

    socket.on('room:joined', onJoined);
    socket.on('presentation:started', onStarted);
    socket.on('question:new', onQuestionNew);
    socket.on('file:ready', onFileReady);
    socket.on('presentation:ended', onEnded);
    socket.on('presentation:cancelled', onCancelled);
    socket.on('question:answering_started', onAnsweringStarted);
    socket.on('question:answered_list_update', onAnsweredUpdate);
    socket.on('error', onError);

    return () => {
      socket.off('room:joined', onJoined);
      socket.off('presentation:started', onStarted);
      socket.off('question:new', onQuestionNew);
      socket.off('file:ready', onFileReady);
      socket.off('presentation:ended', onEnded);
      socket.off('presentation:cancelled', onCancelled);
      socket.off('question:answering_started', onAnsweringStarted);
      socket.off('question:answered_list_update', onAnsweredUpdate);
      socket.off('error', onError);
    };
  }, [joinedData?.roomId]);

  useEffect(() => {
    questionsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [questions.length]);

  if (isStarted) {
    const maxSlide = Object.keys(slideImages).length || null;
    const currentImageUrl = slideImages[localSlideIndex];
    // 발표 중엔 그 자리에서 올라온 질문(during)만, 발표가 끝나면 발표 후 질문(after)만 보여준다 —
    // 발표 중 질문은 발표 후 화면으로 넘어가면 사라진다(사용자 요청).
    const visibleQuestions = questions.filter((q) => q.category === (presentationEnded ? 'after' : 'during'));
    return (
      <div className="audience-live">
        <div className="audience-slide-col">
          <div className="audience-slide-col-header">
            <Brand />
            <div className="audience-slide-nav">
              <button
                className="nav-btn"
                onClick={() => setLocalSlideIndex((p) => Math.max(1, p - 1))}
                disabled={localSlideIndex <= 1}
              >
                ‹
              </button>
              <span>슬라이드 {localSlideIndex}{maxSlide ? ` / ${maxSlide}` : ''}</span>
              <button
                className="nav-btn"
                onClick={() => setLocalSlideIndex((p) => (maxSlide ? Math.min(maxSlide, p + 1) : p + 1))}
                disabled={maxSlide ? localSlideIndex >= maxSlide : false}
              >
                ›
              </button>
            </div>
          </div>
          <div className="slide-frame">
            {currentImageUrl ? (
              <img src={currentImageUrl} alt={`슬라이드 ${localSlideIndex}`} />
            ) : (
              <span className="slide-frame-empty">슬라이드를 불러오는 중이에요…</span>
            )}
          </div>
        </div>

        <div className="audience-qa-col">
          <div className={`qa-phase-label ${presentationEnded ? 'after' : 'during'}`}>
            {presentationEnded ? '발표 후 질문' : '발표 중 질문'}
          </div>

          {activeQuestion && (
            <div className="qa-answering">
              <div className="qa-answering-label">현재 답변 중인 질문</div>
              <div className="qa-answering-text">{activeQuestion.text}</div>
              <span className="qa-answering-name">{activeQuestion.nickname}</span>
            </div>
          )}

          <div className="qa-list">
            {visibleQuestions.length === 0 && <p className="qa-empty">아직 등록된 질문이 없어요</p>}
            {visibleQuestions.map((q) => (
              <div key={q.questionId} className={`qa-bubble ${q.status}`}>
                <p className="qa-bubble-text">{q.text}</p>
                <div className="qa-bubble-meta">
                  <span className="qa-bubble-name">{q.nickname}</span>
                  {q.status === 'answering' && <span className="qa-bubble-status answering">답변 중</span>}
                  {q.status === 'completed' && <span className="qa-bubble-status completed">✓ 답변완료</span>}
                </div>
              </div>
            ))}
            <div ref={questionsEndRef} />
          </div>

          <div className="qa-compose">
            {!canAskQuestion && (
              <p className="qa-compose-hint">발표자가 발표 중 질문을 받지 않도록 설정했어요. 발표가 끝나면 등록할 수 있어요.</p>
            )}
            <div className="qa-compose-row">
              <textarea
                className="qa-textarea"
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitQuestion();
                  }
                }}
                placeholder="궁금한 점을 입력해 주세요"
                disabled={!canAskQuestion}
              />
              <button className="qa-send-btn" onClick={handleSubmitQuestion} disabled={!canAskQuestion || !questionText.trim()}>
                ↑
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (joinedData) {
    return (
      <div className="screen">
        <div className="screen-center">
          <div className="waiting-hero">
            <Brand size="lg" />
            <div>
              <div className="waiting-title">입장 완료</div>
              <div className="waiting-room-title">{joinedData.title}</div>
            </div>
            <span className="home-tagline">
              <strong style={{ color: 'var(--cue)' }}>{joinedData.nickname}</strong>님으로 입장했어요
            </span>
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
              <span className="field-label">청중 접속 코드</span>
              <input
                className="input input-code"
                placeholder="XXXXXX"
                value={code}
                maxLength={8}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="field">
              <span className="field-label">이름</span>
              <input
                className="input"
                placeholder="화면에 표시될 이름"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
            </div>
            <button className="btn btn-cue" onClick={handleJoin} disabled={!code.trim() || !name.trim() || joining}>
              {joining ? '입장하는 중…' : '입장하기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
