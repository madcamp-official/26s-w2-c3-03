# 26s-w2-c3-03

## 공통과제 II : 협업형 실전 산출물 제작 (2인 1팀)

**목적:** 실시간 인터랙션, LLM Wrapper, Cross-Platform 중 하나의 옵션을 선택해 구현하며, 선택한 기술을 실제로 동작하는 형태의 산출물로 완성한다.

**선택 옵션:**

| 옵션 | 설명 |
|---|---|
| 실시간 인터랙션 | 사용자 간 상태 변화, 실시간 데이터 흐름, 스트리밍 응답 등 실시간성이 드러나는 기능을 구현 |
| LLM Wrapper | LLM API를 활용하여 AI 기능이 포함된 산출물을 구현 |
| Cross-Platform | 하나의 산출물을 여러 실행 환경에서 사용할 수 있도록 구현* |

> *데스크톱 앱 ↔ 모바일 앱; 혹은 다른 폼팩터에서의 앱; 웹만/웹 기반 프레임워크(Electron, Tauri 등) 대신 다른 프레임워크를 시도해보는 것을 적극 권장

**결과물:** 선택한 옵션이 적용된 작동 가능한 산출물, 실행 가능한 코드, 시연 자료 및 관련 문서

---

## 팀원

| 이름 | 학교 | GitHub | 역할 |
|---|---|---|---|
| 김민 | 이화여자대학교 |  |  |
| 김규민 | KAIST |  |  |

---

## 선택 옵션

- [ ] 실시간 인터랙션
- [ ] LLM Wrapper
- [ ] Cross-Platform

---

## 기획안

- **산출물 주제:** 발표 도우미 앱 **KIT (Keep It Together)**
- **제작 목적:** 물리적 제약이 있는 기존 발표 환경을 해결하기 위해, 이동의 자유를 보장하는 동시에 청중과의 실시간 상호작용을 돕는 크로스 플랫폼 발표 보조 솔루션을 구축하는 것이 목적이다. 스마트폰 하나로 슬라이드 제어, 발표 대본 및 시간 확인을 통합 관리하며, 실시간 질문 및 반응 수집을 통해 발표자와 청중 간의 양방향 소통을 극대화한다.
- **선택 옵션:** 실시간 인터랙션 & LLM Wrapper
- **핵심 구현 요소:**

  **[발표자] - 모바일앱**
  - **프레젠테이션 제어**
      - 다음/이전 슬라이드 전환
      - 다인원이 하나의 발표 시 슬라이드 컨트롤 권한 변경 가능
      - 발표 시작 시 버튼을 눌러 슬라이드 제어 권한을 활성화
  - **발표 보조 도구**
      - 발표자 노트 화면 표시
      - 발표 타임오버 알림
      - 타임오버 알림 후 타이머 종료되지 않고 계속 표시
      - 발표 대본 및 슬라이드 기반 AI 발표자 노트 생성
      - 실시간 청중 인원수 표시
  - **청중 피드백 모니터링**
      - 청중이 남긴 질문(공개/비공개) 목록 확인
      - 발표 종료 후 답변할 질문 선택
  - **발표 자료 업로드**
      - 원격으로 앱을 통해 발표 자료를 해당 발표 세션에 사전 업로드
  - **발표 환경 설정**
      - 발표 시간 타이머 설정
      - 질문자 익명/기명 선택
      - 발표 중 질문 받을지 말지 선택
  - **발표 기록 확인**
      - 발표 자료, 받은 질문, 총 발표 시간 저장

  **[청중] - 웹**
  - **실시간 인터랙션**
      - 질문(공개/비공개) 등록
  - **발표 자료 보기**
      - 발표 화면과 별도로 발표 자료 확인 가능

  **[PC] - 웹**
  - **슬라이드 동기화**
      - 모바일에서 보낸 신호를 받아 실제 화면 전환
  - **답변 질문 표시**
      - 발표자가 선택한 질문을 실시간으로 표시

