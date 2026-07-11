const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { EVENTS } = require('../shared/events.js');
const db = require('./database.js');

const app = express();
app.use(cors());
app.use(express.json()); // REST API에서 JSON 바디를 읽기 위해 필수!

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT"] }
});

// 랜덤 방 코드 6자리 생성 함수
const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// =========================================================================
// [REST API 구역] 파일 업로드, AI 처리, 대본 수정 등 실시간성이 없는 무거운 작업
// =========================================================================

// 1. 대본 업로드 (자동 분배 트리거)
app.post('/rooms/:roomId/script', (req, res) => {
  const { roomId } = req.params;
  // TODO: 파일 저장 및 텍스트 추출 후 슬라이드 개수에 맞게 분할하여 DB(slides) 저장
  // (임시 목업 응답)
  const mockNotes = [{ slideIndex: 1, text: '자동 분할된 첫 번째 슬라이드 대본입니다.' }];
  
  // 처리가 끝나면 소켓으로 앱에 "준비 완료" 알림만 가볍게 쏴줌
  io.to(roomId).emit(EVENTS.NOTES_READY, { slideNotes: mockNotes, source: 'auto_split' });
  res.json({ success: true, message: '대본 업로드 및 분할 완료' });
});

// 2. AI 요약/생성 버튼 클릭
app.post('/rooms/:roomId/slides/note/ai', (req, res) => {
  const { roomId } = req.params;
  const { hasScript } = req.body;
  // TODO: Gemini API 태우고 DB 업데이트 로직
  const mockNotes = [{ slideIndex: 1, text: 'AI가 요약한 핵심 키워드 1, 2, 3' }];
  
  io.to(roomId).emit(EVENTS.NOTES_READY, { slideNotes: mockNotes, source: hasScript ? 'ai_summarize' : 'ai_generate' });
  res.json({ success: true, message: 'AI 처리 완료' });
});

// 3. 발표자가 노트를 직접 수동으로 수정 후 저장
app.put('/rooms/:roomId/slides/:slideIndex/note', (req, res) => {
  const { roomId, slideIndex } = req.params;
  const { newNote, editedByName } = req.body;
  
  db.prepare('UPDATE slides SET ai_summary_note = ? WHERE room_id = ? AND slide_index = ?')
    .run(newNote, roomId, slideIndex);
    
  // 다른 공동 발표자들의 화면에도 수정되었다는 알림(토스트)을 띄우기 위해 브로드캐스트
  io.to(roomId).emit(EVENTS.NOTE_SAVED, { slideIndex: parseInt(slideIndex, 10), editedByName });
  res.json({ success: true });
});


// =========================================================================
// [Socket.io 구역] 실시간 상태 동기화 및 Q&A 시스템
// =========================================================================

