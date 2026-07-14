// server/database.js
const Database = require('better-sqlite3');
const db = new Database('kit.db');

db.exec(`
  -- 0. 회원 테이블
  CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,                    -- 계정 고유 식별자
    login_id TEXT UNIQUE,                           -- 로그인 아이디 (이메일 등)
    password TEXT,                                  -- 비밀번호 (해시 암호화되어 저장)
    name TEXT,                                      -- 사용자 이름 (발표자 이름으로 사용)
    created_at INTEGER                              -- 가입 시간 (타임스탬프)
  );

  -- 1. 발표 준비 테이블
  CREATE TABLE IF NOT EXISTS rooms (
    room_id TEXT PRIMARY KEY,
    title TEXT,                                     -- 방 제목 (필수 입력)
    host_user_id TEXT,                              -- 방장 식별자 (소켓 ID가 아닌 고정 user_id로 권한 확인)
    owner_account_id TEXT,                          -- 방을 생성한 회원의 계정 ID (로그인한 유저의 이전 발표 기록 조회용)

    -- 발급 코드
    presenter_code TEXT,
    display_code TEXT,
    audience_code TEXT,

    -- 설정값
    duration_minutes INTEGER DEFAULT 0,             -- 발표 설정 시간
    is_anonymous INTEGER DEFAULT 0,                 -- 0: 기명(named), 1: 익명(anonymous)
    allow_mid_questions INTEGER DEFAULT 1,          -- 0: 발표 종료 후(post), 1: 실시간 허용(realtime)

    -- 발표 진행 상태
    file_url TEXT,                                  -- 발표 자료 URL
    script_url TEXT,                                -- 발표 대본 URL
    status TEXT DEFAULT 'wait',                     -- 'wait'(대기) -> 'progress'(발표중) -> 'end'(종료)
    current_presenter_id TEXT,                      -- 현재 슬라이드 제어권을 가진 발표자의 고정 user_id

    -- 발표 기록 (발표 종료 시점에 업데이트)
    started_at INTEGER,                             -- 발표 시작 시간
    ended_at INTEGER,                               -- 발표 종료 시간
    total_time_seconds INTEGER DEFAULT 0,           -- 실제 총 발표 시간 (초 단위)

    -- 통계 데이터
    total_presenters INTEGER DEFAULT 1,             
    total_audience INTEGER DEFAULT 0                
    -- presenters_list 컬럼 삭제 -> session_presenters 테이블로 대체
  );

  -- 신규: 발표 기록(스냅샷)을 위한 세션 참여자 조인 테이블
  CREATE TABLE IF NOT EXISTS session_presenters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT,                                   -- 어떤 방인지
    account_id TEXT,                                -- 참여한 발표자의 회원 계정 ID (로그인 안 한 발표자면 null)
    display_name_at_time TEXT,                      -- 발표 당시 사용했던 이름 (동명이인/개명 대비 스냅샷)
    joined_at INTEGER                               -- 합류한 시간
  );

  -- 2. 유저 테이블 (현재 방에 접속한 사람들 - 임시 데이터)
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,           -- 클라이언트가 부여한 고정 ID (account_id 또는 기기 로컬 UUID)
    socket_id TEXT,                     -- 통신을 위한 현재 소켓 ID (재연결 시 이 값만 업데이트됨)
    room_id TEXT,
    role TEXT,                          -- 'host', 'presenter', 'display', 'audience'
    name TEXT                           -- 청중/발표자가 입장할 때 입력한 실제 이름
  );
  
  -- 3. 슬라이드 & AI 노트 테이블
  CREATE TABLE IF NOT EXISTS slides (
    slide_id TEXT PRIMARY KEY,
    room_id TEXT,
    slide_index INTEGER,                
    original_note TEXT,                 
    ai_summary_note TEXT                
  );

  -- 4. 질문 테이블
  CREATE TABLE IF NOT EXISTS questions (
    question_id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT,
    author_name TEXT,                   
    content TEXT,                       
    category TEXT,                      -- 'during' (발표 중) 또는 'after' (발표 후)
    created_at INTEGER,                 
    
    status TEXT DEFAULT 'pending',      -- 'pending', 'answering', 'completed'
    answering_presenter_id TEXT,        -- 소켓 ID가 아닌 고정 user_id가 들어감
    selected_at INTEGER,                
    completed_at INTEGER                
  );
`);

console.log("KIT 데이터베이스 스펙 빌드 완료");
module.exports = db;