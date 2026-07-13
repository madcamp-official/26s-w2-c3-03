// server/index.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { jsonrepair } = require('jsonrepair');

const { EVENTS } = require('../shared/events.js');
const db = require('./database.js');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT"] },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  }
});

const generateCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const generateUserId = () => 'usr_' + Math.random().toString(36).substring(2, 10);

const roomTimers = {}; 
const roomSlides = {};

const multer = require('multer');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const upload = multer({ dest: 'uploads/' });

const mammoth = require('mammoth');
const path = require('path');

// =========================================================================
// [AI 헬퍼 함수 구역] - 재시도 로직, 방어 로직 추가
// =========================================================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callAiApiWithRetry(prompt, options = {}) {
  const {
    isJsonExpected = false, 
    maxRetries = 2,
    pdfBase64 = null,
    jsonSchema = null
  } = options;

  const modelConfig = { model: "gemini-3.1-flash-lite" };
  if (isJsonExpected) {
    modelConfig.generationConfig = {
      responseMimeType: "application/json",
      maxOutputTokens: 65536,
      ...(jsonSchema && { responseSchema: jsonSchema })
    };
  }
  const model = genAI.getGenerativeModel(modelConfig);

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      let result;
      if (pdfBase64) {
        result = await model.generateContent([
          { inlineData: { data: pdfBase64, mimeType: "application/pdf" } },
          prompt
        ]);
      } else {
        result = await model.generateContent(prompt);
      }

      const responseText = result.response.text();

      if (isJsonExpected) {
        try {
          let cleanJsonStr = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

          const jsonMatch = cleanJsonStr.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            cleanJsonStr = jsonMatch[0];
          }

          // ✨ 이스케이프 안 된 따옴표(대본 인용구), raw 줄바꿈, 응답 잘림(MAX_TOKENS)까지
          // 규칙 기반으로 복구. 직접 정규식으로 짜면 놓치는 케이스가 많아 라이브러리로 위임.
          const parsed = JSON.parse(jsonrepair(cleanJsonStr));

          // ✨ 형태 검증: 이상하면 throw → 바깥 catch가 잡아서 재시도
          if (!Array.isArray(parsed) || parsed.some(n => typeof n.slideIndex !== 'number' || typeof n.text !== 'string')) {
            throw new Error('JSON 형태가 기대와 다릅니다 (slideIndex/text 누락).');
          }

          return parsed;

        } catch (parseError) {
          // ✨ finishReason 확인: MAX_TOKENS면 응답이 잘린 것
          console.error(`\n🚨 [DEBUG] finishReason: ${result.response.candidates?.[0]?.finishReason}`);
          console.error(`🚨 [DEBUG: JSON 파싱 에러] AI가 뱉은 원본 응답 텍스트:\n${responseText}\n`);
          throw new Error(`JSON 파싱 실패: ${parseError.message}`);
        }
      }
      return responseText;

    } catch (error) {
      console.error(`[AI 호출 시도 ${attempt} 실패]:`, error.message);
      
      if (attempt > maxRetries) {
        throw new Error(`AI 처리 최종 실패 (총 ${attempt}회 시도): ${error.message}`);
      }
      
      const waitTime = Math.pow(2, attempt - 1) * 1000;
      console.log(`일시적 오류 발생. ${waitTime}ms 후 재시도합니다...`);
      await delay(waitTime);
    }
  }
}

// =========================================================================
// [REST API 구역]
// =========================================================================

