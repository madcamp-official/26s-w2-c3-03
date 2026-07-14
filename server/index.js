// server/index.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { jsonrepair } = require('jsonrepair');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

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
const generateAccountId = () => 'acc_' + Math.random().toString(36).substring(2, 10);

// [신규] 로그인 토큰(JWT) 검증. 실패하면 null — 호출부에서 "비로그인"과 동일하게 취급.
function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return null;
  }
}

const roomTimers = {}; 
const roomSlides = {};

const path = require('path');
const multer = require('multer');
const fs = require('fs');

// node를 어느 경로에서 실행하든 항상 같은 폴더를 가리키도록 절대경로로 고정
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const upload = multer({ dest: UPLOAD_DIR });

const mammoth = require('mammoth');
// [신규] PDF → PNG 변환. @napi-rs/canvas 기반이라 poppler/ImageMagick 같은 시스템 바이너리 설치가 필요 없음.
// ※ Node.js 22.13 이상 필요.
const { pdfToPng } = require('pdf-to-png-converter');

// [신규] 같은 방에 재업로드가 들어오면 예전 슬라이드 PNG가 남아있을 수 있음.
// pdf-to-png-converter는 같은 파일명이 이미 있으면 EEXIST로 에러를 내므로, 변환 전에 지워준다.
function cleanupSlideImages(roomId) {
  const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.startsWith(`${roomId}_slide_`));
  for (const f of files) {
    fs.unlinkSync(path.join(UPLOAD_DIR, f));
  }
}

// 업로드된 발표 자료(PDF)를 PC·청중 웹이 내려받을 수 있게 정적 서빙
// file_url이 "/files/ABC123_presentation.pdf"라면, 실제 접근 주소는
// http://<서버 호스트>:4000/files/ABC123_presentation.pdf 가 됨
app.use('/files', express.static(UPLOAD_DIR));

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

          // 이스케이프 안 된 따옴표(대본 인용구), raw 줄바꿈, 응답 잘림(MAX_TOKENS)까지
          // 규칙 기반으로 복구. 직접 정규식으로 짜면 놓치는 케이스가 많아 라이브러리로 위임.
          const parsed = JSON.parse(jsonrepair(cleanJsonStr));

          // 형태 검증: 이상하면 throw → 바깥 catch가 잡아서 재시도
          if (!Array.isArray(parsed) || parsed.some(n => typeof n.slideIndex !== 'number' || typeof n.text !== 'string')) {
            throw new Error('JSON 형태가 기대와 다릅니다 (slideIndex/text 누락).');
          }

          return parsed;

        } catch (parseError) {
          // finishReason 확인: MAX_TOKENS면 응답이 잘린 것
          console.error(`[DEBUG] finishReason: ${result.response.candidates?.[0]?.finishReason}`);
          console.error(`[DEBUG: JSON 파싱 에러] AI가 뱉은 원본 응답 텍스트:\n${responseText}\n`);
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

// 0-1. 회원가입
// 영문/숫자/특수문자를 각각 최소 1개 이상 포함한 8~12자
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,12}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/auth/signup', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ success: false, message: '이메일, 비밀번호, 이름은 필수입니다.' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ success: false, message: '이메일 형식이 올바르지 않습니다.' });
  }
  if (!PASSWORD_REGEX.test(password)) {
    return res.status(400).json({ success: false, message: '비밀번호는 영문, 숫자, 특수문자를 모두 포함한 8~12자여야 합니다.' });
  }

  try {
    const existing = db.prepare('SELECT account_id FROM accounts WHERE login_id = ?').get(email);
    if (existing) {
      return res.status(409).json({ success: false, message: '이미 가입된 이메일입니다.' });
    }

    const accountId = generateAccountId();
    const passwordHash = await bcrypt.hash(password, 10);

    db.prepare('INSERT INTO accounts (account_id, login_id, password, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(accountId, email, passwordHash, name, Date.now());

    const token = jwt.sign({ accountId, name }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, accountId, name });

  } catch (error) {
    console.error('회원가입 중 에러:', error);
    res.status(500).json({ success: false, message: '회원가입 처리 중 오류가 발생했습니다.' });
  }
});

// 0-2. 로그인
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: '이메일과 비밀번호를 입력해 주세요.' });
  }

  try {
    const account = db.prepare('SELECT * FROM accounts WHERE login_id = ?').get(email);
    if (!account) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const passwordMatches = await bcrypt.compare(password, account.password);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = jwt.sign({ accountId: account.account_id, name: account.name }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, accountId: account.account_id, name: account.name });

  } catch (error) {
    console.error('로그인 중 에러:', error);
    res.status(500).json({ success: false, message: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

// 0-3. 로그인 상태 확인 (프론트가 저장해둔 토큰이 아직 유효한지 새로고침 시 확인하는 용도)
app.get('/auth/me', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ success: false, message: '유효하지 않거나 만료된 토큰입니다.' });
  }
  res.json({ success: true, accountId: decoded.accountId, name: decoded.name });
});

