// web/src/App.jsx
import { BrowserRouter, Routes, Route, useSearchParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react'; 

const socket = io(`http://${window.location.hostname}:4000`);

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

  useEffect(() => {
    socket.on('timer:update', (data) => setTimerData(data));
    socket.on('error', (err) => alert(`오류: ${err.message}`));
    return () => {
      socket.off('timer:update');
      socket.off('error');
    };
  }, []);

  const handleTestCreateRoom = () => {
    socket.emit('room:create', { title: roomTitle });
    socket.once('room:created', (data) => setTestRoomInfo(data));
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

  const handleJoin = () => {
    socket.emit('room:join_display', { displayCode: code });
  };

  useEffect(() => {
    socket.on('room:joined', (data) => setJoinedData(data));
    socket.on('presentation:started', () => setIsStarted(true));
    socket.on('slide:changed', (data) => setSlideIndex(data.slideIndex));

    // ✨ 명세서 동기화: 최신 이벤트명 수신 및 nickname 접근 적용
    socket.on('question:answering_started', (data) => setActiveQuestion(data));
    socket.on('question:answered_list_update', () => setActiveQuestion(null)); 
    socket.on('error', (err) => alert(err.message));

    return () => {
      socket.off('room:joined');
      socket.off('presentation:started');
      socket.off('slide:changed');
      socket.off('question:answering_started');
      socket.off('question:answered_list_update');
      socket.off('error');
    };
  }, []);

  if (isStarted) {
    return (
      <div style={{ padding: '20px', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f1f2f6', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>{joinedData?.title || '발표 진행 중'} - 슬라이드 #{slideIndex}</h2>
        </div>
        
        <div style={{ flex: 1, backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px', border: '2px solid #dfe6e9', borderRadius: '12px' }}>
          발표 자료 (Slide {slideIndex}) 화면
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

  const handleJoin = () => {
    socket.emit('room:join_audience', { audienceCode: code, name });
  };

  const handleSubmitQuestion = () => {
    if (!questionText.trim()) return;
    socket.emit('question:submit', { text: questionText, category: 'during' });
    setQuestionText('');
  };

  useEffect(() => {
    socket.on('room:joined', (data) => setJoinedData(data)); 
    socket.on('presentation:started', () => setIsStarted(true));
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
      socket.off('error');
      socket.off('question:answering_started');
      socket.off('question:answered_list_update');
    };
  }, []);

  if (isStarted) {
    return (
      <div style={{ display: 'flex', height: '100vh', backgroundColor: '#f1f2f6' }}>
        <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3>{joinedData?.title} - 내 슬라이드 뷰어</h3>
            <div>
              <button onClick={() => setLocalSlideIndex(prev => Math.max(1, prev - 1))} style={{ padding: '8px 15px', marginRight: '5px' }}>이전</button>
              <span>Slide {localSlideIndex}</span>
              <button onClick={() => setLocalSlideIndex(prev => prev + 1)} style={{ padding: '8px 15px', marginLeft: '5px' }}>다음</button>
            </div>
          </div>
          <div style={{ flex: 1, backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', borderRadius: '12px', border: '1px solid #ddd' }}>
            자유 열람 슬라이드 #{localSlideIndex} 화면
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
            <textarea 
              value={questionText} 
              onChange={(e) => setQuestionText(e.target.value)} 
              placeholder="궁금한 점을 입력해주세요"
              style={{ width: '100%', height: '80px', padding: '10px', boxSizing: 'border-box', resize: 'none', marginBottom: '10px' }}
            />
            <button onClick={handleSubmitQuestion} style={{ width: '100%', padding: '10px', backgroundColor: '#28A745', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '4px' }}>
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