- **사용 / 시연 시나리오:**
  - **지훈 - 슬라이드 넘길 때마다 컴퓨터 앞으로 되돌아가야 하는 발표자**
    - 상황: 혼자 발표하든 팀으로 발표하든, 발표자는 청중 앞에서 움직이며 말하고 싶은데 슬라이드를 넘기려면 매번 컴퓨터 앞으로 다시 가야 함
    - Pain Point: 화면 앞을 벗어나기 어려우니 계속 컴퓨터 옆에 붙어있게 되고, 발표에 자연스러운 동선이나 제스처를 쓰기 힘듦. 게다가 발표 중간에 지금 슬라이드에서 무슨 말을 하려 했는지 순간 까먹거나, 시간이 얼마나 지났는지 몰라서 뒷부분에서 급하게 말이 빨라지는 문제도 자주 생김
    - 원하는 것: 컴퓨터 앞을 벗어나 자유롭게 움직이면서도 **자기 폰으로 슬라이드를 직접 넘기고**, 폰 화면엔 **지금 슬라이드용 발표 노트**랑 **남은 시간 타이머**가 같이 떠서 흐름도 안 끊기고 시간 감각도 유지되는 것
      → 리모컨 + 발표 노트 + 타이머 기능의 핵심 사용자
      
  - **유나 - 소심하지만 궁금한 게 많은 청중**
    - 상황: 발표 끝나고 Q&A 시간. 궁금한 게 몇 개 있지만, 질문하려면 손 들고 마이크 받아서 다들 쳐다보는 앞에서 말해야 함
    - Pain Point: 사람들 앞에서 마이크 들고 이야기하는 것 자체가 부담. "이런 것도 모르나" 싶을까봐 걱정도 되고, 막상 말하려면 무슨 말부터 해야 할지 정리도 안 됨. 결국 궁금해도 참고 넘어가는 경우가 대부분
    - 원하는 것: 마이크 들 필요 없이 **폰으로 텍스트만 남기면 질문이 전달**되는 것. 발표자가 질문 리스트를 보고 시간 봐가며 중요한 것만 골라 답해주니, 자기 질문이 채택 안 되더라도 부담 없이 남길 수 있음
      → 텍스트 질문 제출 + 발표자용 질문 리스트 기능의 핵심 사용자

  - **재현 - 발표장 컴퓨터에 미리 파일을 올려둬야 하는 다음 발표자**
    - 상황: 세미나실이나 강의실에 있는 공용 컴퓨터로 발표가 진행됨. 자기 차례가 되기 전에 미리 발표장 컴퓨터로 가서 USB나 이메일, 드라이브로 자기 파일을 옮겨놔야 함
    - Pain Point: 발표 시작 전에 한 명씩 순서대로 컴퓨터 앞에 가서 파일 옮기는 시간이 걸리고, 앞사람 발표 도중에 옮기려면 눈치가 보임. 옮겨놓고 나서도 "혹시 파일 잘못 옮겼나", "발표 중에 순서 꼬이면 어떡하지" 하는 신경이 쓰임. 파일을 안 가져왔거나 USB가 안 되면 그 자리에서 이메일 뒤지느라 시간이 지연됨
    - 원하는 것: 발표장 컴퓨터 앞에 갈 필요 없이 **자기 자리에서 미리 앱에 파일을 올려두고**, 자기 차례가 되면 **권한만 넘겨받아도 발표장 컴퓨터 화면이 자동으로 자기 파일로 전환**되는 것. 미리 줄 서서 옮기는 과정 자체가 사라짐
      → 파일 사전 업로드 + 권한 이양 시 자동 전환 기능의 핵심 사용자
- **팀원별 역할:**
  - 김민: 백엔드
  - 김규민: 프론트엔드

### 개발 일정

| 날짜 | 목표 |
|---|---|
| Day 1 | 주제 선정 |
| Day 2 |  |
| Day 3 |  |
| Day 4 |  |
| Day 5 |  |
| Day 6 |  |
| Day 7 |  |

