import { BrowserRouter, Routes, Route, useSearchParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react'; 

const socket = io(`http://${window.location.hostname}:4000`);

// =========================================================================
// [나중에 삭제할 임시 코드 START] - 임시 리모컨 기능 추가!
// =========================================================================
const HomeView = () => {
  const [testRoomInfo, setTestRoomInfo] = useState(null);
  const [timerData, setTimerData] = useState(null); // ✨ 앱 화면에 타이머 상태 추가

  useEffect(() => {
    // ✨ 서버가 쏴주는 타이머를 앱(HomeView)에서만 수신
    socket.on('timer:update', (data) => setTimerData(data));
    return () => socket.off('timer:update');
  }, []);

  const handleTestCreateRoom = () => {
    socket.emit('room:create');
    socket.once('room:created', (data) => {
      setTestRoomInfo(data); 
    });
  };

  const handleStart = () => {
    // 테스트: 1분(60초)짜리 발표로 시작
    socket.emit('presentation:start', { durationMinutes: 1, questionIdentityMode: 'anonymous', questionTimingMode: 'realtime' });
  };
  const handleNextSlide = () => socket.emit('slide:next');
  const handlePrevSlide = () => socket.emit('slide:prev');

  // ✨ 타이머 포맷 함수 (0초부터 1초씩 증가)
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '100px' }}>
      <h1>KIT 웹 게이트웨이 🚀</h1>
      <p>아래에서 가상 방을 만들고, 발급된 코드로 접속 테스트를 해보세요!</p>
      
      <div style={{ marginTop: '30px', padding: '30px', border: '2px dashed #007BFF', display: 'inline-block', borderRadius: '10px' }}>
        <h3>🛠️ 백엔드 단독 테스트용 방 만들기</h3>
        <button onClick={handleTestCreateRoom} style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer', backgroundColor: '#007BFF', color: 'white', border: 'none', borderRadius: '5px' }}>
          방 생성하기 (클릭!)
        </button>
        
        {testRoomInfo && (
          <div style={{ marginTop: '20px', fontSize: '18px', backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px', textAlign: 'left' }}>
            <p><strong>👑 발표자 코드:</strong> <span style={{ color: '#0984e3' }}>{testRoomInfo.presenterCode}</span></p>
            <p><strong>🖥️ 디스플레이 코드:</strong> <span style={{ color: '#d63031' }}>{testRoomInfo.displayCode}</span></p>
            <p><strong>📱 청중 코드:</strong> <span style={{ color: '#00b894' }}>{testRoomInfo.audienceCode}</span></p>
            
            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#eccc68', borderRadius: '8px', textAlign: 'center' }}>
              <h4>📱 (임시) 발표자 앱 리모컨</h4>
              <button onClick={handleStart} style={{ margin: '5px', padding: '8px', cursor: 'pointer' }}>발표 시작</button>
              <button onClick={handlePrevSlide} style={{ margin: '5px', padding: '8px', cursor: 'pointer' }}>이전 슬라이드</button>
              <button onClick={handleNextSlide} style={{ margin: '5px', padding: '8px', cursor: 'pointer' }}>다음 슬라이드</button>
              
              {/* ✨ 기획 반영: 앱 화면에만 표시되는 증가형(Count-up) 타이머 */}
              {timerData && (
                <div style={{ 
                  marginTop: '15px', padding: '10px', borderRadius: '8px', fontSize: '20px', fontWeight: 'bold',
                  backgroundColor: timerData.isOvertime ? '#ff7675' : '#ffffff', // 설정 시간 넘으면 빨간색으로 변경
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
// [나중에 삭제할 임시 코드 END]
// =========================================================================

// PC 디스플레이 화면 (/display)
const DisplayView = () => {
  const [code, setCode] = useState('');
  const [joinedData, setJoinedData] = useState(null);
  const [isStarted, setIsStarted] = useState(false);
  const [slideIndex, setSlideIndex] = useState(1);

  const handleJoin = () => {
    socket.emit('room:join_display', { displayCode: code });
  };

  useEffect(() => {
    // 백엔드에서 전달받은 audienceCode를 이용해 QR 렌더링
    socket.on('room:joined', (data) => setJoinedData(data));

    // 발표 시작 시 화면 전환
    socket.on('presentation:started', () => setIsStarted(true));
    
    // 슬라이드 넘기기
    socket.on('slide:changed', ({ direction }) => {
      setSlideIndex((prev) => direction === 'next' ? prev + 1 : Math.max(1, prev - 1));
    });

    return () => {
      socket.off('room:joined');
      socket.off('presentation:started');
      socket.off('slide:changed');
    };
  }, []);

  // [화면 B] 발표가 시작된 후의 '슬라이드 뷰어' 화면
  if (isStarted) {
    return (
      <div style={{ padding: '20px', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f1f2f6' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>슬라이드 #{slideIndex}</h2>
        </div>
        
        {/* 임시 슬라이드 화면 영역 */}
        <div style={{ flex: 1, backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px', border: '2px solid #dfe6e9', borderRadius: '12px' }}>
          발표 자료 (Slide {slideIndex}) 화면
        </div>
      </div>
    );
  }

  if (joinedData) {
    const audienceLink = `${window.location.origin}/audience?code=${joinedData.audienceCode}`;
    return (
      <div style={{ textAlign: 'center', marginTop: '50px' }}>
        <h1>발표 대기실에 오신 것을 환영합니다</h1>
        <h2>아래 QR 코드를 스캔하거나 접속 코드를 입력해 주세요</h2>
        <div style={{ margin: '40px 0' }}>
          <QRCodeSVG value={audienceLink} size={256} />
        </div>
        <h1 style={{ fontSize: '48px', color: '#007BFF' }}>
          접속 코드: {joinedData.audienceCode}
        </h1>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h2>발표 화면 (PC) 세팅</h2>
      <input 
        placeholder="디스플레이 코드 6자리 입력" 
        value={code} onChange={(e) => setCode(e.target.value)} 
        style={{ padding: '10px', fontSize: '18px' }}
      />
      <button onClick={handleJoin} style={{ padding: '10px 20px', fontSize: '18px', marginLeft: '10px' }}>
        화면 띄우기
      </button>
    </div>
  );
};

// 청중 화면 (/audience)
const AudienceView = () => {
  const [searchParams] = useSearchParams();
  const initialCode = searchParams.get('code') || ''; 
  
  const [code, setCode] = useState(initialCode);
  const [nickname, setNickname] = useState('');
  const [joinedData, setJoinedData] = useState(null);
  const [audienceCount, setAudienceCount] = useState(0);

  const handleJoin = () => {
    socket.emit('room:join_audience', { audienceCode: code, nickname });
  };

  useEffect(() => {
    socket.on('room:joined', (data) => setJoinedData(data)); // 서버가 확정한 닉네임 받기
    socket.on('room:audience_count', (data) => setAudienceCount(data.count)); 
    
    return () => {
      socket.off('room:joined');
      socket.off('room:audience_count');
    };
  }, []);

  if (joinedData) {
    return (
      <div style={{ textAlign: 'center', marginTop: '50px' }}>
        <h2>입장 완료!</h2>
        {/* 서버가 익명으로 자동 생성해준 닉네임을 화면에 표시 */}
        <h3>내 닉네임: <span style={{ color: '#00b894' }}>{joinedData.nickname}</span></h3>
        <p>현재 청중: {audienceCount}명</p>
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
          placeholder="닉네임 (비워두면 자동 생성)" 
          value={nickname} onChange={(e) => setNickname(e.target.value)} 
          style={{ padding: '10px', width: '200px' }}
        />
        <button onClick={handleJoin} style={{ padding: '10px', width: '220px', cursor: 'pointer' }}>
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