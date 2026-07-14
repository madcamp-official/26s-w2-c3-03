// web/src/App.jsx
import { BrowserRouter, Routes, Route, useSearchParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react'; 

const socket = io(`http://${window.location.hostname}:4000`);

// [신규] 재연결해도 같은 사람으로 인식되도록, 역할별로 고정 userId를 localStorage에 보관해두고
// 매번 join/create 이벤트에 실어보낸다. (서버가 이 값을 신원으로 그대로 신뢰함 — events.js 참고)
const getOrCreateUserId = (storageKey) => {
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = 'usr_' + Math.random().toString(36).substring(2, 10);
    localStorage.setItem(storageKey, id);
  }
  return id;
};

const API_BASE = `http://${window.location.hostname}:4000`;

// [신규] 서버가 PDF를 페이지별 PNG로 변환해 저장해두므로, 슬라이드 목록(이미지 URL 포함)을
// REST로 받아와 슬라이드 번호 → 이미지 URL 맵으로 만들어둔다.
const fetchSlideImages = async (roomId, setSlideImages) => {
  try {
    const res = await fetch(`${API_BASE}/rooms/${roomId}/slides`);
    if (!res.ok) return;
    const data = await res.json();
    const map = {};
    (data.slides || []).forEach(s => {
      if (s.imageUrl) map[s.slideIndex] = `${API_BASE}${s.imageUrl}`;
    });
    setSlideImages(map);
  } catch (e) {
    console.error('슬라이드 이미지 목록을 불러오지 못했습니다.', e);
  }
};