// 1. 발표 자료(PDF) 단독 업로드 API
app.post('/rooms/:roomId/presentation', upload.single('presentationFile'), async (req, res) => {
  const { roomId } = req.params;
  const savedPdfPath = `uploads/${roomId}_presentation.pdf`;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '발표 자료(PDF)는 필수입니다.' });
    }

    // 나중에 대본 분석을 위해 PDF 파일을 방(Room) 고유 이름으로 저장해둠
    fs.renameSync(req.file.path, savedPdfPath);

    const pdfBase64 = fs.readFileSync(savedPdfPath).toString("base64");

    const prompt = `첨부된 PDF 문서의 전체 페이지(슬라이드) 수가 총 몇 장인지 숫자만 대답해 주세요. 예: 15`;
    const countText = await callAiApiWithRetry(prompt, { isJsonExpected: false, pdfBase64 });
    const slideCount = parseInt(countText.trim(), 10);

    console.log(`[DEBUG: /presentation] ✅ Gemini 파악 완료 -> 총 ${slideCount}장!`);

    if (isNaN(slideCount) || slideCount <= 0) {
      throw new Error('슬라이드 수를 파악할 수 없습니다.');
    }

    const stmt = db.prepare('INSERT OR REPLACE INTO slides (slide_id, room_id, slide_index, original_note) VALUES (?, ?, ?, ?)');
    
    const insertNotes = db.transaction(() => {
      for (let i = 1; i <= slideCount; i++) {
        const slideId = `${roomId}_${i}`;
        stmt.run(slideId, roomId, i, ''); // 대본은 빈 칸으로 자리만 만들어 둠
      }
    });
    insertNotes();

    // ✨ [핵심 수정] 빈 대본 정보를 프론트에 소켓으로 쏘지 않도록 EVENTS.NOTES_READY 방출 줄 삭제!
    // 프론트엔드는 아래 HTTP 응답만 받고 완료 처리를 진행하도록 유도합니다.
    const responsePayload = { success: true, message: '발표 자료 분석 완료', slideCount: slideCount, hasScript: true };
    res.json(responsePayload);
    console.log(`[DEBUG: /presentation] 📤 프론트엔드로 응답 전송:`, responsePayload);

  } catch (error) {
    console.error('발표 자료 처리 중 에러:', error);
    if (fs.existsSync(savedPdfPath)) fs.unlinkSync(savedPdfPath);
    res.status(500).json({ success: false, message: '발표 자료를 분석하는 중 에러가 발생했습니다.' });
  }
});