// 1. 발표 자료(PDF) 단독 업로드 API
app.post('/rooms/:roomId/presentation', upload.single('presentationFile'), async (req, res) => {
  const { roomId } = req.params;
  const { ownerId } = req.body; // [신규] 업로드한 발표자의 userId — 프론트에서 폼 필드로 같이 보내야 함
  const savedPdfPath = path.join(UPLOAD_DIR, `${roomId}_presentation.pdf`);

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '발표 자료(PDF)는 필수입니다.' });
    }

    // 나중에 대본 분석을 위해 PDF 파일을 방(Room) 고유 이름으로 저장해둠
    fs.renameSync(req.file.path, savedPdfPath);

    // [수정] 예전엔 Gemini에게 "몇 장이야?"라고 텍스트로 물어봐서 파싱하는 방식이었음(가끔 숫자가
    // 아닌 답이 오면 NaN 에러). 이제는 페이지를 실제로 이미지로 변환하면서 나온 배열의 길이를
    // 그대로 슬라이드 수로 쓰므로, 별도로 AI에게 물어볼 필요가 없어짐 — 더 빠르고 확정적임.
    // 재업로드 시 예전 PNG가 남아있으면 파일명이 겹쳐 EEXIST 에러가 나므로 먼저 정리.
    cleanupSlideImages(roomId);

    const pngPages = await pdfToPng(savedPdfPath, {
      outputFolder: UPLOAD_DIR,
      outputFileMaskFunc: (pageNumber) => `${roomId}_slide_${pageNumber}.png`,
      viewportScale: 2.0,           // PC 화면/프로젝터에서도 선명하게 보이도록 2배 해상도
      returnPageContent: false,     // 디스크에만 쓰고 메모리에 버퍼는 안 들고 있음 (슬라이드 많을 때 메모리 절약)
      processPagesInParallel: true,
      concurrencyLimit: 4,
    });

    const slideCount = pngPages.length;
    console.log(`[DEBUG: /presentation] PDF → PNG 변환 완료 -> 총 ${slideCount}장!`);

    if (slideCount === 0) {
      throw new Error('PDF에서 페이지를 찾을 수 없습니다.');
    }

    const stmt = db.prepare(
      'INSERT OR REPLACE INTO slides (slide_id, room_id, slide_index, original_note, image_url) VALUES (?, ?, ?, ?, ?)'
    );

    const insertNotes = db.transaction(() => {
      for (const page of pngPages) {
        const slideId = `${roomId}_${page.pageNumber}`;
        const imageUrl = `/files/${roomId}_slide_${page.pageNumber}.png`;
        stmt.run(slideId, roomId, page.pageNumber, '', imageUrl); // 대본은 빈 칸으로 자리만 만들어 둠
      }
    });
    insertNotes();

    // 빈 대본 정보를 프론트에 소켓으로 쏘지 않도록 EVENTS.NOTES_READY 방출 줄 삭제!
    // 프론트엔드는 아래 HTTP 응답만 받고 완료 처리를 진행하도록 유도합니다.
    // [신규] PC·청중 웹이 나중에 currentFileUrl로 받아갈 값을 DB에 저장
    const fileUrl = `/files/${roomId}_presentation.pdf`;
    db.prepare('UPDATE rooms SET file_url = ? WHERE room_id = ?').run(fileUrl, roomId);

    // [신규] 같은 방의 다른 발표자들에게 "자료 준비 완료"를 실시간으로 알림
    // [수정] fileUrl을 같이 실어보냄. 업로드 이전부터 방에 있던 다른 발표자는
    // 이 이벤트 전에는 currentFileUrl을 받을 방법이 없었기 때문.
    const fileId = `${roomId}_presentation`;
    io.to(roomId).emit(EVENTS.FILE_READY, { fileId, ownerId: ownerId || null, slideCount, fileUrl });

    // [신규] 업로드한 사람이 별도 요청 없이 바로 미리보기를 그릴 수 있도록 이미지 목록도 같이 응답
    const images = pngPages.map(p => ({ slideIndex: p.pageNumber, imageUrl: `/files/${roomId}_slide_${p.pageNumber}.png` }));

    const responsePayload = { success: true, message: '발표 자료 분석 완료', slideCount: slideCount, hasScript: true, fileUrl, images };
    res.json(responsePayload);
    console.log(`[DEBUG: /presentation] 프론트엔드로 응답 전송:`, responsePayload);

  } catch (error) {
    console.error('발표 자료 처리 중 에러:', error);
    if (fs.existsSync(savedPdfPath)) fs.unlinkSync(savedPdfPath);
    cleanupSlideImages(roomId); // 변환 중간에 실패했을 때 일부만 생성된 PNG가 남지 않도록 정리
    res.status(500).json({ success: false, message: '발표 자료를 분석하는 중 에러가 발생했습니다.' });
  }
});


// 2. 대본 단독 업로드 API
app.post('/rooms/:roomId/script', upload.single('scriptFile'), async (req, res) => {
  const { roomId } = req.params;
  const savedPdfPath = path.join(UPLOAD_DIR, `${roomId}_presentation.pdf`);
  const scriptFilePath = req.file ? req.file.path : null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '대본 파일이 필요합니다.' });
    }

    if (!fs.existsSync(savedPdfPath)) {
      return res.status(400).json({ success: false, message: '발표 자료(PDF)를 먼저 업로드해야 합니다.' });
    }

    // DB에서 해당 방(roomId)에 생성된 슬라이드 개수를 직접 세어옵니다.
    const countRow = db.prepare('SELECT COUNT(*) as count FROM slides WHERE room_id = ?').get(roomId);
    const slideCount = countRow.count;

    if (slideCount === 0) {
      return res.status(400).json({ success: false, message: 'DB에 슬라이드 정보가 없습니다. 발표 자료를 다시 업로드해 주세요.' });
    }

    const pdfBase64 = fs.readFileSync(savedPdfPath).toString("base64");
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext !== '.docx' && ext !== '.txt') {
      return res.status(400).json({ success: false, message: '지원하지 않는 대본 파일 형식입니다. (DOCX, TXT만 가능)' });
    }

    // [수정] 예전엔 텍스트만 뽑고 원본 파일은 버렸음(finally에서 삭제). 그래서 "발표 기록"에
    // 대본 원문 파일 자체가 하나도 안 남았다. PDF와 같은 방식으로 방 이름을 붙여 영구 보관한다.
    const savedScriptPath = path.join(UPLOAD_DIR, `${roomId}_script${ext}`);
    if (fs.existsSync(savedScriptPath)) fs.unlinkSync(savedScriptPath); // 재업로드 시 이전 파일 정리
    fs.renameSync(scriptFilePath, savedScriptPath);
    const scriptUrl = `/files/${roomId}_script${ext}`;

    let fullScript = '';
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: savedScriptPath });
      fullScript = result.value;
    } else {
      fullScript = fs.readFileSync(savedScriptPath, 'utf-8');
    }

    console.log(`[DEBUG: /script] 텍스트 추출 완료! (총 글자 수: ${fullScript.length}자)`);

    if (!fullScript || fullScript.trim() === '') {
      return res.status(400).json({ success: false, message: '대본 파일에서 텍스트를 추출할 수 없습니다.' });
    }
    
    // 방금 구한 slideCount를 프롬프트에 주입하여 AI의 분할 정확도를 극대화합니다
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

    // Gemini에게 강제할 응답 스키마
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
    console.log(`[DEBUG: /script] Gemini 매칭 완료! 반환된 배열 길이: ${slideNotes.length}`);

    // INSERT OR REPLACE 대신 UPDATE를 사용하여 기존에 만들어둔 빈 방에 텍스트만 덮어씌웁니다.
    // [수정] original_note(원본 대본)만 갱신하고 ai_summary_note(실제 "발표자 노트")는 안 건드리고
    // 있었음. 그래서 대본 없이 미리 손으로 고쳐뒀거나 AI로 생성해둔 노트가 있는 상태에서 나중에
    // 대본을 올리면, 발표자 노트는 그 옛날 내용 그대로 남고 새 대본 내용이 반영되지 않았음.
    // 스펙상 "대본 업로드 시 자동으로 슬라이드별 대본 내용을 분리해 발표자 노트 생성"이므로,
    // 대본이 올라오면 그 시점까지의 발표자 노트(수정본 포함)는 버리고 새 대본 내용으로 덮어쓴다.
    const stmt = db.prepare('UPDATE slides SET original_note = ?, ai_summary_note = ? WHERE room_id = ? AND slide_index = ?');
    const updateNotes = db.transaction(() => {
      for (const note of slideNotes) {
        stmt.run(note.text, note.text, roomId, note.slideIndex);
      }
    });
    updateNotes();
    console.log(`[DEBUG: /script] DB 대본 UPDATE 완료`);

    // [수정] "대본이 있다"는 사실을 방 상태로 저장한다. 예전엔 이 값이 서버 어디에도 저장되지
    // 않고 매 요청마다 클라이언트가 알아서 hasScript를 보내야 했는데, 그러면 대본을 업로드한
    // 사람 화면만 상태가 바뀌고 같은 방의 다른 발표자는 그 사실을 알 방법이 없었다.
    // script_url도 같이 저장해서, 발표 기록에서 원본 대본 파일을 다시 열람할 수 있게 한다.
    db.prepare('UPDATE rooms SET has_script = 1, script_url = ? WHERE room_id = ?').run(scriptUrl, roomId);

    // [수정] slideNotes에 imageUrl이 없어서, 이 이벤트/응답만 보고 노트 수정 화면을 그리면
    // 슬라이드 이미지 없이 텍스트만 나오는 문제가 있었음. DB에 이미 저장된 image_url을 붙여준다.
    const imageRows = db.prepare('SELECT slide_index, image_url FROM slides WHERE room_id = ?').all(roomId);
    const imageUrlBySlideIndex = Object.fromEntries(imageRows.map(r => [r.slide_index, r.image_url]));
    const slideNotesWithImages = slideNotes.map(note => ({ ...note, imageUrl: imageUrlBySlideIndex[note.slideIndex] || null }));

    // [수정] hasScript를 이벤트에 실어서, 같은 방의 다른 발표자 화면도 "대본 업로드됨" 상태로 동기화되게 함
    io.to(roomId).emit(EVENTS.NOTES_READY, { slideNotes: slideNotesWithImages, source: 'ai_context_split', hasScript: true });
    console.log(`[DEBUG: /script] 프론트엔드로 소켓 이벤트(NOTES_READY) 방출 완료`);

    // DB에서 가져온 정확한 slideCount를 프론트엔드에 응답합니다.
    // slideNotes도 같이 실어서, 소켓 재연결로 NOTES_READY를 놓쳐도 REST 응답만으로 화면을 갱신할 수 있게 함.
    const responsePayload = { success: true, message: '대본 AI 매칭 완료', slideCount: slideCount, hasScript: true, slideNotes: slideNotesWithImages }
    res.json(responsePayload);
    console.log(`[DEBUG: /script] 프론트엔드로 응답 전송:`, responsePayload);

  } catch (error) {
    console.error('대본 처리 중 에러:', error);
    res.status(500).json({ success: false, message: '대본을 분석하는 중 에러가 발생했습니다.' });
  } finally {
    if (scriptFilePath && fs.existsSync(scriptFilePath)) {
      fs.unlinkSync(scriptFilePath); 
    }
  }
});