// =========================================================================
// [화면 0] 임시 발표자 앱 리모컨 (HomeView) - 테스트용
// =========================================================================
const HomeView = () => {
  const [roomTitle, setRoomTitle] = useState('테스트 발표 방');
  const [testRoomInfo, setTestRoomInfo] = useState(null);
  const [timerData, setTimerData] = useState(null); 

  const [durationMinutes, setDurationMinutes] = useState(1);
  const [anonymous, setAnonymous] = useState(true); // ✨ 명세서 동기화: Boolean 타입 설정 변경
  const [allowMidQuestions, setAllowMidQuestions] = useState(true);

  // [테스트용] PDF → PNG 변환 기능 확인용 업로드 상태
  const [presentationFile, setPresentationFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  useEffect(() => {
    socket.on('timer:update', (data) => setTimerData(data));
    socket.on('error', (err) => alert(`오류: ${err.message}`));
    return () => {
      socket.off('timer:update');
      socket.off('error');
    };
  }, []);

  const handleTestCreateRoom = () => {
    const myUserId = getOrCreateUserId('kit_userId_host');
    socket.emit('room:create', { title: roomTitle, userId: myUserId });
    socket.once('room:created', (data) => {
      setTestRoomInfo(data);
      if (data.userId) localStorage.setItem('kit_userId_host', data.userId);
    });
  };

  const handleStart = () => {
    socket.emit('presentation:start', { 
      durationMinutes: Number(durationMinutes), 
      anonymous, 
      allowMidQuestions 
    });
  };
  const handleNextSlide = () => socket.emit('slide:next');
  const handlePrevSlide = () => socket.emit('slide:prev');

  // [테스트용] 발표 자료(PDF) 업로드 → 서버가 PNG로 변환한 결과를 그대로 받아와 화면에 보여줌
  const handleUploadPresentation = async () => {
    if (!presentationFile || !testRoomInfo) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('presentationFile', presentationFile);
      formData.append('ownerId', localStorage.getItem('kit_userId_host') || '');

      const res = await fetch(`${API_BASE}/rooms/${testRoomInfo.roomId}/presentation`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setUploadResult(data);
      if (!data.success) alert(`업로드 실패: ${data.message}`);
    } catch (e) {
      alert(`업로드 중 오류: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>KIT 웹 게이트웨이 🚀</h1>
      <p>가상 방을 만들고, 발급된 코드로 접속 테스트를 해보세요!</p>
      
      <div style={{ marginTop: '20px', padding: '30px', border: '2px dashed #007BFF', display: 'inline-block', borderRadius: '10px' }}>
        <h3>🛠️ 백엔드 단독 테스트용 방 만들기</h3>
        <input 
          value={roomTitle} 
          onChange={(e) => setRoomTitle(e.target.value)} 
          placeholder="방 제목 입력" 
          style={{ padding: '8px', marginRight: '10px' }} 
        />
        <button onClick={handleTestCreateRoom} style={{ padding: '8px 20px', cursor: 'pointer', backgroundColor: '#007BFF', color: 'white', border: 'none', borderRadius: '5px' }}>
          방 생성하기
        </button>
        
        {testRoomInfo && (
          <div style={{ marginTop: '20px', fontSize: '18px', backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px', textAlign: 'left' }}>
            <p><strong>👑 발표자 코드:</strong> <span style={{ color: '#0984e3' }}>{testRoomInfo.presenterCode}</span></p>
            <p><strong>🖥️ 디스플레이 코드:</strong> <span style={{ color: '#d63031' }}>{testRoomInfo.displayCode}</span></p>
            <p><strong>📱 청중 코드:</strong> <span style={{ color: '#00b894' }}>{testRoomInfo.audienceCode}</span></p>
            
            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#dfe6e9', borderRadius: '8px' }}>
              <h4 style={{ margin: '0 0 10px 0' }}>⚙️ 발표 환경 설정</h4>
              
              <div style={{ marginBottom: '10px' }}>
                <label style={{ marginRight: '10px' }}><strong>발표 시간 (분):</strong></label>
                <input 
                  type="number" 
                  min="1" 
                  value={durationMinutes} 
                  onChange={(e) => setDurationMinutes(e.target.value)} 
                  style={{ width: '50px', padding: '5px' }}
                />
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ marginRight: '10px' }}><strong>질문 방식:</strong></label>
                <select value={anonymous} onChange={(e) => setAnonymous(e.target.value === 'true')} style={{ padding: '5px' }}>
                  <option value="true">익명 허용</option>
                  <option value="false">기명(실명) 필수</option>
                </select>
              </div>

              <div>
                <label style={{ marginRight: '10px' }}><strong>질문 타이밍:</strong></label>
                <select value={allowMidQuestions} onChange={(e) => setAllowMidQuestions(e.target.value === 'true')} style={{ padding: '5px' }}>
                  <option value="true">발표 중 실시간 허용</option>
                  <option value="false">발표 종료 후 한꺼번에</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#a29bfe', borderRadius: '8px', textAlign: 'center' }}>
              <h4 style={{ margin: '0 0 10px 0' }}>🖼️ 발표 자료(PDF) 업로드 → PNG 변환 테스트</h4>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPresentationFile(e.target.files[0] || null)}
                style={{ marginRight: '10px' }}
              />
              <button
                onClick={handleUploadPresentation}
                disabled={!presentationFile || uploading}
                style={{ padding: '8px 20px', cursor: presentationFile && !uploading ? 'pointer' : 'not-allowed', backgroundColor: '#6c5ce7', color: 'white', border: 'none', borderRadius: '5px' }}
              >
                {uploading ? '변환 중...' : '업로드 및 변환'}
              </button>

              {uploadResult && (
                <div style={{ marginTop: '15px', textAlign: 'left' }}>
                  {uploadResult.success ? (
                    <>
                      <p><strong>✅ 변환 완료:</strong> 총 {uploadResult.slideCount}장</p>
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', backgroundColor: 'white', padding: '10px', borderRadius: '8px' }}>
                        {(uploadResult.images || []).map(img => (
                          <div key={img.slideIndex} style={{ textAlign: 'center' }}>
                            <img
                              src={`${API_BASE}${img.imageUrl}`}
                              alt={`슬라이드 ${img.slideIndex}`}
                              style={{ width: '160px', border: '1px solid #ddd', borderRadius: '4px' }}
                            />
                            <div style={{ fontSize: '12px', color: '#636e72' }}>#{img.slideIndex}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p style={{ color: '#d63031' }}>❌ {uploadResult.message}</p>
                  )}
                </div>
              )}
            </div>

            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#eccc68', borderRadius: '8px', textAlign: 'center' }}>
              <h4>📱 (임시) 발표자 앱 리모컨</h4>
              <button onClick={handleStart} style={{ margin: '5px', padding: '8px', cursor: 'pointer', backgroundColor: '#d63031', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
                발표 시작 (설정 적용)
              </button>
              <button onClick={handlePrevSlide} style={{ margin: '5px', padding: '8px', cursor: 'pointer' }}>이전 슬라이드</button>
              <button onClick={handleNextSlide} style={{ margin: '5px', padding: '8px', cursor: 'pointer' }}>다음 슬라이드</button>
              
              {timerData && (
                <div style={{ 
                  marginTop: '15px', padding: '10px', borderRadius: '8px', fontSize: '20px', fontWeight: 'bold',
                  backgroundColor: timerData.isOvertime ? '#ff7675' : '#ffffff', 
                  color: timerData.isOvertime ? 'white' : 'black',
                  border: '2px solid #333'
                }}>
                  ⏱️ 현재 발표 시간 - {formatTime(timerData.elapsedSeconds)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '40px' }}>
        <Link to="/display" target="_blank" style={{ padding: '15px 30px', background: '#343a40', color: 'white', textDecoration: 'none', borderRadius: '8px', fontSize: '18px' }}>
          🖥️ PC 디스플레이 열기
        </Link>
        <Link to="/audience" target="_blank" style={{ padding: '15px 30px', background: '#28A745', color: 'white', textDecoration: 'none', borderRadius: '8px', fontSize: '18px' }}>
          📱 청중 화면 열기
        </Link>
      </div>
    </div>
  );
};

// =========================================================================
// [화면 1] PC 디스플레이 화면 (/display)
// =========================================================================
const DisplayView = () => {
  const [code, setCode] = useState('');
  const [joinedData, setJoinedData] = useState(null);
  const [isStarted, setIsStarted] = useState(false);
  const [slideIndex, setSlideIndex] = useState(1);
  const [activeQuestion, setActiveQuestion] = useState(null);
  // [신규] { 슬라이드번호: 이미지URL } 형태로 보관
  const [slideImages, setSlideImages] = useState({});

  const handleJoin = () => {
    const myUserId = getOrCreateUserId('kit_userId_display');
    socket.emit('room:join_display', { displayCode: code, userId: myUserId });
  };

  useEffect(() => {
    socket.on('room:joined', (data) => {
      setJoinedData(data);
      if (data.userId) localStorage.setItem('kit_userId_display', data.userId);
      // 이미 자료가 업로드돼 있던 방에 들어온 경우(재연결 등) 바로 이미지 목록을 받아온다
      if (data.currentFileUrl) fetchSlideImages(data.roomId, setSlideImages);
    });
    socket.on('presentation:started', (data) => {
      setIsStarted(true);
      if (data?.currentFileUrl) fetchSlideImages(joinedData?.roomId, setSlideImages);
    });
    // [신규] 자료가 업로드되는 순간에도 바로 받아옴(발표 시작 전 미리보기 등)
    socket.on('file:ready', () => {
      if (joinedData?.roomId) fetchSlideImages(joinedData.roomId, setSlideImages);
    });
    socket.on('slide:changed', (data) => setSlideIndex(data.slideIndex));

    // ✨ 명세서 동기화: 최신 이벤트명 수신 및 nickname 접근 적용
    socket.on('question:answering_started', (data) => setActiveQuestion(data));
    socket.on('question:answered_list_update', () => setActiveQuestion(null)); 
    socket.on('error', (err) => alert(err.message));

    return () => {
      socket.off('room:joined');
      socket.off('presentation:started');
      socket.off('file:ready');
      socket.off('slide:changed');
      socket.off('question:answering_started');
      socket.off('question:answered_list_update');
      socket.off('error');
    };
  }, [joinedData?.roomId]);

  if (isStarted) {
    const currentImageUrl = slideImages[slideIndex];
    return (
      <div style={{ padding: '20px', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f1f2f6', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>{joinedData?.title || '발표 진행 중'} - 슬라이드 #{slideIndex}</h2>
        </div>
        
        <div style={{ flex: 1, backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #dfe6e9', borderRadius: '12px', overflow: 'hidden' }}>
          {currentImageUrl ? (
            <img 
              src={currentImageUrl} 
              alt={`슬라이드 ${slideIndex}`} 
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} 
            />
          ) : (
            <span style={{ fontSize: '32px', color: '#b2bec3' }}>슬라이드 이미지를 불러오는 중...</span>
          )}
        </div>

        {activeQuestion && (
          <div style={{ 
            position: 'absolute', bottom: '50px', left: '50px', right: '50px', 
            backgroundColor: '#007BFF', color: 'white', padding: '20px 30px', 
            borderRadius: '12px', boxShadow: '0 10px 20px rgba(0,0,0,0.2)' 
          }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#ffdd59' }}>현재 답변 중인 질문 ({activeQuestion.nickname})</h4>
            <h2 style={{ margin: 0, fontSize: '32px' }}>{activeQuestion.text}</h2>
          </div>
        )}
      </div>
    );
  }

  if (joinedData) {
    const audienceLink = `${window.location.origin}/audience?code=${joinedData.audienceCode}`;
    return (
      <div style={{ textAlign: 'center', marginTop: '50px' }}>
        <h3 style={{ color: '#636e72' }}>{joinedData.title}</h3>
        <h1>발표 대기실에 오신 것을 환영합니다</h1>
        <h2>아래 QR 코드를 스캔하거나 접속 코드를 입력해 주세요</h2>
        <div style={{ margin: '40px 0' }}>
          <QRCodeSVG value={audienceLink} size={256} />
        </div>
        <h1 style={{ fontSize: '48px', color: '#007BFF' }}>접속 코드: {joinedData.audienceCode}</h1>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h2>발표 화면 (PC) 세팅</h2>
      <input placeholder="디스플레이 코드 6자리 입력" value={code} onChange={(e) => setCode(e.target.value)} style={{ padding: '10px', fontSize: '18px' }} />
      <button onClick={handleJoin} style={{ padding: '10px 20px', fontSize: '18px', marginLeft: '10px' }}>화면 띄우기</button>
    </div>
  );
};

// =========================================================================
// [화면 2] 청중 화면 (/audience)
// =========================================================================
const AudienceView = () => {
  const [searchParams] = useSearchParams();
  const initialCode = searchParams.get('code') || ''; 
  
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [joinedData, setJoinedData] = useState(null);
  
  const [isStarted, setIsStarted] = useState(false);
  const [localSlideIndex, setLocalSlideIndex] = useState(1); 
  
  const [questionText, setQuestionText] = useState('');
  const [activeQuestion, setActiveQuestion] = useState(null);
  const [answeredQuestions, setAnsweredQuestions] = useState([]);
  // [신규] "발표 중 질문 허용"이 꺼진 방이면 발표가 끝나기 전까진 등록 버튼을 눌러도 막힘.
  // 서버 검증(alert)에만 맡기지 않고, 버튼 자체를 비활성화해서 스펙대로 동작하게 함.
  const [canAskQuestion, setCanAskQuestion] = useState(true);
  // [신규] { 슬라이드번호: 이미지URL } 형태로 보관
  const [slideImages, setSlideImages] = useState({});

  const handleJoin = () => {
    const myUserId = getOrCreateUserId('kit_userId_audience');
    socket.emit('room:join_audience', { audienceCode: code, name, userId: myUserId });
  };

  const handleSubmitQuestion = () => {
    if (!questionText.trim() || !canAskQuestion) return;
    // [수정] category는 서버가 room.status로 직접 판단하므로 더 이상 클라이언트가 보낼 필요 없음
    socket.emit('question:submit', { text: questionText });
    setQuestionText('');
  };

  useEffect(() => {
    socket.on('room:joined', (data) => {
      setJoinedData(data);
      if (data.userId) localStorage.setItem('kit_userId_audience', data.userId);
      if (data.currentFileUrl) fetchSlideImages(data.roomId, setSlideImages);
    });
    socket.on('presentation:started', (data) => {
      setIsStarted(true);
      // [신규] 발표 시작 시 확정된 설정값으로 질문 등록 가능 여부를 정함
      setCanAskQuestion(!!data.allowMidQuestions);
      if (data?.currentFileUrl) fetchSlideImages(joinedData?.roomId, setSlideImages);
    });
    // [신규] 자료가 업로드되는 순간에도 바로 받아옴 (발표 시작 전부터 청중이 미리 열람 가능)
    socket.on('file:ready', () => {
      if (joinedData?.roomId) fetchSlideImages(joinedData.roomId, setSlideImages);
    });
    // [신규] 발표가 끝나면 설정과 무관하게 항상 질문 가능(서버 로직과 동일한 기준)
    socket.on('presentation:ended', () => setCanAskQuestion(true));
    socket.on('error', (err) => alert(err.message));
    
    // ✨ 명세서 동기화: 이벤트 수신 리스너 명칭 매핑 완료
    socket.on('question:answering_started', (data) => setActiveQuestion(data));
    socket.on('question:answered_list_update', (data) => {
      setActiveQuestion(null);
      setAnsweredQuestions(data.answered);
    });

    return () => {
      socket.off('room:joined');
      socket.off('presentation:started');
      socket.off('file:ready');
      socket.off('presentation:ended');
      socket.off('error');
      socket.off('question:answering_started');
      socket.off('question:answered_list_update');
    };
  }, [joinedData?.roomId]);

  if (isStarted) {
    const maxSlide = Object.keys(slideImages).length || null;
    const currentImageUrl = slideImages[localSlideIndex];
    return (
      <div style={{ display: 'flex', height: '100vh', backgroundColor: '#f1f2f6' }}>
        <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3>{joinedData?.title} - 내 슬라이드 뷰어</h3>
            <div>
              <button onClick={() => setLocalSlideIndex(prev => Math.max(1, prev - 1))} style={{ padding: '8px 15px', marginRight: '5px' }}>이전</button>
              <span>Slide {localSlideIndex}</span>
              <button
                onClick={() => setLocalSlideIndex(prev => maxSlide ? Math.min(maxSlide, prev + 1) : prev + 1)}
                style={{ padding: '8px 15px', marginLeft: '5px' }}
              >
                다음
              </button>
            </div>
          </div>
          <div style={{ flex: 1, backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px', border: '1px solid #ddd', overflow: 'hidden' }}>
            {currentImageUrl ? (
              <img 
                src={currentImageUrl} 
                alt={`슬라이드 ${localSlideIndex}`} 
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} 
              />
            ) : (
              <span style={{ fontSize: '24px', color: '#b2bec3' }}>슬라이드 이미지를 불러오는 중...</span>
            )}
          </div>
        </div>

        <div style={{ width: '350px', backgroundColor: 'white', borderLeft: '1px solid #ddd', display: 'flex', flexDirection: 'column' }}>
          {activeQuestion ? (
            <div style={{ padding: '20px', backgroundColor: '#fff3cd', borderBottom: '2px solid #ffeeba' }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#856404' }}>현재 답변 중인 질문</h4>
              <p style={{ margin: 0, fontWeight: 'bold' }}>{activeQuestion.text}</p>
              <small style={{ color: '#6c757d' }}>- {activeQuestion.nickname}</small>
            </div>
          ) : (
            <div style={{ padding: '20px', backgroundColor: '#e9ecef', borderBottom: '1px solid #ddd' }}>
              <h4 style={{ margin: 0, color: '#495057' }}>대기 중인 답변이 없습니다</h4>
            </div>
          )}

          <div style={{ padding: '20px', borderBottom: '1px solid #ddd' }}>
            <h4>질문 남기기</h4>
            {!canAskQuestion && (
              <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#e17055' }}>
                발표자가 발표 중 질문을 받지 않도록 설정했어요. 발표가 끝나면 등록할 수 있어요.
              </p>
            )}
            <textarea 
              value={questionText} 
              onChange={(e) => setQuestionText(e.target.value)} 
              placeholder="궁금한 점을 입력해주세요"
              disabled={!canAskQuestion}
              style={{ width: '100%', height: '80px', padding: '10px', boxSizing: 'border-box', resize: 'none', marginBottom: '10px', backgroundColor: canAskQuestion ? 'white' : '#f1f2f6' }}
            />
            <button 
              onClick={handleSubmitQuestion} 
              disabled={!canAskQuestion || !questionText.trim()}
              style={{ 
                width: '100%', padding: '10px', 
                backgroundColor: canAskQuestion ? '#28A745' : '#b2bec3', 
                color: 'white', border: 'none', 
                cursor: canAskQuestion ? 'pointer' : 'not-allowed', 
                borderRadius: '4px' 
              }}
            >
              등록하기
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            <h4>답변 완료 목록</h4>
            {answeredQuestions.length === 0 && <p style={{ color: '#999' }}>아직 답변된 질문이 없습니다.</p>}
            {answeredQuestions.map(q => (
              <div key={q.questionId} style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px dashed #eee' }}>
                <p style={{ margin: '0 0 5px 0' }}>{q.text}</p>
                <small style={{ color: '#007BFF' }}>{q.nickname}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (joinedData) {
    return (
      <div style={{ textAlign: 'center', marginTop: '50px' }}>
        <h3>{joinedData.title}</h3>
        <h2>입장 완료! 발표 시작을 기다려 주세요.</h2>
        <h3>내 이름: <span style={{ color: '#00b894' }}>{joinedData.nickname}</span></h3>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h2>청중 접속</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
        <input 
          placeholder="청중 코드 입력" 
          value={code} onChange={(e) => setCode(e.target.value)} 
          style={{ padding: '10px', width: '200px' }} 
        />
        <input 
          placeholder="이름 입력 (필수)" 
          value={name} onChange={(e) => setName(e.target.value)} 
          style={{ padding: '10px', width: '200px' }} 
        />
        <button onClick={handleJoin} style={{ padding: '10px', width: '220px', cursor: 'pointer', backgroundColor: '#28A745', color: 'white', border: 'none' }}>
          입장하기
        </button>
      </div>
    </div>
  );
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeView />} />
        <Route path="/display" element={<DisplayView />} />
        <Route path="/audience" element={<AudienceView />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;