---

## 구현 명세서

| 구현 요소 | 설명 | 우선순위 |
|---|---|---|
|  |  | 필수 |
|  |  | 필수 |
|  |  | 선택 |
|  |  | 선택 |

---

## 아키텍처

<!-- 실시간 인터랙션: WebSocket/SSE/WebRTC 구조도 / LLM Wrapper: API 연동 흐름도 / Cross-Platform: 플랫폼 구성도 -->

---

## 설계 문서

> 프로젝트 성격에 따라 필요한 항목만 작성

### 화면 / 인터페이스 설계

<!-- Figma 링크, 화면 이미지, CLI 사용 예시, 앱 화면 등 -->

### 데이터 구조

<!-- DB 스키마, JSON 구조, 파일 저장 방식 등 -->

### API / 외부 서비스 연동

| Method / 방식 | Endpoint / 서비스 | 설명 | 요청 | 응답 | 비고 |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

---

## 산출물 및 실행 방법

- **산출물 설명:**
- **실행 환경:**
- **실행 방법:**
- **시연 영상 / 이미지:** (선택)

### 실행 방법

```bash
# 환경 설정
cp .env.example .env

# 의존성 설치
npm install   # 또는 pip install -r requirements.txt 등

# 실행
npm run dev   # 또는 python main.py 등
```

### 기술 구성

| 분류 | 사용 기술 |
|---|---|
| 핵심 기술 |  |
| 실행 환경 |  |
| 데이터 저장 |  |
| 외부 API / 서비스 |  |
| 기타 |  |

---

## 회고 문서