// 3. AI 노트 요약/생성 API
app.post('/rooms/:roomId/slides/note/ai', async (req, res) => {
  const { roomId } = req.params;

  try {
    const room = db.prepare('SELECT has_script FROM rooms WHERE room_id = ?').get(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: '방을 찾을 수 없습니다.' });
    }
    // [수정] hasScript를 요청 body(클라이언트가 알아서 판단한 값)에서 더 이상 신뢰하지 않는다.
    // 방마다 실제로 대본이 업로드됐는지는 서버(rooms.has_script)만 알고 있는 사실이라,
    // 클라이언트가 잘못 알고 있으면(다른 발표자가 방금 대본을 올린 걸 모르는 등) 빈 원문을
    // 요약하려 들거나, 반대로 실제 있는 대본을 무시하는 문제가 생길 수 있었다.
    const hasScript = !!room.has_script;

    const slides = db.prepare('SELECT * FROM slides WHERE room_id = ? ORDER BY slide_index ASC').all(roomId);

    if (slides.length === 0) {
      return res.status(404).json({ success: false, message: '처리할 슬라이드/대본 데이터가 없습니다.' });
    }

    // [수정] 대본이 없는 경우엔 실제로 참조할 게 PDF뿐이므로, 미리 읽어서 base64로 준비해둔다.
    // 예전엔 이 값을 아예 AI 호출에 넘기지 않아서, PDF 내용과 무관한 문장이 생성되고 있었음.
    let pdfBase64 = null;
    if (!hasScript) {
      const pdfPath = path.join(UPLOAD_DIR, `${roomId}_presentation.pdf`);
      if (!fs.existsSync(pdfPath)) {
        return res.status(400).json({ success: false, message: '발표 자료(PDF)를 찾을 수 없습니다. 다시 업로드해 주세요.' });
      }
      pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
    }

    const updateStmt = db.prepare('UPDATE slides SET ai_summary_note = ? WHERE slide_id = ?');

    const aiPromises = slides.map(async (slide) => {
      let prompt = '';
      
      if (hasScript) {
        prompt = `당신은 발표를 돕는 최고의 어시스턴트입니다. 다음 발표 대본을 발표자가 한눈에 보기 쉽게 '핵심 키워드 위주의 개조식(Bullet points)'으로 요약해 주세요. 너무 길지 않게 3~4줄로 부탁합니다.\n\n[원본 대본]\n${slide.original_note}`;
      } else {
        prompt = `당신은 발표를 돕는 최고의 어시스턴트입니다. 첨부된 PDF는 총 ${slides.length}장짜리 발표 자료입니다.
        그 중 ${slide.slide_index}번째 페이지(슬라이드)의 내용만 근거로 삼아, 그 슬라이드를 설명하는 자연스러운 발표용 스크립트(대본)를 3~4문장으로 작성해 주세요.
        다른 페이지의 내용을 섞지 말고, 반드시 ${slide.slide_index}번째 페이지 내용에만 집중해 주세요.`; 
      }

      // 새로 만든 헬퍼 함수 활용 (텍스트 기대)
      // [수정] pdfBase64를 안 넘기고 있어서, 프롬프트는 "첨부된 PDF의 N번째 페이지를 보라"고
      // 써놓고 실제로는 아무 파일도 첨부하지 않은 채 호출되고 있었음. 대본이 없을 때만 필요하므로
      // hasScript일 땐 null을 넘겨서 불필요하게 PDF를 매 슬라이드마다 재전송하지 않게 함.
      const aiSummary = await callAiApiWithRetry(prompt, {
        isJsonExpected: false,
        pdfBase64: hasScript ? null : pdfBase64
      });
      
      updateStmt.run(aiSummary, slide.slide_id);
      // [수정] imageUrl도 같이 실어서, 이 응답/이벤트만으로 노트 수정 화면에 슬라이드 이미지까지 바로 그릴 수 있게 함
      return { slideIndex: slide.slide_index, text: aiSummary, imageUrl: slide.image_url || null };
    });

    const resolvedAiNotes = await Promise.all(aiPromises);
    resolvedAiNotes.sort((a, b) => a.slideIndex - b.slideIndex);

    const source = hasScript ? 'ai_summarize' : 'ai_generate';
    io.to(roomId).emit(EVENTS.NOTES_READY, { slideNotes: resolvedAiNotes, source, hasScript });

    res.json({ success: true, message: 'Gemini AI 처리 완료', slideNotes: resolvedAiNotes, hasScript });

  } catch (error) {
    console.error('AI 처리 중 에러:', error);
    res.status(500).json({ success: false, message: 'AI 요약 처리 중 문제가 발생했습니다.' });
  }
});

app.put('/rooms/:roomId/slides/:slideIndex/note', (req, res) => {
  const { roomId, slideIndex } = req.params;
  const { newNote, editedByName } = req.body;
  db.prepare('UPDATE slides SET ai_summary_note = ? WHERE room_id = ? AND slide_index = ?').run(newNote, roomId, slideIndex);
  // [수정] imageUrl도 같이 보내서, 이 이벤트만 받는 다른 발표자 화면도 별도 조회 없이 이미지를 유지/표시할 수 있게 함
  const slide = db.prepare('SELECT image_url FROM slides WHERE room_id = ? AND slide_index = ?').get(roomId, slideIndex);
  io.to(roomId).emit(EVENTS.NOTE_SAVED, { slideIndex: parseInt(slideIndex, 10), editedByName, newNote, imageUrl: slide?.image_url || null });
  res.json({ success: true });
});

