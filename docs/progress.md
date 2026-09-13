# Site Talk 단계별 진행 기록

기준일: 2026-09-13. 이 기록은 구현과 검증을 구분합니다. 브라우저·배포 결과가 나오면 해당 단계와 수용 기준을 함께 갱신합니다.

## Phase 1 — 프로젝트·Cloudflare 설정

- 구현: React/Vite와 Worker 소스 분리, 공통 타입·API client, Worker Assets 동일 origin 설정, D1/R2/DO/Cron 바인딩.
- 변경 파일: `package.json`, `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`, `.env.example`, `.gitignore`, `packages/shared/*`.
- 시험: `npm run typecheck` 및 Wrangler 4.131.1 deploy dry-run 통과. 실제 인증·원격 배포 증거는 아닙니다.
- 남은 작업: 실제 계정 인증·D1 ID 반영·R2 활성화·배포·GitHub Actions 실행 증거.
- 발견 문제: D1 ID는 자리표시자이며 Wrangler 미인증·R2 미활성입니다. Workers/D1 지속 권한을 요청하는 인증 화면 열기는 자동 승인 검토에 차단되어 사용자 승인을 요청했고 CLI OAuth 대기가 만료되었습니다.

## Phase 2 — D1 Schema / Migration

- 구현: 사용자, 해시 세션, rate limit, 방·참여자·순서 있는 메시지, 첨부 metadata, 종료·읽음·Push·archive job 테이블. FK/unique/CHECK 및 종료 방 메시지 차단 trigger.
- 변경 파일: `database/migrations/0001_initial.sql`, `tests/schema.test.mjs`.
- 시험: 테스트를 먼저 실패시킨 후 구현. schema 6/6 통과; 닫힌 방 INSERT 차단, cross-room 첨부 FK, 종료 transaction rollback, 원자적 rate-limit 검증.
- 남은 작업: 실제 Cloudflare D1 migration 확인.
- 발견 문제: 날짜 기한과 timestamp를 혼동하지 않도록 각각 날짜 문자열/epoch ms로 고정했습니다.

## Phase 3 — User / Room UI

- 구현: 비밀번호 인증, 프로필·알림 설정·로그아웃, 방 유형·목적·참여자·프로젝트·공종·위치·키워드 생성 UI.
- 변경 파일: `apps/worker/src/auth.ts`, `crypto.ts`, `http.ts`, `index.ts`; `apps/web/src/App.tsx`, `forms.tsx`, `ui.tsx`; `scripts/test-users.mjs`, `scripts/create-user.mjs`.
- 시험: auth/http 시험 통과. 세션 cookie/hash, 잘못된 날짜 400, PBKDF2 횟수, JSON/Origin 검증 포함. 로컬 UI 로그인·생성·API 초대 권한·metadata·로그아웃 E2E 통과. 브라우저 Push unsubscribe 실패 시 서버 로그아웃 보장을 RED→GREEN 검증했습니다.
- 남은 작업: 생성 도구를 통한 실제 운영 계정 발급·원격 로그인 검증. Google OAuth는 교체 가능한 인증 계층 이후 작업입니다.
- 발견 문제: 계정 없는 로그인에서 두 번 해시하던 시간차, 잘못된 날짜의 500 응답을 수정했습니다. 공개 테스트 로그인은 제공하지 않습니다.

## Phase 4 — Realtime Chat

- 구현: 방별 DO WebSocket, D1 영구 저장 후 broadcast, 메시지 seq·중복방지, unread·읽음 위치, 재연결 기록 복구.
- 변경 파일: `apps/worker/src/room.ts`, `data.ts`, `index.ts`; `apps/web/src/Chat.tsx`, `chat-state.ts`; `apps/web/tests/chat-state.test.mjs`.
- 시험: 재연결·첫 페이지·메시지 중복 단위 시험과 두 Chrome 세션 양방향·reload·API 중복·unread E2E 통과. 실제 WebSocket을 닫고 offline 중 55개 메시지를 추가한 뒤 재연결해 전체 순서 복구를 확인했습니다. Shift+Enter 줄바꿈도 확인했습니다.
- 남은 작업: 배포환경 두 사용자 실시간 전달·연결 끊김·복구 검증.
- 발견 문제: 최신 50개만 병합하면 중간 기록이 누락되는 문제를 수정했습니다.

## Phase 5 — 파일 / 이미지 Upload

