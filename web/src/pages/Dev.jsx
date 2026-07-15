// web/src/pages/Dev.jsx
// [개발자 테스트용] 원래 App.jsx에 있던 백엔드 단독 테스트 하네스를 그대로 옮겨온 화면.
// 실제 사용자에게 노출되지 않는 /dev 경로에서만 접근한다 — 방 생성/로그인/노트저장 등을
// 프론트(모바일 앱) 없이도 소켓/REST 프로토콜을 직접 두드려볼 수 있도록 남겨둔다.
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { socket, getOrCreateUserId, API_BASE, getStoredAuth, storeAuth, clearAuth } from '../lib/socket';

export default function Dev() {
  const [roomTitle, setRoomTitle] = useState('테스트 발표 방');
  const [testRoomInfo, setTestRoomInfo] = useState(null);
  const [timerData, setTimerData] = useState(null);

  const [durationMinutes, setDurationMinutes] = useState(1);
  const [anonymous, setAnonymous] = useState(true);
  const [allowMidQuestions, setAllowMidQuestions] = useState(true);

  const [presentationFile, setPresentationFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  const [auth, setAuth] = useState({ token: null, account: null });
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');

  const [joinPresenterCode, setJoinPresenterCode] = useState('');
  const [joinPresenterName, setJoinPresenterName] = useState('발표자2');
  const [joinedPresenterInfo, setJoinedPresenterInfo] = useState(null);

  const [noteSlideIndex, setNoteSlideIndex] = useState(1);
  const [noteText, setNoteText] = useState('');
  const [noteSaveStatus, setNoteSaveStatus] = useState('');
  const [receivedNoteUpdate, setReceivedNoteUpdate] = useState(null);

  const [historyRooms, setHistoryRooms] = useState(null);
  const [historyDetail, setHistoryDetail] = useState(null);

  const activeRoomId = testRoomInfo?.roomId || joinedPresenterInfo?.roomId || null;

  useEffect(() => {
    socket.on('timer:update', (data) => setTimerData(data));
    socket.on('error', (err) => alert(`오류: ${err.message}`));
    socket.on('room:joined', (data) => setJoinedPresenterInfo(data));
    socket.on('note:saved', (data) => setReceivedNoteUpdate({ ...data, receivedAt: new Date().toLocaleTimeString() }));
    return () => {
      socket.off('timer:update');
      socket.off('error');
      socket.off('room:joined');
      socket.off('note:saved');
    };
  }, []);

  const handleLoadHistory = async () => {
    if (!auth.token) return;
    setHistoryDetail(null);
    const res = await fetch(`${API_BASE}/accounts/me/rooms`, { headers: { Authorization: `Bearer ${auth.token}` } });
    const data = await res.json();
    setHistoryRooms(data.rooms || []);
  };

  const handleLoadHistoryDetail = async (roomId) => {
    const res = await fetch(`${API_BASE}/rooms/${roomId}/history`, { headers: { Authorization: `Bearer ${auth.token}` } });
    const data = await res.json();
    setHistoryDetail(data.success ? data.history : { error: data.message });
  };

  const handleDeleteHistory = async (roomId) => {
    await fetch(`${API_BASE}/rooms/${roomId}/history`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    setHistoryRooms((prev) => (prev || []).filter((r) => r.roomId !== roomId));
    if (historyDetail?.roomId === roomId) setHistoryDetail(null);
  };

  const handleReplayFromHistory = (sourceRoomId, originalTitle) => {
    socket.emit('room:create_from_history', {
      sourceRoomId,
      title: `${originalTitle} (재발표)`,
      token: auth.token,
    });
    socket.once('room:created', (data) => {
      setTestRoomInfo(data);
      if (data.userId) localStorage.setItem('kit_userId_host', data.userId);
    });
  };

  const handleJoinAsPresenter = () => {
    const myUserId = getOrCreateUserId('kit_userId_presenter_test');
    socket.emit('room:join_presenter', { presenterCode: joinPresenterCode, name: joinPresenterName, userId: myUserId, token: auth.token });
  };

  const handleSaveNote = async () => {
    if (!activeRoomId) return;
    setNoteSaveStatus('저장 중...');
    try {
      const res = await fetch(`${API_BASE}/rooms/${activeRoomId}/slides/${noteSlideIndex}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newNote: noteText, editedByName: joinedPresenterInfo?.nickname || '방장' }),
      });
      const data = await res.json();
      setNoteSaveStatus(data.success ? '저장 완료' : `실패: ${data.message}`);
    } catch (e) {
      setNoteSaveStatus(`오류: ${e.message}`);
    }
  };

  useEffect(() => {
    const stored = getStoredAuth();
    if (!stored.token) return;
    fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${stored.token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.success) setAuth({ token: stored.token, account: { accountId: data.accountId, name: data.name } });
        else clearAuth();
      })
      .catch(() => {});
  }, []);

  const handleAuthSubmit = async () => {
    setAuthError('');
    const path = authMode === 'signup' ? '/auth/signup' : '/auth/login';
    const body = authMode === 'signup'
      ? { email: authEmail, password: authPassword, name: authName }
      : { email: authEmail, password: authPassword };

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) {
        setAuthError(data.message);
        return;
      }
      const account = { accountId: data.accountId, name: data.name };
      storeAuth(data.token, account);
      setAuth({ token: data.token, account });
      setAuthPassword('');
    } catch (e) {
      setAuthError(`요청 중 오류: ${e.message}`);
    }
  };

  const handleLogout = () => {
    clearAuth();
    setAuth({ token: null, account: null });
  };

  const handleTestCreateRoom = () => {
    const myUserId = getOrCreateUserId('kit_userId_host');
    socket.emit('room:create', { title: roomTitle, userId: myUserId, token: auth.token });
    socket.once('room:created', (data) => {
      setTestRoomInfo(data);
      if (data.userId) localStorage.setItem('kit_userId_host', data.userId);
    });
  };

  const handleStart = () => {
    socket.emit('presentation:start', {
      durationMinutes: Number(durationMinutes),
      anonymous,
      allowMidQuestions,
    });
  };
  const handleNextSlide = () => socket.emit('slide:next');
  const handlePrevSlide = () => socket.emit('slide:prev');

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
      <h1>KIT 웹 게이트웨이 🚀 (개발자 테스트)</h1>
      <p>가상 방을 만들고, 발급된 코드로 접속 테스트를 해보세요! (일반 사용자는 <Link to="/">홈</Link>을 이용해 주세요)</p>

      <div style={{ margin: '20px auto', padding: '20px', border: '2px dashed #00b894', display: 'inline-block', borderRadius: '10px', textAlign: 'left' }}>
        <h3 style={{ marginTop: 0 }}>👤 회원가입 / 로그인 테스트</h3>
        {auth.account ? (
          <div>
            <p>✅ <strong>{auth.account.name}</strong>님으로 로그인됨 (accountId: {auth.account.accountId})</p>
            <button onClick={handleLogout} style={{ padding: '8px 16px', cursor: 'pointer', marginRight: '10px' }}>로그아웃</button>
            <button onClick={handleLoadHistory} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: '#0984e3', color: 'white', border: 'none', borderRadius: '5px' }}>
              내 발표 기록 보기
            </button>

            {historyRooms && (
              <div style={{ marginTop: '15px' }}>
                {historyRooms.length === 0 ? (
                  <p style={{ color: '#999' }}>종료된 발표 기록이 없습니다.</p>
                ) : (
                  <ul style={{ paddingLeft: '20px' }}>
                    {historyRooms.map((r) => (
                      <li key={r.roomId} style={{ marginBottom: '6px' }}>
                        <button onClick={() => handleLoadHistoryDetail(r.roomId)} style={{ cursor: 'pointer', background: 'none', border: 'none', color: '#0984e3', textDecoration: 'underline', padding: 0, font: 'inherit' }}>
                          {r.title}
                        </button>
                        {' '}— 총 {r.totalTimeSeconds}초, 발표자 {r.totalPresenters}명, 청중 {r.totalAudience}명
                        {' '}
                        <button onClick={() => handleReplayFromHistory(r.roomId, r.title)} style={{ cursor: 'pointer', padding: '2px 8px', fontSize: '12px', backgroundColor: '#6c5ce7', color: 'white', border: 'none', borderRadius: '4px', marginRight: '4px' }}>
                          다시 발표하기
                        </button>
                        <button onClick={() => handleDeleteHistory(r.roomId)} style={{ cursor: 'pointer', padding: '2px 8px', fontSize: '12px', backgroundColor: '#d63031', color: 'white', border: 'none', borderRadius: '4px' }}>
                          삭제
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {historyDetail && (
              <div style={{ marginTop: '10px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                {historyDetail.error ? (
                  <p style={{ color: '#d63031' }}>❌ {historyDetail.error}</p>
                ) : (
                  <>
                    <p><strong>{historyDetail.title}</strong> (roomId: {historyDetail.roomId})</p>
                    <p>발표 자료: {historyDetail.fileUrl || '없음'} / 총 발표 시간: {historyDetail.totalTimeSeconds}초</p>
                    <p>발표자: {historyDetail.presenters.map((p) => p.name).join(', ')}</p>
                    <p>슬라이드 {historyDetail.slides.length}장 / 답변한 질문 {historyDetail.answeredQuestions.length}개</p>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '10px' }}>
              <button onClick={() => setAuthMode('login')} style={{ fontWeight: authMode === 'login' ? 'bold' : 'normal', marginRight: '10px' }}>로그인</button>
              <button onClick={() => setAuthMode('signup')} style={{ fontWeight: authMode === 'signup' ? 'bold' : 'normal' }}>회원가입</button>
            </div>
            {authMode === 'signup' && (
              <input placeholder="이름" value={authName} onChange={(e) => setAuthName(e.target.value)} style={{ padding: '8px', marginRight: '8px', marginBottom: '8px' }} />
            )}
            <input placeholder="이메일" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} style={{ padding: '8px', marginRight: '8px', marginBottom: '8px' }} />
            <input type="password" placeholder="비밀번호 (영문/숫자/특수문자 포함 8~12자)" maxLength={12} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} style={{ padding: '8px', marginRight: '8px', marginBottom: '8px' }} />
            <button onClick={handleAuthSubmit} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: '#00b894', color: 'white', border: 'none', borderRadius: '5px' }}>
              {authMode === 'signup' ? '가입하기' : '로그인'}
            </button>
            {authError && <p style={{ color: '#d63031' }}>{authError}</p>}
          </div>
        )}
      </div>

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
                        {(uploadResult.images || []).map((img) => (
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
                  border: '2px solid #333',
                }}>
                  ⏱️ 현재 발표 시간 - {formatTime(timerData.elapsedSeconds)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ margin: '20px auto', padding: '20px', border: '2px dashed #e17055', display: 'inline-block', borderRadius: '10px', textAlign: 'left' }}>
        <h3 style={{ marginTop: 0 }}>🙋 (다른 탭에서) 발표자 코드로 두 번째 발표자로 참가</h3>
        <p style={{ fontSize: '13px', color: '#636e72', marginTop: 0 }}>
          위에서 만든 방의 "발표자 코드"를 다른 브라우저 탭에 붙여넣고 여기로 참가하면, 아래 노트 저장 기능이
          같은 방의 다른 발표자 사이에 실시간으로 반영되는지 두 탭으로 직접 확인할 수 있습니다.
        </p>
        <input placeholder="발표자 코드" value={joinPresenterCode} onChange={(e) => setJoinPresenterCode(e.target.value)} style={{ padding: '8px', marginRight: '8px' }} />
        <input placeholder="이름" value={joinPresenterName} onChange={(e) => setJoinPresenterName(e.target.value)} style={{ padding: '8px', marginRight: '8px' }} />
        <button onClick={handleJoinAsPresenter} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: '#e17055', color: 'white', border: 'none', borderRadius: '5px' }}>
          참가하기
        </button>
        {joinedPresenterInfo && (
          <p style={{ marginBottom: 0 }}>
            ✅ <strong>{joinedPresenterInfo.title}</strong>에 {joinedPresenterInfo.role}로 참가됨 (roomId: {joinedPresenterInfo.roomId})
            {' — 자료: '}
            {joinedPresenterInfo.currentFileUrl ? `업로드됨 (${joinedPresenterInfo.slideCount}장, 대본 ${joinedPresenterInfo.hasScript ? '있음' : '없음'})` : '아직 없음'}
          </p>
        )}
      </div>

      {activeRoomId && (
        <div style={{ margin: '20px auto', padding: '20px', border: '2px dashed #6c5ce7', display: 'inline-block', borderRadius: '10px', textAlign: 'left' }}>
          <h3 style={{ marginTop: 0 }}>📝 발표자 노트 저장 테스트 (roomId: {activeRoomId})</h3>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ marginRight: '10px' }}>슬라이드 번호:</label>
            <input type="number" min="1" value={noteSlideIndex} onChange={(e) => setNoteSlideIndex(e.target.value)} style={{ width: '50px', padding: '6px', marginRight: '10px' }} />
            <input placeholder="노트 내용" value={noteText} onChange={(e) => setNoteText(e.target.value)} style={{ padding: '6px', width: '250px', marginRight: '10px' }} />
            <button onClick={handleSaveNote} style={{ padding: '6px 16px', cursor: 'pointer', backgroundColor: '#6c5ce7', color: 'white', border: 'none', borderRadius: '5px' }}>
              노트 저장
            </button>
            {noteSaveStatus && <span style={{ marginLeft: '10px' }}>{noteSaveStatus}</span>}
          </div>
          <div style={{ padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '6px' }}>
            <strong>실시간으로 받은 note:saved 이벤트:</strong>{' '}
            {receivedNoteUpdate
              ? `[슬라이드 #${receivedNoteUpdate.slideIndex}] "${receivedNoteUpdate.newNote}" (${receivedNoteUpdate.editedByName}, ${receivedNoteUpdate.receivedAt})`
              : '아직 없음'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '40px', paddingBottom: '60px' }}>
        <Link to="/display" target="_blank" style={{ padding: '15px 30px', background: '#343a40', color: 'white', textDecoration: 'none', borderRadius: '8px', fontSize: '18px' }}>
          🖥️ PC 디스플레이 열기
        </Link>
        <Link to="/audience" target="_blank" style={{ padding: '15px 30px', background: '#28A745', color: 'white', textDecoration: 'none', borderRadius: '8px', fontSize: '18px' }}>
          📱 청중 화면 열기
        </Link>
      </div>
    </div>
  );
}