// [신규] 방 현재 상태 조회 API
// 재연결했거나 늦게 들어온 클라이언트가 소켓 이벤트를 놓쳤을 때, 이 API로 현재 상태를 복구할 수 있다.
// 접속 코드(presenter/display/audience code)는 여기서 내려주지 않음 — roomId만으로 코드까지
// 알 수 있게 되면 방을 아는 사람 누구나 다른 사람 역할로 입장할 수 있게 되기 때문.
app.get('/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId);
 
  if (!room) {
    return res.status(404).json({ success: false, message: '방을 찾을 수 없습니다.' });
  }
 
  res.json({
    success: true,
    room: {
      roomId: room.room_id,
      title: room.title,
      status: room.status,
      currentPresenterId: room.current_presenter_id,
      hostUserId: room.host_user_id,
      durationMinutes: room.duration_minutes,
      isAnonymous: !!room.is_anonymous,
      allowMidQuestions: !!room.allow_mid_questions,
      fileUrl: room.file_url,
      hasScript: !!room.has_script,
      scriptUrl: room.script_url,
      currentSlideIndex: roomSlides[roomId] || 1,
      startedAt: room.started_at
    }
  });
});
 
// [신규] 슬라이드 + 노트 목록 조회 API
// 방에 늦게 들어온 발표자는 NOTES_READY 소켓 이벤트를 못 받았기 때문에,
// 미리보기 화면을 채우려면 이 API로 현재까지 저장된 노트를 받아와야 한다.
app.get('/rooms/:roomId/slides', (req, res) => {
  const { roomId } = req.params;
  const slides = db.prepare(
    'SELECT slide_index, original_note, ai_summary_note, image_url FROM slides WHERE room_id = ? ORDER BY slide_index ASC'
  ).all(roomId);
 
  if (slides.length === 0) {
    return res.status(404).json({ success: false, message: '슬라이드 정보가 없습니다.' });
  }
 
  const formatted = slides.map(s => ({
    slideIndex: s.slide_index,
    originalNote: s.original_note,
    aiSummaryNote: s.ai_summary_note,
    imageUrl: s.image_url
  }));
 
  res.json({ success: true, slides: formatted });
});

app.get('/rooms/:roomId/questions', (req, res) => {
  const { roomId } = req.params;
  // [수정] 예전엔 상태와 무관하게 created_at(등록 순서)로만 정렬해서, 이걸로 "답변한 질문 목록"을
  // 복구하면(재연결 등) 실시간 소켓(question:answered_list_update, completed_at 기준)과
  // 순서가 달라졌음. completed 항목은 completed_at, 나머지는 created_at 기준으로 맞춘다.
  // [수정] category가 SELECT에 없어서 항상 undefined로 내려가고 있었음. 실시간 소켓 이벤트
  // (question:new)는 category를 포함해서 오는데, 발표 종료 후 화면이 이 REST로 다시 조회하면
  // category가 비어서, 그 값 기준으로 필터링하는 화면에서는 질문이 전부 안 보이는 문제가 있었다.
  const questions = db.prepare(`
    SELECT question_id as questionId, content as text, author_name as nickname, category, status, created_at as createdAt, selected_at as answeredAt, completed_at as completedAt
    FROM questions WHERE room_id = ? ORDER BY COALESCE(completed_at, created_at) DESC
  `).all(roomId);

  const formattedQuestions = questions.map(q => ({
    ...q,
    questionId: String(q.questionId) 
  }));

  res.json({ success: true, questions: formattedQuestions });
});

// [신규] Authorization: Bearer <token> 헤더에서 로그인 계정을 꺼내는 공용 헬퍼.
// 무효/누락 시 null — 호출부가 401로 응답할지는 각자 판단한다.
function getAuthAccount(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return verifyToken(token);
}

// [신규] 로그인한 계정의 "이전 발표 기록" 목록.
// 방장으로 만든 방(owner_account_id)뿐 아니라, 다른 발표자로 참여했던 방(session_presenters)도
// 포함한다 — 스펙: "방장 말고 다른 발표자들도 기록 저장". 종료된(status='end') 발표만 대상.
app.get('/accounts/me/rooms', (req, res) => {
  const account = getAuthAccount(req);
  if (!account) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }

  // [수정] 이 계정이 "삭제"(숨김) 처리한 방은 목록에서 제외한다.
  const rooms = db.prepare(`
    SELECT DISTINCT r.room_id as roomId, r.title, r.ended_at as endedAt,
           r.total_time_seconds as totalTimeSeconds, r.duration_minutes as durationMinutes,
           r.total_presenters as totalPresenters, r.total_audience as totalAudience
    FROM rooms r
    LEFT JOIN session_presenters sp ON sp.room_id = r.room_id
    WHERE r.status = 'end' AND (r.owner_account_id = ? OR sp.account_id = ?)
      AND r.room_id NOT IN (SELECT room_id FROM hidden_history WHERE account_id = ?)
    ORDER BY r.ended_at DESC
  `).all(account.accountId, account.accountId, account.accountId);

  res.json({ success: true, rooms });
});

// [신규] 발표 기록 삭제 — 실제 방/자료는 그대로 두고, 이 계정의 "이전 발표 기록" 목록에서만
// 숨긴다. 같은 방이 여러 발표자의 개인 기록에 동시에 나타날 수 있어서, 한 명이 지운다고
// 다른 참여자(또는 방장)의 기록까지 같이 사라지면 안 되기 때문.
app.delete('/rooms/:roomId/history', (req, res) => {
  const { roomId } = req.params;
  const account = getAuthAccount(req);
  if (!account) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }

  const room = db.prepare('SELECT owner_account_id FROM rooms WHERE room_id = ?').get(roomId);
  if (!room) {
    return res.status(404).json({ success: false, message: '방을 찾을 수 없습니다.' });
  }

  const isParticipant = room.owner_account_id === account.accountId ||
    !!db.prepare('SELECT 1 FROM session_presenters WHERE room_id = ? AND account_id = ?').get(roomId, account.accountId);
  if (!isParticipant) {
    return res.status(403).json({ success: false, message: '이 발표 기록을 삭제할 권한이 없습니다.' });
  }

  db.prepare('INSERT OR IGNORE INTO hidden_history (room_id, account_id, hidden_at) VALUES (?, ?, ?)')
    .run(roomId, account.accountId, Date.now());

  res.json({ success: true });
});