// 2. 대본 단독 업로드 API
app.post('/rooms/:roomId/script', upload.single('scriptFile'), async (req, res) => {
  const { roomId } = req.params;
  const savedPdfPath = `uploads/${roomId}_presentation.pdf`;
  const scriptFilePath = req.file ? req.file.path : null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '대본 파일이 필요합니다.' });
    }

    if (!fs.existsSync(savedPdfPath)) {
      return res.status(400).json({ success: false, message: '발표 자료(PDF)를 먼저 업로드해야 합니다.' });
    }

    // ✨ [핵심 1] DB에서 해당 방(roomId)에 생성된 슬라이드 개수를 직접 세어옵니다.
    const countRow = db.prepare('SELECT COUNT(*) as count FROM slides WHERE room_id = ?').get(roomId);
    const slideCount = countRow.count;

    if (slideCount === 0) {
      return res.status(400).json({ success: false, message: 'DB에 슬라이드 정보가 없습니다. 발표 자료를 다시 업로드해 주세요.' });
    }

    const pdfBase64 = fs.readFileSync(savedPdfPath).toString("base64");
    const ext = path.extname(req.file.originalname).toLowerCase();
    let fullScript = '';

    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: scriptFilePath });
      fullScript = result.value;
    } else if (ext === '.txt') {
      fullScript = fs.readFileSync(scriptFilePath, 'utf-8');
    } else {
      return res.status(400).json({ success: false, message: '지원하지 않는 대본 파일 형식입니다. (DOCX, TXT만 가능)' });
    }

    console.log(`[DEBUG: /script] 📝 텍스트 추출 완료! (총 글자 수: ${fullScript.length}자)`);

    if (!fullScript || fullScript.trim() === '') {
      return res.status(400).json({ success: false, message: '대본 파일에서 텍스트를 추출할 수 없습니다.' });
    }
    
    // ✨ [핵심 2] 방금 구한 slideCount를 프롬프트에 주입하여 AI의 분할 정확도를 극대화합니다!
    const prompt = `당신은 발표 자료와 대본을 매칭하는 전문 어시스턴트입니다.

    아래는 발표 대본 전문입니다. 첨부된 PDF는 이 발표에서 사용할 슬라이드 자료이며, 총 ${slideCount}장입니다.

    당신의 임무: 대본 전체를 처음부터 끝까지 하나도 빠짐없이, 각 슬라이드의 내용과 논리적으로 대응되도록 ${slideCount}개 구간으로 나누세요.

    규칙:
    - 반드시 정확히 ${slideCount}개 항목을 출력하세요 (slideIndex 1부터 ${slideCount}까지 빠짐없이).
    - 각 슬라이드에 대응하는 대본이 명확하지 않으면, 앞뒤 문맥상 가장 자연스러운 위치에 배치하세요.
    - 대본 원문의 표현을 최대한 그대로 유지하고, 임의로 요약하거나 새로운 내용을 추가하지 마세요.
    - 한 슬라이드에 배정할 내용이 전혀 없다면 text를 빈 문자열로 두세요.

    출력 형식:
    - 반드시 아래 형식의 JSON 배열만 출력하세요. 다른 설명, 인사말, 마크다운 코드블록은 절대 포함하지 마세요.
    - 각 항목은 { "slideIndex": 숫자, "text": "해당 구간 대본" } 형태입니다.

    예시:
    [
      { "slideIndex": 1, "text": "안녕하세요, 오늘 발표를 시작하겠습니다..." },
      { "slideIndex": 2, "text": "먼저 프로젝트 배경을 말씀드리면..." }
    ]

    [대본 전문]
    ${fullScript}`;

    // ✨ Gemini에게 강제할 응답 스키마
    const slideNotesSchema = {
      type: "array",
      items: {
        type: "object",
        properties: {
          slideIndex: { type: "integer" },
          text: { type: "string" }
        },
        required: ["slideIndex", "text"]
      }
    };

    const slideNotes = await callAiApiWithRetry(prompt, { 
      isJsonExpected: true, 
      pdfBase64, 
      jsonSchema: slideNotesSchema 
    });
    console.log(`[DEBUG: /script] ✅ Gemini 매칭 완료! 반환된 배열 길이: ${slideNotes.length}`);

    // ✨ [핵심 3] INSERT OR REPLACE 대신 UPDATE를 사용하여 기존에 만들어둔 빈 방에 텍스트만 덮어씌웁니다.
    const stmt = db.prepare('UPDATE slides SET original_note = ? WHERE room_id = ? AND slide_index = ?');
    const updateNotes = db.transaction(() => {
      for (const note of slideNotes) {
        stmt.run(note.text, roomId, note.slideIndex);
      }
    });
    updateNotes();
    console.log(`[DEBUG: /script] 💾 DB 대본 UPDATE 완료`);

    io.to(roomId).emit(EVENTS.NOTES_READY, { slideNotes, source: 'ai_context_split' });
    console.log(`[DEBUG: /script] 📡 프론트엔드로 소켓 이벤트(NOTES_READY) 방출 완료`);
    
    // ✨ [핵심 4] DB에서 가져온 정확한 slideCount를 프론트엔드에 응답합니다.
    // slideNotes도 같이 실어서, 소켓 재연결로 NOTES_READY를 놓쳐도 REST 응답만으로 화면을 갱신할 수 있게 함.
    const responsePayload = { success: true, message: '대본 AI 매칭 완료', slideCount: slideCount, hasScript: true, slideNotes }
    res.json(responsePayload);
    console.log(`[DEBUG: /script] 📤 프론트엔드로 응답 전송:`, responsePayload);

  } catch (error) {
    console.error('대본 처리 중 에러:', error);
    res.status(500).json({ success: false, message: '대본을 분석하는 중 에러가 발생했습니다.' });
  } finally {
    if (scriptFilePath && fs.existsSync(scriptFilePath)) {
      fs.unlinkSync(scriptFilePath); 
    }
    if (fs.existsSync(savedPdfPath)) {
      fs.unlinkSync(savedPdfPath);   
    }
  }
});