> [KPT 방법론 참고](https://velog.io/@habwa/%EB%8B%A8%EA%B8%B0-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%9A%8C%EA%B3%A0-KPT-%EB%B0%A9%EB%B2%95%EB%A1%A0)

### Keep — 잘 된 점, 다음에도 유지할 것

-
-
-

### Problem — 아쉬웠던 점, 개선이 필요한 것

-
-
-

### Try — 다음번에 시도해볼 것

-
-
-

### 팀원별 소감

**김민:**

> 

**김규민:**

> 

---

## 참고 자료

### 실시간 인터랙션

**WebSocket**
- https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- https://techblog.woowahan.com/5268/
- https://tech.kakao.com/posts/391
- https://daleseo.com/websocket/
- https://kakaoentertainment-tech.tistory.com/110

**Socket.IO**
- https://socket.io/docs/v4/
- https://inpa.tistory.com/entry/SOCKET-%F0%9F%93%9A-Namespace-Room-%EA%B8%B0%EB%8A%A5
- https://adjh54.tistory.com/549
- https://fred16157.github.io/node.js/nodejs-socketio-communication-room-and-namespace/

**SSE (Server-Sent Events)**
- https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- https://developer.mozilla.org/ko/docs/Web/API/Server-sent_events/Using_server-sent_events
- https://api7.ai/ko/blog/what-is-sse

**TCP / UDP Socket**
- https://docs.python.org/3/library/socket.html
- https://inpa.tistory.com/entry/NW-%F0%9F%8C%90-%EC%95%84%EC%A7%81%EB%8F%84-%EB%AA%A8%ED%98%B8%ED%95%9C-TCP-UDP-%EA%B0%9C%EB%85%90-%E2%9D%93-%EC%89%BD%EA%B2%8C-%EC%9D%B4%ED%95%B4%ED%95%98%EC%9E%90

**gRPC Streaming**
- https://grpc.io/docs/what-is-grpc/core-concepts/
- https://tech.ktcloud.com/entry/gRPC%EC%9D%98-%EB%82%B4%EB%B6%80-%EA%B5%AC%EC%A1%B0-%ED%8C%8C%ED%97%A4%EC%B9%98%EA%B8%B0-HTTP2-Protobuf-%EA%B7%B8%EB%A6%AC%EA%B3%A0-%EC%8A%A4%ED%8A%B8%EB%A6%AC%EB%B0%8D
- https://tech.ktcloud.com/entry/gRPC%EC%9D%98-%EB%82%B4%EB%B6%80-%EA%B5%AC%EC%A1%B0-%ED%8C%8C%ED%97%A4%EC%B9%98%EA%B8%B02-Channel-Stub
- https://inspirit941.tistory.com/371
- https://devocean.sk.com/blog/techBoardDetail.do?ID=167433

**WebRTC**
- https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
- https://webrtc.org/getting-started/overview
- https://web.dev/articles/webrtc-basics?hl=ko
- https://devocean.sk.com/blog/techBoardDetail.do?ID=164885
- https://beomkey-nkb.github.io/%EA%B0%9C%EB%85%90%EC%A0%95%EB%A6%AC/webRTC%EC%A0%95%EB%A6%AC/
- https://gh402.tistory.com/45
- https://on.com2us.com/tech/webrtc-coturn-turn-stun-server-setup-guide/

**QUIC / WebTransport**
- https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API
- https://datatracker.ietf.org/doc/html/rfc9000
- https://news.hada.io/topic?id=13888

#### KCLOUD VM / Cloudflare Tunnel 환경별 주의사항

| 환경 | 사용 가능(권장) 기술 | 포트/조건 | 주의할 기술 |
|---|---|---|---|
| **로컬 / 일반 VM** | HTTP/REST, WebSocket, Socket.IO, SSE, TCP Socket, gRPC Streaming, WebRTC, QUIC/WebTransport 등 대부분 가능 | 직접 포트 개방 가능. 예: 3000, 5000, 8000, 8080, 9000 등. 외부 공개 시 방화벽/보안그룹/공인 IP 설정 필요 | WebRTC는 STUN/TURN 필요 가능. QUIC/WebTransport는 HTTP/3 · UDP 지원 필요 |
| **KCLOUD VM (VPN 내부)** | HTTP/REST, WebSocket, Socket.IO, SSE, WebRTC 시그널링 | 접속 기기 VPN 필요. 기본 허용 포트: **22, 80, 443**. 개발 포트(3000, 8000, 8080 등)는 직접 접근 제한 가능 | TCP Socket은 포트 제한 있음. gRPC는 HTTP/2 설정 필요. WebRTC 미디어·UDP·QUIC/WebTransport 비권장 |
| **KCLOUD VM + Tunnel** | HTTP/REST, WebSocket, Socket.IO, SSE, WebRTC 시그널링 | VM의 `localhost:<port>`를 도메인에 연결. `localPort`는 **1024~65535**. 예: 3000, 8000, 8080 가능 | 순수 TCP Socket, UDP, WebRTC 미디어/DataChannel, QUIC/WebTransport 불가. gRPC 보장 어려움 |
| **외부 서비스 + 우리 도메인** | HTTP/REST, WebSocket, Socket.IO, SSE, WebRTC 시그널링 | Vercel/Netlify/Railway/Render/AWS/GCP 등에 배포 후 CNAME/A 레코드 연결. 보통 외부는 **443** 사용 | WebSocket/gRPC/TCP/UDP는 플랫폼 지원 여부 확인 필요. 서버리스 플랫폼은 장시간 연결 제한 가능 |
| **서버 없이 외부 SaaS 사용** | Supabase Realtime, Firebase, Pusher/Ably, LLM API Streaming | 직접 포트 관리 불필요. 각 서비스 SDK/API 사용 | 커스텀 TCP/UDP 서버 구현 불가. WebRTC는 STUN/TURN 필요할 수 있음 |

### LLM Wrapper

- https://github.com/teddylee777/openai-api-kr
- https://github.com/teddylee777/langchain-kr
- https://devocean.sk.com/blog/techBoardDetail.do?ID=167407
- https://mastra.ai/docs

### Cross-Platform

- https://flutter.dev/
- https://reactnative.dev/
- https://docs.expo.dev/
- https://kotlinlang.org/multiplatform/