io.on('connection', (socket) => {
  console.log(`클라이언트 연결됨: ${socket.id}`);

  // ----------------------------------------------------
  // [1] 방 생성 & 입장 로직
  // ----------------------------------------------------
  socket.on(EVENTS.ROOM_CREATE, () => {
    const roomId = generateCode();
    const presenterCode = generateCode();
    const displayCode = generateCode();
    const audienceCode = generateCode();

    // 방 만든 사람이 최초의 current_presenter_id 권한을 가짐
    const stmt = db.prepare(`
      INSERT INTO rooms (room_id, host_device_id, current_presenter_id, presenter_code, display_code, audience_code, status)
      VALUES (?, ?, ?, ?, ?, ?, 'wait')
    `);
    stmt.run(roomId, socket.id, socket.id, presenterCode, displayCode, audienceCode);

    socket.join(roomId);
    socket.emit(EVENTS.ROOM_CREATED, { roomId, displayCode, audienceCode, presenterCode });
    console.log(`[방 생성] Room: ${roomId} (방장: ${socket.id})`);
  });

  socket.on(EVENTS.ROOM_JOIN_PRESENTER, ({ roomId, presenterCode, name }) => {
    const room = db.prepare('SELECT * FROM rooms WHERE room_id = ? AND presenter_code = ?').get(roomId, presenterCode);
    if (!room) return socket.emit('error', { message: '방을 찾을 수 없거나 코드가 틀렸습니다.' });

    db.prepare('INSERT OR REPLACE INTO users (user_id, room_id, role, nickname) VALUES (?, ?, ?, ?)')
      .run(socket.id, roomId, 'presenter', name);

    socket.join(roomId);
    socket.emit(EVENTS.ROOM_JOINED, {
      roomId, role: 'presenter', userId: socket.id, nickname: name, currentFileUrl: room.file_url || null
    });
  });

  socket.on(EVENTS.ROOM_JOIN_DISPLAY, ({ displayCode }) => {
    const room = db.prepare('SELECT * FROM rooms WHERE display_code = ?').get(displayCode);
    if (!room) return socket.emit('error', { message: '잘못된 디스플레이 코드입니다.' });

    db.prepare('INSERT OR REPLACE INTO users (user_id, room_id, role) VALUES (?, ?, ?)')
      .run(socket.id, room.room_id, 'display');

    socket.join(room.room_id);
    socket.emit(EVENTS.ROOM_JOINED, {
      roomId: room.room_id, role: 'display', userId: socket.id, currentFileUrl: room.file_url || null, audienceCode: room.audience_code
    });
  });

  socket.on(EVENTS.ROOM_JOIN_AUDIENCE, ({ audienceCode, nickname }) => {
    const room = db.prepare('SELECT * FROM rooms WHERE audience_code = ?').get(audienceCode);
    if (!room) return socket.emit('error', { message: '잘못된 코드입니다.' });

    const roomId = room.room_id;
    let finalNickname = nickname;

    // ✨ 기획 반영: 익명 모드이거나 이름을 안 보냈으면 자동 생성
    if (room.question_identity_mode === 'anonymous' || !finalNickname) {
      finalNickname = `익명_${Math.floor(Math.random() * 9000) + 1000}`;
    }

    db.prepare('INSERT OR REPLACE INTO users (user_id, room_id, role, nickname) VALUES (?, ?, ?, ?)')
      .run(socket.id, roomId, 'audience', finalNickname);

    socket.join(roomId);

    // ✨ 기획 반영: 확정된 닉네임을 청중에게 다시 내려줌
    socket.emit(EVENTS.ROOM_JOINED, {
      roomId, role: 'audience', userId: socket.id, nickname: finalNickname, currentFileUrl: room.file_url || null
    });

    const countQuery = db.prepare("SELECT COUNT(*) as count FROM users WHERE room_id = ? AND role = 'audience'").get(roomId);
    io.to(roomId).emit(EVENTS.AUDIENCE_COUNT_UPDATE, { count: countQuery.count });
  });

  // ----------------------------------------------------
  // [2] 설정 변경 & 발표 시작/종료 (권한 검증 포함)
  // ----------------------------------------------------
  socket.on(EVENTS.ROOM_SETTINGS_UPDATE, (payload) => {
    const room = db.prepare('SELECT * FROM rooms WHERE current_presenter_id = ?').get(socket.id);
    if (!room) return; // 권한이 없으면 무시

    db.prepare(`UPDATE rooms SET duration_minutes = ?, question_identity_mode = ?, question_timing_mode = ? WHERE room_id = ?`)
      .run(payload.durationMinutes, payload.questionIdentityMode, payload.questionTimingMode, room.room_id);

    io.to(room.room_id).emit(EVENTS.ROOM_SETTINGS_UPDATED, payload);
  });

  socket.on(EVENTS.PRESENTATION_START, (payload) => {
    const room = db.prepare('SELECT * FROM rooms WHERE current_presenter_id = ?').get(socket.id);
    if (!room) return;

    // 설정 최종 고정 및 진행 상태로 변경
    const startedAt = Date.now();
    db.prepare(`UPDATE rooms SET duration_minutes = ?, question_identity_mode = ?, question_timing_mode = ?, status = 'progress', started_at = ? WHERE room_id = ?`)
      .run(payload.durationMinutes, payload.questionIdentityMode, payload.questionTimingMode, startedAt, room.room_id);

    io.to(room.room_id).emit(EVENTS.PRESENTATION_STARTED, {
      startedAt, ...payload, currentFileUrl: room.file_url
    });
  });

  socket.on(EVENTS.PRESENTATION_END, () => {
    const room = db.prepare('SELECT * FROM rooms WHERE current_presenter_id = ?').get(socket.id);
    if (!room || !room.started_at) return;

    const endTime = Date.now();
    const totalElapsedSeconds = Math.floor((endTime - room.started_at) / 1000);
    
    // ✨ 기획 반영: 종료 시점의 발표자 수, 청중 수를 계산해서 방 기록에 영구 보존
    const presenterCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE room_id = ? AND role = 'presenter'").get(room.room_id).c;
    const audienceCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE room_id = ? AND role = 'audience'").get(room.room_id).c;

    db.prepare(`UPDATE rooms SET status = 'end', ended_at = ?, total_time_seconds = ?, total_presenters = ?, total_audience = ? WHERE room_id = ?`)
      .run(endTime, totalElapsedSeconds, presenterCount, audienceCount, room.room_id);

    io.to(room.room_id).emit(EVENTS.PRESENTATION_ENDED, { totalElapsedSeconds, presenterCount, audienceCount });
  });

  // ----------------------------------------------------
  // [3] Q&A 시스템
  // ----------------------------------------------------
  socket.on(EVENTS.QUESTION_SUBMIT, ({ text, category }) => {
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(socket.id);
    if (!user) return;

    const info = db.prepare('INSERT INTO questions (room_id, author_name, content, created_at) VALUES (?, ?, ?, ?)')
      .run(user.room_id, user.nickname, text, Date.now());

    // 앱(발표자)들에게 새 질문 도착 알림
    io.to(user.room_id).emit(EVENTS.QUESTION_NEW, {
      questionId: info.lastInsertRowid, text, nickname: user.nickname, category, createdAt: Date.now()
    });
  });

  socket.on(EVENTS.QUESTION_ANSWER_SELECT, ({ questionId }) => {
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(socket.id);
    if (!user) return;

    // 선택된 시간(selected_at)을 기록하여 이 값을 기준으로 내림차순 정렬할 수 있게 함
    db.prepare('UPDATE questions SET is_selected = 1, selected_at = ? WHERE question_id = ?').run(Date.now(), questionId);

    // ✨ 기획 반영: 이 방에서 채택된 모든 질문을 최신순(내림차순)으로 긁어오기
    const answered = db.prepare(`
      SELECT question_id as questionId, content as text, author_name as nickname, selected_at as answeredAt 
      FROM questions WHERE room_id = ? AND is_selected = 1 ORDER BY selected_at DESC
    `).all(user.room_id);

    // PC웹과 청중웹 화면 상단에 누적 리스트 업데이트
    io.to(user.room_id).emit(EVENTS.ANSWERED_QUESTIONS_UPDATE, { answered });
  });

  // ----------------------------------------------------
  // [4] 연결 종료 처리
  // ----------------------------------------------------
  socket.on('disconnect', () => {
    console.log(`연결 끊김: ${socket.id}`);
    const user = db.prepare('SELECT room_id, role FROM users WHERE user_id = ?').get(socket.id);

    if (user) {
      db.prepare('DELETE FROM users WHERE user_id = ?').run(socket.id);
      if (user.role === 'audience') {
        const countQuery = db.prepare("SELECT COUNT(*) as count FROM users WHERE room_id = ? AND role = 'audience'").get(user.room_id);
        io.to(user.room_id).emit(EVENTS.AUDIENCE_COUNT_UPDATE, { count: countQuery.count });
      }
    }
  });
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`KIT 백엔드 서버 구동 중: http://localhost:${PORT}`);
});