// 3. AI 노트 요약/생성 API
app.post('/rooms/:roomId/slides/note/ai', async (req, res) => {
  const { roomId } = req.params;
  const { hasScript } = req.body; 

  try {
    const slides = db.prepare('SELECT * FROM slides WHERE room_id = ? ORDER BY slide_index ASC').all(roomId);
    
    if (slides.length === 0) {
      return res.status(404).json({ success: false, message: '처리할 슬라이드/대본 데이터가 없습니다.' });
    }

    const updateStmt = db.prepare('UPDATE slides SET ai_summary_note = ? WHERE slide_id = ?');

    const aiPromises = slides.map(async (slide) => {
      let prompt = '';
      
      if (hasScript) {
        prompt = `당신은 발표를 돕는 최고의 어시스턴트입니다. 다음 발표 대본을 발표자가 한눈에 보기 쉽게 '핵심 키워드 위주의 개조식(Bullet points)'으로 요약해 주세요. 너무 길지 않게 3~4줄로 부탁합니다.\n\n[원본 대본]\n${slide.original_note}`;
      } else {
        prompt = `당신은 발표를 돕는 최고의 어시스턴트입니다. 현재 슬라이드의 내용을 기반으로 자연스러운 발표용 스크립트(대본)를 짧게 3~4문장으로 작성해 주세요.`; 
      }

      // 새로 만든 헬퍼 함수 활용 (텍스트 기대)
      const aiSummary = await callAiApiWithRetry(prompt, { isJsonExpected: false });
      
      updateStmt.run(aiSummary, slide.slide_id);
      return { slideIndex: slide.slide_index, text: aiSummary };
    });

    const resolvedAiNotes = await Promise.all(aiPromises);
    resolvedAiNotes.sort((a, b) => a.slideIndex - b.slideIndex);

    const source = hasScript ? 'ai_summarize' : 'ai_generate';
    io.to(roomId).emit(EVENTS.NOTES_READY, { slideNotes: resolvedAiNotes, source });
    
    res.json({ success: true, message: 'Gemini AI 처리 완료', slideNotes: resolvedAiNotes });

  } catch (error) {
    console.error('AI 처리 중 에러:', error);
    res.status(500).json({ success: false, message: 'AI 요약 처리 중 문제가 발생했습니다.' });
  }
});


app.put('/rooms/:roomId/slides/:slideIndex/note', (req, res) => {
  const { roomId, slideIndex } = req.params;
  const { newNote, editedByName } = req.body;
  db.prepare('UPDATE slides SET ai_summary_note = ? WHERE room_id = ? AND slide_index = ?').run(newNote, roomId, slideIndex);
  io.to(roomId).emit(EVENTS.NOTE_SAVED, { slideIndex: parseInt(slideIndex, 10), editedByName });
  res.json({ success: true });
});

app.get('/rooms/:roomId/questions', (req, res) => {
  const { roomId } = req.params;
  const questions = db.prepare(`
    SELECT question_id as questionId, content as text, author_name as nickname, status, created_at as createdAt, selected_at as answeredAt, completed_at as completedAt
    FROM questions WHERE room_id = ? ORDER BY created_at DESC
  `).all(roomId);

  const formattedQuestions = questions.map(q => ({
    ...q,
    questionId: String(q.questionId) 
  }));

  res.json({ success: true, questions: formattedQuestions });
});

// =========================================================================
// [Socket.io 구역]
// =========================================================================

function broadcastPresenterList(roomId) {
  const room = db.prepare('SELECT current_presenter_id FROM rooms WHERE room_id = ?').get(roomId);
  if (!room) return;
  const presenters = db.prepare("SELECT user_id, name FROM users WHERE room_id = ? AND role IN ('host', 'presenter')").all(roomId);
  
  const list = presenters.map(p => ({
    userId: p.user_id,
    name: p.name || '방장',
    isCurrentPresenter: p.user_id === room.current_presenter_id
  }));
  io.to(roomId).emit(EVENTS.PRESENTER_LIST_UPDATE, { presenters: list });
}