// [신규] 발표 기록 상세 — 발표 자료, 대본/발표자 노트(슬라이드별), 답변한 질문, 총 발표 시간,
// 발표자 리스트를 한 번에 반환한다. "다시 발표하기"에서 이 데이터를 그대로 재사용할 수 있다.
app.get('/rooms/:roomId/history', (req, res) => {
  const { roomId } = req.params;
  const account = getAuthAccount(req);
  if (!account) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }

  const room = db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId);
  if (!room || room.status !== 'end') {
    return res.status(404).json({ success: false, message: '완료된 발표 기록을 찾을 수 없습니다.' });
  }

  // 이 방을 만들었거나(owner) 발표자로 참여했던 계정만 열람 가능
  const isParticipant = room.owner_account_id === account.accountId ||
    !!db.prepare('SELECT 1 FROM session_presenters WHERE room_id = ? AND account_id = ?').get(roomId, account.accountId);
  if (!isParticipant) {
    return res.status(403).json({ success: false, message: '이 발표 기록을 볼 권한이 없습니다.' });
  }

  const slides = db.prepare(
    'SELECT slide_index, original_note, ai_summary_note, image_url FROM slides WHERE room_id = ? ORDER BY slide_index ASC'
  ).all(roomId).map(s => ({
    slideIndex: s.slide_index,
    originalNote: s.original_note,
    aiSummaryNote: s.ai_summary_note,
    imageUrl: s.image_url
  }));

  const answeredQuestions = db.prepare(`
    SELECT question_id as questionId, content as text, author_name as nickname, completed_at as answeredAt
    FROM questions WHERE room_id = ? AND status = 'completed' ORDER BY completed_at DESC
  `).all(roomId).map(q => ({ ...q, questionId: String(q.questionId) }));

  const presenters = db.prepare(
    'SELECT account_id as accountId, display_name_at_time as name, joined_at as joinedAt FROM session_presenters WHERE room_id = ? ORDER BY joined_at ASC'
  ).all(roomId);

  res.json({
    success: true,
    history: {
      roomId: room.room_id,
      title: room.title,
      fileUrl: room.file_url,
      hasScript: !!room.has_script,
      scriptUrl: room.script_url,
      totalTimeSeconds: room.total_time_seconds,
      durationMinutes: room.duration_minutes,
      startedAt: room.started_at,
      endedAt: room.ended_at,
      presenters,
      slides,
      answeredQuestions,
    }
  });
});

// =========================================================================
// [Socket.io 구역]
// =========================================================================

// [신규] 유저 upsert 헬퍼: 재연결 시에도 joined_at(최초 입장 시각)이 덮어써지지 않도록
// INSERT OR REPLACE 대신 ON CONFLICT DO UPDATE를 사용한다.
// - 최초 입장: user_id 행이 없으므로 INSERT되고 joined_at이 현재 시각으로 기록됨
// - 재연결(같은 userId로 다시 join): socket_id/room_id/role/name만 갱신, joined_at은 그대로 유지
function upsertUser(userId, socketId, roomId, role, name) {
  db.prepare(`
    INSERT INTO users (user_id, socket_id, room_id, role, name, joined_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      socket_id = excluded.socket_id,
      room_id = excluded.room_id,
      role = excluded.role,
      name = excluded.name
  `).run(userId, socketId, roomId, role, name, Date.now());
}