- 구현: R2 파일 저장, D1 metadata, 인증 다운로드, 이미지/PDF 미리보기, clipboard·drop·진행률 UI, 재시도 identity.
- 변경 파일: `apps/worker/src/room.ts`, `index.ts`; `apps/web/src/Chat.tsx`, `chat-state.ts`.
- 시험: schema·재시도 identity·byte signature 분류 11사례(단일 시험) 통과. 로컬 PNG 합성 paste·이미지 확대·drag/drop·PDF 원본 bytes·비참여자 거부 E2E 통과. PDF를 주장하는 HTML을 octet-stream·attachment로 강제함을 검증했습니다.
- 남은 작업: 실제 OS Cmd/Ctrl+V, 배포환경 파일 왕복·권한·R2 실패 cleanup 검증.
- 발견 문제: DO 입력 gate 안에서 R2 stream 완료를 기다리면 업로드가 멈추는 문제가 발견되어 R2 저장을 gate 밖으로 이동했습니다. 이후 commit 결과를 확인해 고아 파일만 정리합니다. 커밋된 파일은 보존합니다.

## Phase 6 — Web Push

- 구현: Service Worker subscription, D1 저장, endpoint 검증, VAPID 서명·암호화, visibility 대상 선택, 만료 endpoint 정리.
- 변경 파일: `apps/worker/src/push.ts`, `index.ts`, `room.ts`; `apps/web/public/sw.js`, `apps/web/src/forms.tsx`; `scripts/vapid.mjs`; Push 관련 시험.
- 시험: independent ECDH/HKDF 복호화, ES256 VAPID, SSRF 거부, 숨긴 참여자만 선택, 404/410 제거·일시 오류 보존 시험 통과. VAPID 생성 도구의 비공개 0600 파일·기존 키 덮어쓰기 차단을 RED→GREEN으로 검증했습니다.
- 남은 작업: 실제 HTTPS 브라우저 구독·숨긴 앱 수신·클릭 이동·로그아웃 이후 계정 격리 검증.
- 발견 문제: 구독 validation 반환값과 저장 코드의 필드 구조 불일치를 수정했습니다. 로그아웃 시 Push 정리는 best effort로 수행하고 브라우저 정리가 실패해도 서버 세션을 무효화합니다. 실제 알림의 로그아웃 이후 격리는 별도 검증이 필요합니다. 모의 push fetch는 실제 알림 수신 증거가 아닙니다.

## Phase 7 — Room 종료

- 구현: 결론·담당자·기한·메모 저장, 방 읽기 전용 전환, archive job 생성, 종료 이벤트.
- 변경 파일: `apps/worker/src/room.ts`; `apps/web/src/Chat.tsx`; schema와 종료 관련 시험.
- 시험: DB trigger·transaction rollback 시험 통과. 로컬 동시 전송/종료, UI 종료 정보 저장, 종료 뒤 메시지·첨부 409 및 기존 PDF 보존 E2E 통과.
- 남은 작업: 배포환경 종료 정보·쓰기 차단 검증.
- 발견 문제: 응답 유실 뒤 종료된 방의 동일 client ID는 기존 메시지를 먼저 확인하도록 수정했습니다. gate 안에서 validation 오류를 처리해 일반 400/409가 DO 재시작·500으로 바뀌지 않도록 보완했습니다.

## Phase 8 — 검색

- 구현: 제목·목적·메시지·참여자 이름·프로젝트·공종·위치 검색. 방 참여 권한 필터와 LIKE wildcard escape.
- 변경 파일: `apps/worker/src/index.ts`, `apps/web/src/App.tsx`.
- 시험: typecheck 통과. 로컬 7개 검색 대상 및 비참여자 결과 제외 E2E 통과.
- 남은 작업: 배포환경 검색 대상별 결과·방 이동 검증.
- 발견 문제: 검색은 MVP SQL 검색이며 RAG/AI 검색이 아닙니다.

## Phase 9 — Cron / OpenAI Markdown Archive