io.on('connection', (socket) => {
  console.log(`클라이언트 연결됨: ${socket.id}`);

  // ----------------------------------------------------
  // [1] 방 생성 & 입장 로직
  // ----------------------------------------------------
  socket.on(EVENTS.ROOM_CREATE, (payload = {}) => {
    const { title, name } = payload; 

    if (!title || title.trim() === '') {
      return socket.emit('error', { message: '방 제목을 입력해주세요.' });
    }

    const roomId = generateCode();
    const presenterCode = generateCode();
    const displayCode = generateCode();
    const audienceCode = generateCode();
    const userId = generateUserId(); 

    const stmt = db.prepare(`
      INSERT INTO rooms (room_id, title, host_user_id, current_presenter_id, presenter_code, display_code, audience_code, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'wait')
    `);
    stmt.run(roomId, title, userId, userId, presenterCode, displayCode, audienceCode);

    db.prepare('INSERT OR REPLACE INTO users (user_id, socket_id, room_id, role, name) VALUES (?, ?, ?, ?, ?)')
      .run(userId, socket.id, roomId, 'host', name || '발표자');

    socket.join(roomId);
    socket.emit(EVENTS.ROOM_CREATED, { roomId, title, displayCode, audienceCode, presenterCode, userId }); 
    broadcastPresenterList(roomId);
  });

  socket.on(EVENTS.ROOM_JOIN_PRESENTER, ({ roomId, presenterCode, name }) => {
    const room = db.prepare('SELECT * FROM rooms WHERE room_id = ? AND presenter_code = ?').get(roomId, presenterCode);
    if (!room) return socket.emit('error', { message: '방을 찾을 수 없거나 코드가 틀렸습니다.' });

    const existingHost = db.prepare("SELECT * FROM users WHERE socket_id = ? AND room_id = ? AND role = 'host'").get(socket.id, roomId);

    let userId;
    if (existingHost) {
      userId = existingHost.user_id;
      db.prepare('UPDATE users SET name = ? WHERE user_id = ?').run(name, userId);
    } else {
      userId = generateUserId();
      db.prepare('INSERT OR REPLACE INTO users (user_id, socket_id, room_id, role, name) VALUES (?, ?, ?, ?, ?)')
        .run(userId, socket.id, roomId, 'presenter', name);
    }

    socket.join(roomId);
    socket.emit(EVENTS.ROOM_JOINED, {
      roomId, role: existingHost ? 'host' : 'presenter', userId, nickname: name, 
      title: room.title, 
      displayCode: room.display_code,
      presenterCode: room.presenter_code,
      audienceCode: null, 
      currentFileUrl: room.file_url || null
    });
    broadcastPresenterList(roomId);
  });

  socket.on(EVENTS.ROOM_JOIN_DISPLAY, ({ displayCode }) => {
    const room = db.prepare('SELECT * FROM rooms WHERE display_code = ?').get(displayCode);
    if (!room) return socket.emit('error', { message: '잘못된 디스플레이 코드입니다.' });

    const userId = generateUserId();
    db.prepare('INSERT OR REPLACE INTO users (user_id, socket_id, room_id, role) VALUES (?, ?, ?, ?)')
      .run(userId, socket.id, room.room_id, 'display');

    socket.join(room.room_id);
    socket.emit(EVENTS.ROOM_JOINED, {
      roomId: room.room_id, role: 'display', userId, nickname: null, 
      title: room.title, 
      displayCode: null, 
      presenterCode: null, 
      audienceCode: room.audience_code, 
      currentFileUrl: room.file_url || null
    });
  });

  socket.on(EVENTS.ROOM_JOIN_AUDIENCE, ({ audienceCode, name }) => {
    const room = db.prepare('SELECT * FROM rooms WHERE audience_code = ?').get(audienceCode);
    if (!room) return socket.emit('error', { message: '잘못된 코드입니다.' });

    if (!name || name.trim() === '') {
      return socket.emit('error', { message: '이름을 입력해주세요.' });
    }

    const userId = generateUserId();
    db.prepare('INSERT OR REPLACE INTO users (user_id, socket_id, room_id, role, name) VALUES (?, ?, ?, ?, ?)')
      .run(userId, socket.id, room.room_id, 'audience', name);

    socket.join(room.room_id);
    socket.emit(EVENTS.ROOM_JOINED, {
      roomId: room.room_id, 
      title: room.title, 
      role: 'audience', 
      userId, 
      nickname: name, 
      currentFileUrl: room.file_url || null
    });

    const countQuery = db.prepare("SELECT COUNT(*) as count FROM users WHERE room_id = ? AND role = 'audience'").get(room.room_id);
    io.to(room.room_id).emit(EVENTS.AUDIENCE_COUNT_UPDATE, { count: countQuery.count });
  });

  // ----------------------------------------------------
  // [2] 설정 변경 & 발표 시작/종료
  // ----------------------------------------------------
  socket.on(EVENTS.ROOM_SETTINGS_UPDATE, (payload) => {
    const user = db.prepare('SELECT user_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    const room = db.prepare('SELECT * FROM rooms WHERE host_user_id = ? AND status = ?').get(user.user_id, 'wait');
    if (!room) return;

    const allowMidQs = payload.allowMidQuestions ? 1 : 0;
    const isAnon = payload.anonymous ? 1 : 0;

    db.prepare(`UPDATE rooms SET duration_minutes = ?, is_anonymous = ?, allow_mid_questions = ? WHERE room_id = ?`)
      .run(payload.durationMinutes, isAnon, allowMidQs, room.room_id);

    io.to(room.room_id).emit(EVENTS.ROOM_SETTINGS_UPDATED, payload); 
  });

  socket.on(EVENTS.PRESENTATION_START, (payload) => {
    const user = db.prepare('SELECT user_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    const room = db.prepare('SELECT * FROM rooms WHERE host_user_id = ? AND status = ?').get(user.user_id, 'wait');
    if (!room) return;

    const startedAt = Date.now();
    const durationSeconds = payload.durationMinutes * 60;
    const allowMidQs = payload.allowMidQuestions ? 1 : 0;
    const isAnon = payload.anonymous ? 1 : 0;

    db.prepare(`UPDATE rooms SET duration_minutes = ?, is_anonymous = ?, allow_mid_questions = ?, status = 'progress', started_at = ? WHERE room_id = ?`)
      .run(payload.durationMinutes, isAnon, allowMidQs, startedAt, room.room_id);

    roomSlides[room.room_id] = 1;

    io.to(room.room_id).emit(EVENTS.PRESENTATION_STARTED, { startedAt, ...payload, currentFileUrl: room.file_url });

    if (roomTimers[room.room_id]) clearInterval(roomTimers[room.room_id]);
    io.to(room.room_id).emit(EVENTS.TIMER_UPDATE, { elapsedSeconds: 0, durationSeconds, isOvertime: false });

    roomTimers[room.room_id] = setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - startedAt) / 1000);
      const isOvertime = elapsedSeconds >= durationSeconds;
      io.to(room.room_id).emit(EVENTS.TIMER_UPDATE, { elapsedSeconds, durationSeconds, isOvertime });
    }, 1000);
  });

  socket.on(EVENTS.PRESENTATION_END, () => {
    const user = db.prepare('SELECT user_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    const room = db.prepare('SELECT * FROM rooms WHERE current_presenter_id = ?').get(user.user_id);
    if (!room || !room.started_at) return;

    const endTime = Date.now();
    const totalElapsedSeconds = Math.floor((endTime - room.started_at) / 1000);

    const presenterCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE room_id = ? AND role IN ('host', 'presenter')").get(room.room_id).c;
    const audienceCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE room_id = ? AND role = 'audience'").get(room.room_id).c;

    db.prepare(`UPDATE rooms SET status = 'end', ended_at = ?, total_time_seconds = ?, total_presenters = ?, total_audience = ? WHERE room_id = ?`)
      .run(endTime, totalElapsedSeconds, presenterCount, audienceCount, room.room_id);

    const presenters = db.prepare("SELECT name FROM users WHERE room_id = ? AND role IN ('host', 'presenter')").all(room.room_id);
    const insertSession = db.prepare("INSERT INTO session_presenters (room_id, display_name_at_time, joined_at) VALUES (?, ?, ?)");
    for (const p of presenters) {
      insertSession.run(room.room_id, p.name || '발표자', Date.now());
    }

    io.to(room.room_id).emit(EVENTS.PRESENTATION_ENDED, { totalElapsedSeconds, presenterCount, audienceCount });

    if (roomTimers[room.room_id]) {
      clearInterval(roomTimers[room.room_id]);
      delete roomTimers[room.room_id];
    }
  });

  // ----------------------------------------------------
  // [3] 발표자 교체 및 슬라이드 제어
  // ----------------------------------------------------
  socket.on(EVENTS.PRESENTER_TRANSFER, ({ targetUserId }) => {
    const user = db.prepare('SELECT user_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    const room = db.prepare('SELECT * FROM rooms WHERE current_presenter_id = ?').get(user.user_id);
    if (!room) return;
    
    db.prepare('UPDATE rooms SET current_presenter_id = ? WHERE room_id = ?').run(targetUserId, room.room_id);
    io.to(room.room_id).emit(EVENTS.PRESENTER_CHANGED, { newPresenterId: targetUserId, fileUrl: room.file_url });
    broadcastPresenterList(room.room_id);
  });

  socket.on(EVENTS.SLIDE_NEXT, () => {
    const user = db.prepare('SELECT user_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    const room = db.prepare('SELECT room_id FROM rooms WHERE current_presenter_id = ?').get(user.user_id);
    if (room) {
      roomSlides[room.room_id] = (roomSlides[room.room_id] || 1) + 1;
      io.to(room.room_id).emit(EVENTS.SLIDE_CHANGED, { slideIndex: roomSlides[room.room_id] });
    }
  });

  socket.on(EVENTS.SLIDE_PREV, () => {
    const user = db.prepare('SELECT user_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    const room = db.prepare('SELECT room_id FROM rooms WHERE current_presenter_id = ?').get(user.user_id);
    if (room) {
      roomSlides[room.room_id] = Math.max(1, (roomSlides[room.room_id] || 1) - 1);
      io.to(room.room_id).emit(EVENTS.SLIDE_CHANGED, { slideIndex: roomSlides[room.room_id] });
    }
  });

  // ----------------------------------------------------
  // [4] Q&A 시스템
  // ----------------------------------------------------
  socket.on(EVENTS.QUESTION_SUBMIT, ({ text, category }) => {
    const user = db.prepare('SELECT * FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    const room = db.prepare('SELECT status, allow_mid_questions, is_anonymous FROM rooms WHERE room_id = ?').get(user.room_id);
    if (!room) return;

    if (room.allow_mid_questions === 0 && room.status !== 'end') {
      return socket.emit('error', { message: '발표 종료 후 질문해 주세요.' });
    }

    const authorName = room.is_anonymous === 1 ? '익명' : user.name;

    const info = db.prepare('INSERT INTO questions (room_id, author_name, content, category, created_at, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.room_id, authorName, text, category, Date.now(), 'pending');

    io.to(user.room_id).emit(EVENTS.QUESTION_NEW, { 
      questionId: String(info.lastInsertRowid), 
      text, 
      nickname: authorName, 
      category, 
      createdAt: Date.now() 
    });
  });

  socket.on(EVENTS.QUESTION_ANSWERING_START, ({ questionId }) => {
    const user = db.prepare('SELECT user_id, room_id, role, name FROM users WHERE socket_id = ?').get(socket.id);
    if (!user || (user.role !== 'presenter' && user.role !== 'host')) return;

    const isAnswering = db.prepare("SELECT * FROM questions WHERE room_id = ? AND status = 'answering'").get(user.room_id);
    if (isAnswering) return;

    const q = db.prepare("SELECT * FROM questions WHERE question_id = ?").get(questionId);
    if (!q) return;

    db.prepare("UPDATE questions SET status = 'answering', selected_at = ?, answering_presenter_id = ? WHERE question_id = ?")
      .run(Date.now(), user.user_id, questionId);

    io.to(user.room_id).emit(EVENTS.QUESTION_ANSWERING_STARTED, {
      questionId: String(questionId),
      text: q.content, 
      nickname: q.author_name, 
      answeringPresenterId: user.user_id,
      answeringPresenterName: user.name || '발표자'
    });
  });

  socket.on(EVENTS.QUESTION_ANSWERING_END, () => {
    const user = db.prepare('SELECT user_id, room_id, role FROM users WHERE socket_id = ?').get(socket.id);
    if (!user || (user.role !== 'presenter' && user.role !== 'host')) return;

    const q = db.prepare("SELECT * FROM questions WHERE room_id = ? AND status = 'answering' AND answering_presenter_id = ?").get(user.room_id, user.user_id);
    if (!q) return;

    const now = Date.now();
    db.prepare("UPDATE questions SET status = 'completed', completed_at = ? WHERE question_id = ?").run(now, q.question_id);

    const answered = db.prepare(`
      SELECT question_id as questionId, content as text, author_name as nickname, completed_at as answeredAt
      FROM questions WHERE room_id = ? AND status = 'completed' ORDER BY completed_at DESC
    `).all(user.room_id);
    
    const formattedAnswered = answered.map(row => ({
      ...row,
      questionId: String(row.questionId)
    }));

    io.to(user.room_id).emit(EVENTS.ANSWERED_QUESTIONS_UPDATE, { answered: formattedAnswered });
  });

  // ----------------------------------------------------
  // [5] 연결 종료 처리
  // ----------------------------------------------------
  socket.on('disconnect', () => {
    console.log(`연결 끊김: ${socket.id}`);
    const user = db.prepare('SELECT user_id, room_id, role FROM users WHERE socket_id = ?').get(socket.id);

    if (user) {
      db.prepare('DELETE FROM users WHERE socket_id = ?').run(socket.id);
      
      if (user.role === 'audience') {
        const countQuery = db.prepare("SELECT COUNT(*) as count FROM users WHERE room_id = ? AND role = 'audience'").get(user.room_id);
        io.to(user.room_id).emit(EVENTS.AUDIENCE_COUNT_UPDATE, { count: countQuery.count });
      } else if (user.role === 'host' || user.role === 'presenter') {
        broadcastPresenterList(user.room_id);
      }
    }
  });
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`KIT 백엔드 서버 구동 중: http://localhost:${PORT}`);
});