// [신규] "이 방에 이 사람이 들어온 적 있다"를 영구히 남긴다. users 테이블은 연결 끊기면 행이
// 지워지므로, 발표 종료 시점의 총 발표자/청중 수·참여자 목록을 users만 보고 계산하면 중간에
// 나갔다 들어온 사람이 빠진다. UNIQUE(room_id, user_id)라서 같은 사람이 재입장해도 중복 안 됨.
function recordParticipant(roomId, userId, accountId, role, name) {
  db.prepare(`
    INSERT OR IGNORE INTO room_participants (room_id, user_id, account_id, role, display_name_at_time, first_joined_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(roomId, userId, accountId, role, name, Date.now());
}

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
    const { title, name, userId: clientUserId, token } = payload;

    if (!title || title.trim() === '') {
      return socket.emit('error', { message: '방 제목을 입력해주세요.' });
    }

    const roomId = generateCode();
    const presenterCode = generateCode();
    const displayCode = generateCode();
    const audienceCode = generateCode();

    // [신규] 로그인한 회원이면 accountId를 그대로 userId로 쓴다 — 기기와 무관하게
    // 항상 같은 신원이 되므로, 나중에 이 계정의 발표 기록을 그대로 조회할 수 있다.
    // 토큰이 없거나 무효하면(비로그인) 기존처럼 클라이언트가 들고 있는 익명 userId를 그대로 쓴다.
    const account = verifyToken(token);
    const userId = account ? account.accountId : (clientUserId || generateUserId());
    const displayName = account ? account.name : (name || '발표자');
    const ownerAccountId = account ? account.accountId : null;

    const stmt = db.prepare(`
      INSERT INTO rooms (room_id, title, host_user_id, current_presenter_id, presenter_code, display_code, audience_code, status, owner_account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'wait', ?)
    `);
    stmt.run(roomId, title, userId, userId, presenterCode, displayCode, audienceCode, ownerAccountId);

    upsertUser(userId, socket.id, roomId, 'host', displayName);
    recordParticipant(roomId, userId, ownerAccountId, 'host', displayName);

    socket.join(roomId);
    socket.emit(EVENTS.ROOM_CREATED, { roomId, title, displayCode, audienceCode, presenterCode, userId });
    broadcastPresenterList(roomId);
  });

  // [신규] 이전 발표 기록의 자료(PDF/슬라이드 이미지)와 노트를 그대로 복사해 새 방을 만든다
  // ("다시 발표하기"). 로그인 계정만 가능하고, 그 발표 기록의 방장이었거나 참여했던 발표자만
  // 재사용할 수 있다(GET /rooms/:roomId/history와 동일한 권한 검사).
  socket.on(EVENTS.ROOM_CREATE_FROM_HISTORY, ({ sourceRoomId, title, token } = {}) => {
    const account = verifyToken(token);
    if (!account) {
      return socket.emit('error', { message: '로그인이 필요합니다.' });
    }
    if (!title || title.trim() === '') {
      return socket.emit('error', { message: '방 제목을 입력해주세요.' });
    }

    const sourceRoom = db.prepare("SELECT * FROM rooms WHERE room_id = ? AND status = 'end'").get(sourceRoomId);
    if (!sourceRoom) {
      return socket.emit('error', { message: '재사용할 발표 기록을 찾을 수 없습니다.' });
    }

    const isParticipant = sourceRoom.owner_account_id === account.accountId ||
      !!db.prepare('SELECT 1 FROM session_presenters WHERE room_id = ? AND account_id = ?').get(sourceRoomId, account.accountId);
    if (!isParticipant) {
      return socket.emit('error', { message: '이 발표 기록을 재사용할 권한이 없습니다.' });
    }

    const sourceSlides = db.prepare('SELECT * FROM slides WHERE room_id = ? ORDER BY slide_index ASC').all(sourceRoomId);
    if (sourceSlides.length === 0) {
      return socket.emit('error', { message: '재사용할 발표 자료가 없습니다.' });
    }

    const roomId = generateCode();
    const presenterCode = generateCode();
    const displayCode = generateCode();
    const audienceCode = generateCode();
    const userId = account.accountId;

    // 발표 자료(PDF) 복사 — 파일명이 roomId로 묶여 있으므로 새 roomId 이름으로 복사해서
    // 이후 슬라이드 재업로드 등 기존 파이프라인과 완전히 독립적으로 동작하게 한다.
    const sourcePdfPath = path.join(UPLOAD_DIR, `${sourceRoomId}_presentation.pdf`);
    const newPdfPath = path.join(UPLOAD_DIR, `${roomId}_presentation.pdf`);
    let fileUrl = null;
    if (fs.existsSync(sourcePdfPath)) {
      fs.copyFileSync(sourcePdfPath, newPdfPath);
      fileUrl = `/files/${roomId}_presentation.pdf`;
    }

    // [신규] 대본 원본 파일도 있으면 같이 복사 (script_url)
    let scriptUrl = null;
    if (sourceRoom.script_url) {
      const scriptExt = path.extname(sourceRoom.script_url);
      const sourceScriptPath = path.join(UPLOAD_DIR, path.basename(sourceRoom.script_url));
      const newScriptPath = path.join(UPLOAD_DIR, `${roomId}_script${scriptExt}`);
      if (fs.existsSync(sourceScriptPath)) {
        fs.copyFileSync(sourceScriptPath, newScriptPath);
        scriptUrl = `/files/${roomId}_script${scriptExt}`;
      }
    }

    // 슬라이드별 이미지 + 노트(원본 대본/발표자 노트) 복사
    const insertSlide = db.prepare(
      'INSERT INTO slides (slide_id, room_id, slide_index, original_note, ai_summary_note, image_url) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const copySlides = db.transaction(() => {
      for (const slide of sourceSlides) {
        let newImageUrl = null;
        if (slide.image_url) {
          const sourceImgPath = path.join(UPLOAD_DIR, path.basename(slide.image_url));
          const newImgPath = path.join(UPLOAD_DIR, `${roomId}_slide_${slide.slide_index}.png`);
          if (fs.existsSync(sourceImgPath)) {
            fs.copyFileSync(sourceImgPath, newImgPath);
            newImageUrl = `/files/${roomId}_slide_${slide.slide_index}.png`;
          }
        }
        insertSlide.run(`${roomId}_${slide.slide_index}`, roomId, slide.slide_index, slide.original_note, slide.ai_summary_note, newImageUrl);
      }
    });
    copySlides();

    db.prepare(`
      INSERT INTO rooms (room_id, title, host_user_id, current_presenter_id, presenter_code, display_code, audience_code, status, owner_account_id, file_url, has_script, script_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'wait', ?, ?, ?, ?)
    `).run(roomId, title, userId, userId, presenterCode, displayCode, audienceCode, userId, fileUrl, sourceRoom.has_script, scriptUrl);

    upsertUser(userId, socket.id, roomId, 'host', account.name);
    recordParticipant(roomId, userId, account.accountId, 'host', account.name);
    socket.join(roomId);

    socket.emit(EVENTS.ROOM_CREATED, { roomId, title, displayCode, audienceCode, presenterCode, userId });

    // [신규] 이미 자료/노트가 준비돼 있다는 걸 기존 이벤트(FILE_READY/NOTES_READY)로 알려서,
    // 프론트가 재업로드 없이 기존 업로드 완료 플로우 그대로 미리보기를 그릴 수 있게 한다.
    const slideCount = sourceSlides.length;
    if (fileUrl) {
      io.to(roomId).emit(EVENTS.FILE_READY, { fileId: `${roomId}_presentation`, ownerId: userId, slideCount, fileUrl });
    }
    const slideNotes = sourceSlides.map(s => ({
      slideIndex: s.slide_index,
      text: s.ai_summary_note || '',
      imageUrl: s.image_url ? `/files/${roomId}_slide_${s.slide_index}.png` : null
    }));
    io.to(roomId).emit(EVENTS.NOTES_READY, { slideNotes, source: 'manual', hasScript: !!sourceRoom.has_script });

    broadcastPresenterList(roomId);
  });

  socket.on(EVENTS.ROOM_JOIN_PRESENTER, ({ presenterCode, name, userId: clientUserId, token }) => {
    // [수정] PC/청중 입장(display_code, audience_code)은 코드 하나만으로 방을 찾는데,
    // 여기만 roomId까지 같이 요구하고 있었음. 처음 방을 만든 사람이 아닌 다른 발표자는애초에
    // roomId를 알 방법이 없고 "발표자 접속 코드"만 전달받으므로, 코드만 보내면 항상 실패했음.
    // presenter_code만으로 조회하도록 통일.
    const room = db.prepare('SELECT * FROM rooms WHERE presenter_code = ?').get(presenterCode);
    if (!room) return socket.emit('error', { message: '방을 찾을 수 없거나 코드가 틀렸습니다.' });

    const roomId = room.room_id;

    // [수정] ROOM_CREATE와 동일하게, 로그인한 발표자면 accountId를 그대로 userId로 쓴다.
    // 방장뿐 아니라 다른 발표자도 계정에 귀속돼야 나중에 "이전 발표 기록"에 이 발표자의
    // 참여 이력을 남길 수 있다 (스펙: "방장 말고 다른 발표자들도 기록 저장").
    // 토큰이 없거나 무효하면(비로그인) 기존처럼 클라이언트가 들고 있는 익명 userId를 그대로 쓴다.
    const account = verifyToken(token);
    const userId = account ? account.accountId : (clientUserId || generateUserId());
    const displayName = account ? account.name : name;
    const role = userId === room.host_user_id ? 'host' : 'presenter';

    upsertUser(userId, socket.id, roomId, role, displayName);
    recordParticipant(roomId, userId, account ? account.accountId : null, role, displayName);

    socket.join(roomId);

    // [수정] 자료가 이미 업로드된 방에 나중에 들어온 발표자는 FILE_READY(업로드 시점에만 쏨)를
    // 놓쳤기 때문에, currentFileUrl만으로는 "업로드는 됐는데 몇 장인지/대본이 있는지" 알 수 없었다.
    // 이 값들도 같이 실어보내서, 늦게 들어온 발표자 화면도 별도 조회 없이 바로 "업로드 완료" 상태를 그릴 수 있게 한다.
    const slideCount = room.file_url
      ? db.prepare('SELECT COUNT(*) as count FROM slides WHERE room_id = ?').get(roomId).count
      : 0;

    socket.emit(EVENTS.ROOM_JOINED, {
      roomId, role, userId, nickname: displayName,
      title: room.title,
      displayCode: room.display_code,
      presenterCode: room.presenter_code,
      audienceCode: null,
      currentFileUrl: room.file_url || null,
      slideCount,
      hasScript: !!room.has_script
    });
    broadcastPresenterList(roomId);
  });

  socket.on(EVENTS.ROOM_JOIN_DISPLAY, ({ displayCode, userId: clientUserId }) => {
    const room = db.prepare('SELECT * FROM rooms WHERE display_code = ?').get(displayCode);
    if (!room) return socket.emit('error', { message: '잘못된 디스플레이 코드입니다.' });

    // [수정] PC도 같은 userId를 재사용하도록 통일 — 새로고침/재연결돼도 같은 신원으로 인식됨
    const userId = clientUserId || generateUserId();
    upsertUser(userId, socket.id, room.room_id, 'display', null);

    socket.join(room.room_id);
    // [수정] status가 없어서, 발표가 이미 시작된 뒤에 PC가 (재)접속하면 이미 지나간
    // presentation:started 브로드캐스트를 영영 못 받아 대기 화면에 멈춰있었다.
    socket.emit(EVENTS.ROOM_JOINED, {
      roomId: room.room_id, role: 'display', userId, nickname: null,
      title: room.title,
      displayCode: null,
      presenterCode: null,
      audienceCode: room.audience_code,
      currentFileUrl: room.file_url || null,
      status: room.status
    });
  });

  socket.on(EVENTS.ROOM_JOIN_AUDIENCE, ({ audienceCode, name, userId: clientUserId }) => {
    const room = db.prepare('SELECT * FROM rooms WHERE audience_code = ?').get(audienceCode);
    if (!room) return socket.emit('error', { message: '잘못된 코드입니다.' });

    if (!name || name.trim() === '') {
      return socket.emit('error', { message: '이름을 입력해주세요.' });
    }

    // [수정] 청중도 같은 userId를 재사용하도록 통일 — 새로고침/재연결돼도 같은 신원으로 인식됨
    const userId = clientUserId || generateUserId();
    upsertUser(userId, socket.id, room.room_id, 'audience', name);
    recordParticipant(room.room_id, userId, null, 'audience', name);

    socket.join(room.room_id);
    // [수정] status/allowMidQuestions가 없어서, 발표가 이미 시작된 뒤에 들어온(QR로 늦게 스캔한)
    // 청중은 이미 지나간 presentation:started 브로드캐스트를 못 받아 "대기 중" 화면에 영영
    // 멈춰있었다. 입장 시점에 방 상태를 그대로 실어보내서 클라이언트가 즉시 판단할 수 있게 한다.
    socket.emit(EVENTS.ROOM_JOINED, {
      roomId: room.room_id,
      title: room.title,
      role: 'audience',
      userId,
      nickname: name,
      currentFileUrl: room.file_url || null,
      status: room.status,
      allowMidQuestions: !!room.allow_mid_questions
    });

    const countQuery = db.prepare("SELECT COUNT(*) as count FROM users WHERE room_id = ? AND role = 'audience'").get(room.room_id);
    io.to(room.room_id).emit(EVENTS.AUDIENCE_COUNT_UPDATE, { count: countQuery.count });
  });

  // ----------------------------------------------------
  // [2] 설정 변경 & 발표 시작/종료
  // ----------------------------------------------------
  socket.on(EVENTS.ROOM_SETTINGS_UPDATE, (payload) => {
    const user = db.prepare('SELECT user_id, room_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    // [수정] host_user_id만으로 찾으면, 같은 userId가 재사용된 다른 방(예: 이전 테스트 방)이
    // 먼저 걸려서 엉뚱한 방이 수정될 수 있음. 이 소켓이 실제로 join한 room_id로 좁힌다.
    const room = db.prepare('SELECT * FROM rooms WHERE room_id = ? AND host_user_id = ? AND status = ?').get(user.room_id, user.user_id, 'wait');
    if (!room) return;

    const allowMidQs = payload.allowMidQuestions ? 1 : 0;
    const isAnon = payload.anonymous ? 1 : 0;

    db.prepare(`UPDATE rooms SET duration_minutes = ?, is_anonymous = ?, allow_mid_questions = ? WHERE room_id = ?`)
      .run(payload.durationMinutes, isAnon, allowMidQs, room.room_id);

    io.to(room.room_id).emit(EVENTS.ROOM_SETTINGS_UPDATED, payload); 
  });

  socket.on(EVENTS.PRESENTATION_START, (payload) => {
    // [수정] 아래 두 가드가 조용히 return만 해서, 실패해도 클라이언트가 아무 반응도 못 받았음.
    // (재연결하면서 userId를 다시 안 보냈거나, 방 상태가 이미 바뀐 경우 등) 원인을 알 수 있게 에러를 emit한다.
    const user = db.prepare('SELECT user_id, room_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) {
      return socket.emit('error', { message: '서버가 이 연결의 신원을 찾지 못했습니다. 방을 다시 만들거나 재입장해 주세요.' });
    }

    // [수정] 같은 userId가 재사용된 다른 방과 충돌하지 않도록 room_id까지 같이 검증
    const room = db.prepare('SELECT * FROM rooms WHERE room_id = ? AND host_user_id = ? AND status = ?').get(user.room_id, user.user_id, 'wait');
    if (!room) {
      return socket.emit('error', { message: '발표를 시작할 수 없습니다. 방장 권한이 없거나, 이미 시작/종료된 방이거나, 재연결로 신원이 바뀌었을 수 있습니다.' });
    }

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
    // [수정] 아래 두 가드가 조용히 return만 해서, "현재 발표자"가 아닌 사람이 눌렀을 때
    // (예: 발표자 교체 후 UI가 안 바뀐 경우) 아무 반응이 없어 "종료가 안 된다"로 보였다.
    const user = db.prepare('SELECT user_id, room_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) {
      return socket.emit('error', { message: '서버가 이 연결의 신원을 찾지 못했습니다. 재입장해 주세요.' });
    }

    // [수정] current_presenter_id만으로 찾으면 같은 userId를 가진 다른(예: 오래된 테스트) 방과
    // 혼동될 수 있음. 이 소켓이 실제로 join한 room_id로 좁혀서 정확한 방만 종료시킨다.
    const room = db.prepare('SELECT * FROM rooms WHERE room_id = ? AND current_presenter_id = ?').get(user.room_id, user.user_id);
    if (!room || !room.started_at) {
      return socket.emit('error', { message: '발표를 종료할 수 없습니다. 현재 발표자가 아니거나, 아직 시작되지 않은 발표입니다.' });
    }

    const endTime = Date.now();
    const totalElapsedSeconds = Math.floor((endTime - room.started_at) / 1000);

    // [수정] 발표 도중 나갔다 들어온 사람이 있으면, 그 순간 연결돼 있는 users만 세서는
    // 총 발표자/청중 수가 실제보다 적게 나왔다. room_participants는 "한 번이라도 들어온
    // 사람"을 전부 남겨두므로(연결이 끊겨도 안 지워짐), 여기서 집계해야 정확하다.
    const presenterCount = db.prepare("SELECT COUNT(*) as c FROM room_participants WHERE room_id = ? AND role IN ('host', 'presenter')").get(room.room_id).c;
    const audienceCount = db.prepare("SELECT COUNT(*) as c FROM room_participants WHERE room_id = ? AND role = 'audience'").get(room.room_id).c;

    db.prepare(`UPDATE rooms SET status = 'end', ended_at = ?, total_time_seconds = ?, total_presenters = ?, total_audience = ? WHERE room_id = ?`)
      .run(endTime, totalElapsedSeconds, presenterCount, audienceCount, room.room_id);

    // [수정] 예전엔 (그 순간 연결돼 있는) users 테이블에서 발표자 목록을 뽑았기 때문에,
    // 발표 종료 전에 앱을 끄거나 연결이 끊긴 발표자는 "기록"에서 통째로 빠졌다 — 이게
    // "방장한테만 기록이 남는다"는 증상의 원인이었다. room_participants는 입장하는 순간
    // 바로 남기므로, 끝까지 연결돼 있었는지와 무관하게 참여했던 모든 발표자가 남는다.
    const presenters = db.prepare("SELECT user_id, account_id, display_name_at_time as name, first_joined_at as joinedAt FROM room_participants WHERE room_id = ? AND role IN ('host', 'presenter')").all(room.room_id);
    const insertSession = db.prepare("INSERT INTO session_presenters (room_id, account_id, display_name_at_time, joined_at) VALUES (?, ?, ?, ?)");
    for (const p of presenters) {
      insertSession.run(room.room_id, p.account_id, p.name || '발표자', p.joinedAt || Date.now());
    }

    io.to(room.room_id).emit(EVENTS.PRESENTATION_ENDED, { totalElapsedSeconds, presenterCount, audienceCount });

    if (roomTimers[room.room_id]) {
      clearInterval(roomTimers[room.room_id]);
      delete roomTimers[room.room_id];
    }
  });

  // [신규] 발표 "시작 취소" — PRESENTATION_END(종료)와 달리 질문 화면으로 보내지 않고
  // 시작 전 대기 상태로 되돌린다. 첫 번째 슬라이드에서 오른쪽 스와이프 확인 시 모바일 앱이 보냄.
  socket.on(EVENTS.PRESENTATION_CANCEL, () => {
    const user = db.prepare('SELECT user_id, room_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    // [수정] PRESENTATION_END와 동일한 패턴: current_presenter_id만으로 찾으면 같은 userId를
    // 가진 다른 방과 혼동될 수 있으므로 이 소켓이 실제로 join한 room_id로 좁힌다.
    const room = db.prepare("SELECT * FROM rooms WHERE room_id = ? AND current_presenter_id = ? AND status = 'progress'").get(user.room_id, user.user_id);
    if (!room) return;

    db.prepare("UPDATE rooms SET status = 'wait', started_at = NULL WHERE room_id = ?").run(room.room_id);

    // 진행 중이던 타이머와 슬라이드 위치를 리셋 — 다음에 다시 시작하면 처음부터 시작한다.
    if (roomTimers[room.room_id]) {
      clearInterval(roomTimers[room.room_id]);
      delete roomTimers[room.room_id];
    }
    roomSlides[room.room_id] = 1;

    io.to(room.room_id).emit(EVENTS.PRESENTATION_CANCELLED, {});
  });

  // ----------------------------------------------------
  // [3] 발표자 교체 및 슬라이드 제어
  // ----------------------------------------------------
  socket.on(EVENTS.PRESENTER_TRANSFER, ({ targetUserId }) => {
    const user = db.prepare('SELECT user_id, room_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    // [수정] current_presenter_id만으로 찾으면 같은 userId를 가진 다른 방과 혼동될 수 있음
    const room = db.prepare('SELECT * FROM rooms WHERE room_id = ? AND current_presenter_id = ?').get(user.room_id, user.user_id);
    if (!room) return;

    // [수정] targetUserId가 실제로 "이 방"에 들어와 있는 발표자/방장인지 검증.
    // 검증 없이 넘기면 존재하지 않는 ID가 current_presenter_id에 박혀서
    // 이후 아무도 발표 제어권을 가질 수 없게 방 전체가 멈춰버림.
    const target = db.prepare(
      "SELECT user_id FROM users WHERE user_id = ? AND room_id = ? AND role IN ('host', 'presenter')"
    ).get(targetUserId, room.room_id);

    if (!target) {
      return socket.emit('error', { message: '대상 발표자를 찾을 수 없습니다. 방에 있는 발표자에게만 넘길 수 있어요.' });
    }
    
    db.prepare('UPDATE rooms SET current_presenter_id = ? WHERE room_id = ?').run(targetUserId, room.room_id);
    io.to(room.room_id).emit(EVENTS.PRESENTER_CHANGED, { newPresenterId: targetUserId, fileUrl: room.file_url });
    broadcastPresenterList(room.room_id);
  });

  socket.on(EVENTS.SLIDE_NEXT, () => {
    const user = db.prepare('SELECT user_id, room_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    // [수정] current_presenter_id만으로 찾으면 같은 userId를 가진 다른 방과 혼동될 수 있음
    const room = db.prepare('SELECT room_id FROM rooms WHERE room_id = ? AND current_presenter_id = ?').get(user.room_id, user.user_id);
    if (room) {
      // [수정] 실제 슬라이드 총 개수를 넘지 않도록 상한을 둠.
      // 예전엔 상한이 없어서 마지막 슬라이드 뒤로도 계속 증가할 수 있었음.
      const { count: maxSlide } = db.prepare('SELECT COUNT(*) as count FROM slides WHERE room_id = ?').get(room.room_id);
      const current = roomSlides[room.room_id] || 1;
      roomSlides[room.room_id] = maxSlide > 0 ? Math.min(maxSlide, current + 1) : current + 1;
      io.to(room.room_id).emit(EVENTS.SLIDE_CHANGED, { slideIndex: roomSlides[room.room_id] });
    }
  });

  socket.on(EVENTS.SLIDE_PREV, () => {
    const user = db.prepare('SELECT user_id, room_id FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    // [수정] current_presenter_id만으로 찾으면 같은 userId를 가진 다른 방과 혼동될 수 있음
    const room = db.prepare('SELECT room_id FROM rooms WHERE room_id = ? AND current_presenter_id = ?').get(user.room_id, user.user_id);
    if (room) {
      roomSlides[room.room_id] = Math.max(1, (roomSlides[room.room_id] || 1) - 1);
      io.to(room.room_id).emit(EVENTS.SLIDE_CHANGED, { slideIndex: roomSlides[room.room_id] });
    }
  });

  // ----------------------------------------------------
  // [4] Q&A 시스템
  // ----------------------------------------------------
  socket.on(EVENTS.QUESTION_SUBMIT, ({ text }) => {
    const user = db.prepare('SELECT * FROM users WHERE socket_id = ?').get(socket.id);
    if (!user) return;

    // [수정] 질문 등록은 청중 전용. role 체크가 없어서 PC(display)나 발표자 소켓도 등록할 수 있었음.
    if (user.role !== 'audience') {
      return socket.emit('error', { message: '질문 등록은 청중만 가능합니다.' });
    }

    const room = db.prepare('SELECT status, allow_mid_questions, is_anonymous FROM rooms WHERE room_id = ?').get(user.room_id);
    if (!room) return;

    if (room.allow_mid_questions === 0 && room.status !== 'end') {
      return socket.emit('error', { message: '발표 종료 후 질문해 주세요.' });
    }

    // [수정] category를 클라이언트가 정해서 보내면 항상 'during'만 오는 등 신뢰할 수 없었음.
    // 서버가 방의 실제 상태(status)로 직접 판단한다.
    const category = room.status === 'end' ? 'after' : 'during';
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
    if (isAnswering) {
      // [수정] 예전엔 조용히 무시해서, 타이밍이 어긋나 버튼이 아직 안 꺼진 상태로 눌렀을 때
      // 누른 사람에게 아무 피드백이 없었음. 정상 플로우(버튼 비활성화)에서는 안 뜨는 게 맞고,
      // 어긋난 경우에만 보이는 안전망 성격의 에러.
      return socket.emit('error', { message: '다른 발표자가 이미 답변 중입니다.' });
    }

    // [수정] question_id는 방을 통틀어 전역으로 증가하는 값이라, room_id 조건이 없으면
    // 다른 방의 questionId를 넣었을 때 그 방의 질문이 이 방으로 새어나올 수 있었음.
    const q = db.prepare("SELECT * FROM questions WHERE question_id = ? AND room_id = ?").get(questionId, user.room_id);
    if (!q) return;

    // [수정] 이미 답변 완료된 질문을 다시 답변 중 상태로 되돌릴 수 없게 막는다.
    if (q.status === 'completed') {
      return socket.emit('error', { message: '이미 답변 완료된 질문입니다.' });
    }

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