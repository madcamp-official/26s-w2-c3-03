import { BrowserRouter, Routes, Route, useSearchParams, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react'; 

const socket = io(`http://${window.location.hostname}:4000`);

// =========================================================================
// [나중에 삭제할 임시 코드 START]
// =========================================================================
const HomeView = () => {
  const [testRoomInfo, setTestRoomInfo] = useState(null);

  const handleTestCreateRoom = () => {
    socket.emit('room:create');
    socket.once('room:created', (data) => {
      setTestRoomInfo(data); 
    });
  };

  return (
    <div style={{ textAlign: 'center', marginTop: '100px' }}>
      <h1>KIT 웹 게이트웨이 🚀</h1>
      <p>아래에서 가상 방을 만들고, 발급된 코드로 접속 테스트를 해보세요!</p>
      
      <div style={{ marginTop: '30px', padding: '30px', border: '2px dashed #007BFF', display: 'inline-block', borderRadius: '10px' }}>
        <h3>🛠️ 백엔드 단독 테스트용 방 만들기</h3>
        <button 
          onClick={handleTestCreateRoom} 
          style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer', backgroundColor: '#007BFF', color: 'white', border: 'none', borderRadius: '5px' }}
        >
          방 생성하기 (클릭!)
        </button>
        
        {testRoomInfo && (
          <div style={{ marginTop: '20px', fontSize: '18px', backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px', textAlign: 'left' }}>
            <p><strong>👑 발표자 코드 (앱용):</strong> <span style={{ color: '#0984e3' }}>{testRoomInfo.presenterCode}</span></p>
            <p><strong>🖥️ 디스플레이 코드 (PC용):</strong> <span style={{ color: '#d63031' }}>{testRoomInfo.displayCode}</span></p>
            <p><strong>📱 청중 코드 (모바일용):</strong> <span style={{ color: '#00b894' }}>{testRoomInfo.audienceCode}</span></p>
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

  const handleJoin = () => {
    socket.emit('room:join_display', { displayCode: code });
  };

  useEffect(() => {
    // 백엔드에서 전달받은 audienceCode를 이용해 QR 렌더링
    socket.on('room:joined', (data) => setJoinedData(data));
    return () => socket.off('room:joined');
  }, []);

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