- 구현: 한국 시간 23:50 Cron, 누락 종료 방 재수집, lease·재시도, 긴 대화의 전체 메시지·첨부 구간 분할, OpenAI 구조화 응답, 원문 보존 Markdown, 비공개 R2 저장.
- 변경 파일: `apps/worker/src/archive.ts`, `index.ts`, `wrangler.jsonc`; `tests/archive.test.mjs`, `tests/push-archive-integration.test.mjs`.
- 시험: 원문·종료 보존, fence·동명 key, 동시 Cron claim, 실패·lease 복구, AI 거부, 긴 대화 모든 기록 보존과 실제 요청 본문 한도 시험 통과. 사용자 승인으로 안전하게 설정한 키의 실제 요청은 HTTP 429로 실패했습니다.
- 남은 작업: OpenAI 계정 충전 확인 후 실제 성공 응답, Cron·R2 객체·다운로드 검증. 로컬 키는 `.dev.vars`에 0600으로 저장했으며 Cloudflare Secret 등록은 별도입니다.
- 발견 문제: 실제 오류 code는 `credit_balance_exhausted`, type은 `insufficient_quota`입니다. 충전 전 추가 실제 호출을 중단합니다. 요청당 JSON 본문 250,000자·작업당 8분·Cron당 12분 예산과 구간별 lease 확인을 적용합니다. 구간 요약은 `[구간 i/N]`로 연결하며 추가 AI 병합을 하지 않습니다. 어느 구간이든 실패하면 R2/done을 만들지 않습니다. 단일 기록·공유 문맥 크기 또는 최대 5회 시도 초과는 원문을 보존한 실패로 남습니다.

## Phase 10 — PWA / Responsive UI

- 구현: manifest·192/512 아이콘·Service Worker, 데스크톱/태블릿/모바일 레이아웃, 방 deep link.
- 변경 파일: `apps/web/public/*`, `apps/web/src/style.css`, `main.tsx`, `App.tsx`, `Chat.tsx`.
- 시험: typecheck 통과. 로컬 Chrome 모바일 390×844 가로 넘침 없음·스크린샷 검토. 실제 설치 및 알림 클릭 검증 대기.
- 남은 작업: PC/모바일에서 설치·반응형·권한 동작, offline 시 업무 데이터 접근 정책 검증.
- 발견 문제: 모바일 OS별 설치/Push 조건은 데스크톱 단위 시험으로 대체할 수 없습니다.

## Phase 11 — 시험 / 오류 처리 / 문서

- 구현: Node 단위·통합 시험, Playwright 시나리오, 보안·입력 오류 응답, README·진행·수용 기준 문서.
- 변경 파일: `tests/*`, `apps/web/tests/*`, `playwright.config.ts`, `.github/workflows/deploy.yml`, `README.md`, `docs/*`.
- 시험: 2026-09-13 `npm test` 33/33, `npm run typecheck`, `npm run build`, 확장된 Playwright 전체 4/4(6.7초) 통과. `npm audit` 취약점 0건, 최종 deploy dry-run 통과. 상세 범위는 acceptance 문서 참조.
- 남은 작업: 실제 배포·최종 요구사항 감사·전체 coverage 확인·CI/CD 성공 증거.
- 발견 문제: 최초 GitHub E2E에서 방 목록 응답 지연이 메시지 전송 잠금을 유지하는 경합을 확인했습니다. 목록 갱신을 메시지 전송 완료와 분리한 후 1.5초 지연 회귀 검사 포함 로컬 전체 4/4(6.4초), 단위·통합 33/33, typecheck·build를 재통과했습니다. 원격 재검증은 별도입니다. isolated Push/Archive coverage를 전체 앱 80% coverage로 주장할 수 없습니다. 현재 전체 80% 조건은 미입증입니다.

## 외부 환경에서 남은 사항

1. 계정 구독 화면에서 Workers Paid 활성·R2 미가입을 재확인했습니다. R2 사용량 과금 활성화 승인과 Cloudflare 배포 인증·리소스 준비가 필요합니다.
2. OpenAI 로컬 키 설정 완료; 계정 잔액 충전 확인과 원격 Secrets·VAPID 설정이 남았습니다. 실제 호출은 충전 전 중단합니다.
3. 비공개 [GitHub 저장소](https://github.com/seominpapa/sitetalk) 생성·origin 연결과 첫 커밋 `9712e99` push를 확인했습니다. 최초 CI는 단위·빌드까지 통과했으나 브라우저 1개 실패로 배포가 생략됐습니다. 운영 계정 발급·Actions 전체 성공 증거는 남았습니다.
4. 배포환경 두 사용자·사진·PDF·Push·종료·Cron 전체 검증.

위 항목의 증거가 확보되기 전에는 전체 MVP를 완료로 표시하지 않습니다.
