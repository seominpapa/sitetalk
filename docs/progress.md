# Site Talk 단계별 진행 기록

기준일: 2026-09-13. 이 기록은 구현과 검증을 구분합니다. 브라우저·배포 결과가 나오면 해당 단계와 수용 기준을 함께 갱신합니다.

## Phase 1 — 프로젝트·Cloudflare 설정

- 구현: React/Vite와 Worker 소스 분리, 공통 타입·API client, Worker Assets 동일 origin 설정, D1/R2/DO/Cron 바인딩.
- 변경 파일: `package.json`, `vite.config.ts`, `tsconfig.json`, `wrangler.jsonc`, `.env.example`, `.gitignore`, `packages/shared/*`.
- 시험: typecheck·dry-run에 이어 사용자 승인 범위의 Wrangler 인증과 실제 [Worker 배포](https://site-talk.sjkwak300.workers.dev)를 완료했습니다. VAPID 등록 후 활성 버전 `036c5e8b-6dfa-41a5-b395-1f2b02a1fd97`, health 200, Cron 한국 시간 23:50 확인.
- 남은 작업: GitHub Actions의 자동 배포. 원격 사용자 E2E는 전체 4/4 통과했습니다.
- 발견 문제: 이전 인증·R2 승인 장애는 해소됐습니다. account_id·실제 D1 ID를 고정했고, R2는 약관·반복 초과 과금의 명시적 승인 후 활성화했습니다.

## Phase 2 — D1 Schema / Migration

- 구현: 사용자, 해시 세션, rate limit, 방·참여자·순서 있는 메시지, 첨부 metadata, 종료·읽음·Push·archive job 테이블. FK/unique/CHECK 및 종료 방 메시지 차단 trigger.
- 변경 파일: `database/migrations/0001_initial.sql`, `tests/schema.test.mjs`.
- 시험: 테스트를 먼저 실패시킨 후 구현. schema 6/6 통과; 닫힌 방 INSERT 차단, cross-room 첨부 FK, 종료 transaction rollback, 원자적 rate-limit 검증.
- 시험 추가: APAC `site-talk` D1(`b274b206-a838-4ae2-8a05-30a475682abe`)에 migration 23개 명령 적용 및 `messages_active_room` trigger 존재 확인.
- 시험 추가: 원격 E2E에서 기록 보존·동시 전송/종료·중복 방지·읽음 위치 확인.
- 남은 작업: 이번 migration과 원격 사용자 흐름의 미검증 항목 없음; 전체 서비스 잔여 조건은 별도입니다.
- 발견 문제: 날짜 기한과 timestamp를 혼동하지 않도록 각각 날짜 문자열/epoch ms로 고정했습니다.

## Phase 3 — User / Room UI

- 구현: 비밀번호 인증, 프로필·알림 설정·로그아웃, 방 유형·목적·참여자·프로젝트·공종·위치·키워드 생성 UI.
- 변경 파일: `apps/worker/src/auth.ts`, `crypto.ts`, `http.ts`, `index.ts`; `apps/web/src/App.tsx`, `forms.tsx`, `ui.tsx`; `scripts/test-users.mjs`, `scripts/create-user.mjs`.
- 시험: auth/http 시험 통과. 세션 cookie/hash, 잘못된 날짜 400, PBKDF2 횟수, JSON/Origin 검증 포함. 로컬 UI 로그인·생성·API 초대 권한·metadata·로그아웃 E2E 통과. 브라우저 Push unsubscribe 실패 시 서버 로그아웃 보장을 RED→GREEN 검증했습니다.
- 구현 추가: 원격 관리자 1명과 검증 사용자 2명을 발급하고 원격 관리자 API 로그인·로그아웃 200을 확인했습니다. 비밀번호 파일은 ignored·0600이며 문서에 포함하지 않습니다.
- 시험 추가: 원격 UI 로그인·방 생성·초대 권한·로그아웃 시험 통과.
- 남은 작업: Google OAuth는 명세에서 허용한 대체 인증 이후 확장입니다.
- 발견 문제: 계정 없는 로그인에서 두 번 해시하던 시간차, 잘못된 날짜의 500 응답을 수정했습니다. 공개 테스트 로그인은 제공하지 않습니다.

## Phase 4 — Realtime Chat

- 구현: 방별 DO WebSocket, D1 영구 저장 후 broadcast, 메시지 seq·중복방지, unread·읽음 위치, 재연결 기록 복구.
- 변경 파일: `apps/worker/src/room.ts`, `data.ts`, `index.ts`; `apps/web/src/Chat.tsx`, `chat-state.ts`; `apps/web/tests/chat-state.test.mjs`.
- 시험: 재연결·첫 페이지·메시지 중복 단위 시험과 두 Chrome 세션 양방향·reload·API 중복·unread E2E 통과. 실제 WebSocket을 닫고 offline 중 55개 메시지를 추가한 뒤 재연결해 전체 순서 복구를 확인했습니다. Shift+Enter 줄바꿈도 확인했습니다.
- 시험 추가: 원격 양방향·reload·실제 WS 종료 후 55개 재연결 복구·전체 순서 검증 통과.
- 남은 작업: 다른 실제 기기·현장 네트워크의 사용성 점검.
- 발견 문제: 최신 50개만 병합하면 중간 기록이 누락되는 문제를 수정했습니다.

## Phase 5 — 파일 / 이미지 Upload

- 구현: R2 파일 저장, D1 metadata, 인증 다운로드, 이미지/PDF 미리보기, clipboard·drop·진행률 UI, 재시도 identity.
- 변경 파일: `apps/worker/src/room.ts`, `index.ts`; `apps/web/src/Chat.tsx`, `chat-state.ts`.
- 시험: schema·재시도 identity·byte signature 분류 11사례(단일 시험) 통과. 로컬 PNG 합성 paste·이미지 확대·drag/drop·PDF 원본 bytes·비참여자 거부 E2E 통과. PDF를 주장하는 HTML을 octet-stream·attachment로 강제함을 검증했습니다.
- 시험 추가: 원격 이미지 paste 이벤트·확대·drop·PDF 원본 bytes·비참여자 차단·MIME 위장 처리 통과.
- 남은 작업: 실제 OS Cmd/Ctrl+V와 R2 장애 주입 cleanup 검증.
- 발견 문제: DO 입력 gate 안에서 R2 stream 완료를 기다리면 업로드가 멈추는 문제가 발견되어 R2 저장을 gate 밖으로 이동했습니다. 이후 commit 결과를 확인해 고아 파일만 정리합니다. 커밋된 파일은 보존합니다.

## Phase 6 — Web Push

- 구현: Service Worker subscription, D1 저장, endpoint 검증, VAPID 서명·암호화, visibility 대상 선택, 만료 endpoint 정리.
- 변경 파일: `apps/worker/src/push.ts`, `index.ts`, `room.ts`; `apps/web/public/sw.js`, `apps/web/src/forms.tsx`; `scripts/vapid.mjs`; Push 관련 시험.
- 배포 설정: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` 세 원격 Secret 이름 등록을 확인했습니다.
- 시험: independent ECDH/HKDF 복호화, ES256 VAPID, SSRF 거부, 숨긴 참여자만 선택, 404/410 제거·일시 오류 보존 시험 통과. VAPID 생성 도구의 비공개 0600 파일·기존 키 덮어쓰기 차단을 RED→GREEN으로 검증했습니다.
- 남은 작업: 실제 HTTPS 브라우저 구독·숨긴 앱 수신·클릭 이동·로그아웃 이후 계정 격리 검증.
- 발견 문제: 구독 validation 반환값과 저장 코드의 필드 구조 불일치를 수정했습니다. 로그아웃 시 Push 정리는 best effort로 수행하고 브라우저 정리가 실패해도 서버 세션을 무효화합니다. 실제 알림의 로그아웃 이후 격리는 별도 검증이 필요합니다. 모의 push fetch는 실제 알림 수신 증거가 아닙니다.

## Phase 7 — Room 종료

- 구현: 결론·담당자·기한·메모 저장, 방 읽기 전용 전환, archive job 생성, 종료 이벤트.
- 변경 파일: `apps/worker/src/room.ts`; `apps/web/src/Chat.tsx`; schema와 종료 관련 시험.
- 시험: DB trigger·transaction rollback 시험 통과. 로컬 동시 전송/종료, UI 종료 정보 저장, 종료 뒤 메시지·첨부 409 및 기존 PDF 보존 E2E 통과.
- 시험 추가: 원격 종료 정보·동시 요청·종료 후 409·기존 PDF 보존 통과.
- 남은 작업: 종료 기능의 현재 명세 경로는 로컬/원격 검증 완료.
- 발견 문제: 응답 유실 뒤 종료된 방의 동일 client ID는 기존 메시지를 먼저 확인하도록 수정했습니다. gate 안에서 validation 오류를 처리해 일반 400/409가 DO 재시작·500으로 바뀌지 않도록 보완했습니다.

## Phase 8 — 검색

- 구현: 제목·목적·메시지·참여자 이름·프로젝트·공종·위치 검색. 방 참여 권한 필터와 LIKE wildcard escape.
- 변경 파일: `apps/worker/src/index.ts`, `apps/web/src/App.tsx`.
- 시험: typecheck 통과. 로컬 7개 검색 대상 및 비참여자 결과 제외 E2E 통과.
- 시험 추가: 원격 7종 검색 결과·비참여자 제외와 방 UI 이동 통과.
- 남은 작업: 검색 기능의 현재 명세 경로는 로컬/원격 검증 완료.
- 발견 문제: 검색은 MVP SQL 검색이며 RAG/AI 검색이 아닙니다.

## Phase 9 — Cron / OpenAI Markdown Archive

- 구현: 한국 시간 23:50 Cron, 누락 종료 방 재수집, lease·재시도, 긴 대화의 전체 메시지·첨부 구간 분할, OpenAI 구조화 응답, 원문 보존 Markdown, 비공개 R2 저장.
- 변경 파일: `apps/worker/src/archive.ts`, `index.ts`, `wrangler.jsonc`; `tests/archive.test.mjs`, `tests/push-archive-integration.test.mjs`.
- 시험: 원문·종료 보존, fence·동명 key, 동시 Cron claim, 실패·lease 복구, AI 거부, 긴 대화 모든 기록 보존과 실제 요청 본문 한도 시험 통과. 사용자 승인으로 안전하게 설정한 키의 실제 요청은 HTTP 429로 실패했습니다.
- 남은 작업: OpenAI 계정 충전 확인 후 원격 Secret 등록·실제 성공 응답·Cron 아카이브 검증. 로컬 키는 `.dev.vars`에 0600으로 저장했습니다. 반복 실패로 재시도가 소모되지 않도록 원격 OpenAI 키는 의도적으로 미등록 상태입니다.
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
- 시험 추가: 원격 전체 E2E 4/4(3.0분) 통과. 핵심 2.3분, 원자성 14.0초, 읽음/초대 25.2초, 로그아웃 4.3초. 원격 화면도 검토했습니다.
- 남은 작업: 실제 Push·OS 클립보드·AI 아카이브·최종 감사·전체 coverage·CI/CD 성공 증거.
- 발견 문제: 최초 GitHub E2E에서 방 목록 응답 지연이 메시지 전송 잠금을 유지하는 경합을 확인했습니다. 목록 갱신을 메시지 전송 완료와 분리한 후 1.5초 지연 회귀 검사 포함 로컬 전체 4/4(6.4초), 단위·통합 33/33, typecheck·build를 재통과했습니다. 원격 재검증은 별도입니다. isolated Push/Archive coverage를 전체 앱 80% coverage로 주장할 수 없습니다. 현재 전체 80% 조건은 미입증입니다.

## 외부 환경에서 남은 사항

1. Wrangler 인증·R2 활성화·비공개 APAC Standard 버킷·D1 migration·Worker 배포·원격 E2E 4/4를 확인했습니다.
2. OpenAI 잔액 충전 확인 후 원격 키 등록과 실제 아카이브 검증이 필요합니다. VAPID 세 원격 Secret은 등록됐으며 실제 Push 수신 검증은 남았습니다.
3. [과거 Actions 실행](https://github.com/seominpapa/sitetalk/actions/runs/34743470826)은 테스트 job 통과·deploy job 토큰 미설정 실패였습니다. 현재 GitHub account ID Secret은 등록됐지만 `CLOUDFLARE_API_TOKEN`이 없어 자동 배포는 미완료입니다.
4. 실제 OS 클립보드·Push·AI 아카이브·전체 coverage 요구조건을 검증해야 합니다.

위 항목의 증거가 확보되기 전에는 전체 MVP를 완료로 표시하지 않습니다.

## 2026-10-21 — 현장 가입 승인 / 관리자 공통 API / 현장 공유 요약 (로컬, 미배포)

- 사용자 승인 범위: 구현과 로컬 시험만. 배포 전 결과 보고가 필수이며 원격 D1·R2·Secret·GitHub·운영 Worker는 변경하지 않습니다.
- 설계/마이그레이션: `sites`, 현장별 `site_memberships`, 승인 이력 `membership_events`, 암호화 `ai_settings`, 검색 가능한 `summary_records` 추가. 기존 방의 nullable `site_id`를 자동 채우지 않아 과거 원문을 임의로 현장 전체에 공개하지 않습니다. 새 방은 승인된 현장에 연결하며 기존 계정은 관리자 설정에서 현장 배정이 필요합니다.
- 권한: 신규 가입은 pending 일반 사용자. 관리자는 모든 현장 승인·배정·담당자 승격, 현장담당자는 자기 현장 pending 회원만 승인·반려합니다. SQL의 현재 권한/상태 조건으로 동시 승인 경합을 막고 이력은 같은 transaction에 기록합니다. 승인 취소 시 기존 방 API, WebSocket 전달/heartbeat, Push 대상도 차단합니다.
- 요약: 글로벌 공통 키·모델을 Cron 한 번당 한 번 해석하고 모든 방에 사용합니다. 별도 서버 KEK로 AES-GCM 암호화한 D1 키를 우선하며 복호화 오류 시 fallback하지 않습니다. 키 원문은 응답하거나 브라우저에 저장하지 않습니다. AI 실패는 원문을 보존합니다. 성공 요약과 done 상태를 함께 저장합니다.
- UI: 로그인 가입 신청, 관리자/현장담당자 `설정 → 승인 설정`, 관리자 `설정 → AI 요약 설정`, 현장 요약 조회·검색, deep link 원문 읽기 전용·이전 기록·권한 있는 첨부 다운로드. 현장 비참여자의 공유 조회는 참여/쓰기/초대/읽음/WS와 별도 경로입니다.
- TDD: 사이트 접근 테스트의 없는 모듈 실패와 승인 대기 UI의 대화 생성 활성화 실패를 먼저 확인하고 구현했습니다. API 키·암호화 오류·공통 키 적용·트랜잭션 rollback도 모의 API로 검증합니다. 실제 유료 API 호출은 없습니다.
- 검증 결과: 최초 단위/통합 51/51, 브라우저 전체 12/12, typecheck·build·diff check 통과. 아래 스트림 수정 후 브라우저는 13/13입니다. 신규 서버 모듈 3개 coverage는 lines/functions 100%, branches 97.33%입니다. 실제 로컬 Worker API 통합 시험에서 동시 승인(200/409), 현장담당자 승격, 동일 현장 비참여자 원문/파일 열람, 다른 방 파일 ID 대입 거부, 승인 취소 후 기존 WebSocket의 다음 메시지 차단을 확인했습니다. 상세 범위는 acceptance의 최신 항목에 기록합니다.
- 발견/수정: Wrangler는 단순 process env만으로 Worker Secret binding을 만들지 않아 첫 설정 통합 시험에서 503을 확인했습니다. 로컬 E2E 서버의 CLI `--var`로 공개 테스트용 KEK만 바인딩해 해결했습니다. 반복 가입 시험의 IP rate limit은 독립된 로컬 테스트 IP로 격리하며 운영 제한은 완화하지 않았습니다. 기존 E2E도 명시적 fixture 현장 선택으로 변경해 현장 추가 순서에 의존하지 않도록 했습니다.
- 최초 로컬 진단(아래 후속 작업에서 해결): 일반 참여자의 초대 요청이 기대한 403으로 거부되는 시험에서 Wrangler/workerd가 `Can't read from request stream after response has been sent` 경고/오류 로그를 남겼습니다. 요청 본문 취소 후보로 해결되지 않아 해당 후보 수정은 철회했습니다.
- 잔여/위험: 운영 migration·암호화 Secret·실제 API 키 등록 및 계정 잔액·유료 OpenAI 응답·원격 Cron/R2·실제 Push/PWA/OS 클립보드는 검증하지 않았습니다. 암호화 Secret 손실 시 저장된 API 키 복호화가 불가능합니다. Node coverage는 실행된 단위/통합 대상만 계측하며 TSX/Worker entry/DO를 포함한 전체 앱 80%를 입증하지 않습니다.

## 2026-10-21 — 요청 스트림 오류 해결 / 배포 사전 점검 (미배포)

- 범위: 남은 오류 수정·회귀 시험·배포 준비. 운영 변경은 승인 전까지 보류합니다. 이전 확장의 미커밋 변경은 보존했습니다.
- 재현/TDD: `npm run test:e2e -- tests/e2e/request-stream.spec.ts`로 최소 로그인→방 생성→비생성자 초대를 실행했습니다. HTTP 403은 통과해도 정확한 스트림 오류 로그로 실행 전체가 exit 1이 되는 RED를 확인했습니다. 기존 읽음/초대 시험도 같은 RED였습니다.
- 원인/수정: Worker가 아직 소비되지 않은 원본 JSON 요청 스트림을 DO로 전달하고 DO가 본문을 읽지 않은 채 조기 거부하는 경로입니다. 공통 전달 지점 `index.ts`에서 기존 32,768바이트 제한으로 본문을 먼저 읽고 새 Request로 전달합니다. DO의 권한 검사 순서는 유지하고 파일 업로드·WebSocket 경로는 변경하지 않습니다. 의존성 업그레이드나 무제한 body drain은 하지 않았습니다.
- 회귀: 권한 없는 유효/잘못된 JSON은 403, 정상 권한의 잘못된 JSON은 400, 잘못된 content-type은 415, 정확한 32KB 요청 수용/초과 413, 정상 초대·종료, 종료 후 409 확인. 오류 문자열이 다시 나오면 E2E 래퍼가 실패하며 로컬 서버 재사용도 금지해 로그 검사를 우회하지 못하게 했습니다.
- 검증: 단위·통합 51/51, 전체 브라우저 13/13에서 스트림 오류 없음. 최소 회귀는 별도 5회 연속 통과(2.4초). typecheck·build·diff check 통과, 운영 런타임 의존성 `npm audit --omit=dev` 취약점 0건, Worker dry-run 번들 75.05 KiB / gzip 19.20 KiB. 읽기 전용 코드·보안 검토에서 신규 HIGH/MEDIUM 지적 없음.
- 배포 준비: 읽기 전용 운영 Secret 이름 목록은 VAPID 3종뿐이며 KEK/OpenAI 키는 미등록, 운영 D1 미적용 목록은 `0002_sites_and_settings.sql` 한 개입니다. README에 백업·Secret·migration·배포·사용자 배정·사후 검증 및 권한을 보존하는 복구 순서를 기록했습니다. DB 변경·Secret 등록·배포·push·Actions 실행은 하지 않았습니다.

## 2026-10-21 — 승인된 운영 백업·마이그레이션·Secret·배포 및 실제 UI 검증

- 사용자 승인: 운영 DB 백업, `0002` 적용, 새 암호화 Secret 등록, 실제 배포, 가입 승인·관리자 API 설정 확인. 실제 OpenAI 키 등록·유료 호출과 Git push는 하지 않습니다.
- 백업: `.wrangler/backups/pre-sites-20261021/site-talk.sql`, 56,685 bytes, 0600, SHA-256 `8284a0a74588b20534b73440dba53bd32e5a9d8717a1a0442dbf724f44619ccb`. SQLite 메모리 복원 `integrity_check=ok`, FK 위반 0, `0002` 모의 적용 후 기존 행 수·방 권한 유지 확인. 복구 북마크와 이전 Worker 버전은 같은 비공개 디렉터리의 `verification.json`에 기록했습니다. D1 백업이며 R2 파일은 변경하지 않았습니다.
- 사전 보안 문제/해결: 전체 audit에서 dev 도구 HIGH 6건이 확인돼 원격 변경을 일시 중지하고 `npm audit fix`(force/major/override 없음) 적용. Wrangler 4.151.3, Vite 7.3.7 등 정상 버전 조합으로 갱신한 뒤 전체 audit 0건, 단위·통합 52/52, 로컬 브라우저 13/13 통과(운영 전용 1건은 기본 skip), 타입·빌드·dry-run 통과. 새 키 생성기의 무작위 32bytes·0600·덮어쓰기 금지는 RED→GREEN 시험으로 확인했습니다.
- 운영 적용: `0002_sites_and_settings.sql` 10명령 성공. 공통 API 암호화 키는 private 백업 후 기존 Secret 없음 재확인·stdin으로 등록, 키 원문 미출력. VAPID 3종 보존 및 적용 후 미적용 migration 0개 확인.
- 배포: Worker `ac2702be-84a2-4ad7-898b-aaee7e76d54c`, health 200, 한국시간 23:50 Cron 유지. 수동 Wrangler 배포이며 GitHub 자동 배포 검증은 아닙니다.
- 실제 운영 화면: opt-in `production-smoke.spec.ts` 1/1(12.9초). 별도 합성 현장에서 관리자 담당자 지정→공개 가입 신청→pending 차단→담당자 승인→관리자 승격 확인. 관리자 AI 설정의 `storage_ready=true`, 빈 비밀번호 입력, 모델·미등록 상태, 잘못된 키 400, 비관리자 403 및 DB 설정 미변경을 확인했습니다. 실제 키·가짜 유효 키 모두 운영에 저장하지 않았습니다. trace/video는 비활성화하고 민감 입력 없는 두 화면을 직접 검토했습니다.
- 정리/보존: 새 합성 현장·신규 계정·그 소속/이력만 정확한 ID로 삭제. 기존 사용자 3·방 6·메시지 123·첨부 8·아카이브 작업 3개 유지, FK 위반 0. 실제 현장·소속·공통 API 설정은 비어 있어 관리자 초기 설정이 필요합니다.
- 보안 기록: DB export CLI가 1시간 유효 다운로드 URL을 도구 기록에 출력했습니다. URL은 재출력·공개 공유하지 않고 관련 로컬 Wrangler 로그는 0600으로 제한했습니다. 지원되는 즉시 폐기 API는 확인하지 못했으며 백업 관련 채팅/로그를 민감 자료로 취급해야 합니다. 새 암호화 Secret 원문은 출력하지 않았습니다.
- 남은 검증: 실제 API 키 저장·OpenAI 잔액/유료 성공·Cron→R2, 실제 Push/PWA/OS 클립보드 및 전체 앱 coverage 80%. 운영 신규 UI 성공을 이 항목들의 완료 증거로 대신하지 않습니다.

## 2026-10-21 — 가입 비밀번호 규칙 / 현장담당자 현장 생성 요청 (로컬, 미배포)

- 운영 계정 작업: 사용자가 지정한 관리자 비밀번호로 해시 변경, 해당 관리자 세션만 종료, 새 비밀번호 로그인·관리자 본인 확인·이전 비밀번호 `LOGIN_FAILED`·시험 세션 로그아웃 확인. 비밀번호·해시·세션 값은 문서에 기록하지 않습니다. 다른 사용자나 운영 코드 배포는 변경하지 않았습니다.
- 가입 규칙: 신규 팀원·현장담당자 가입은 8자 이상·숫자·특수문자 필수. 공유 검증 함수를 UI와 가입 API에서 사용하며 관리자 및 기존 계정 로그인에는 적용하지 않습니다. 공백·한글 글자를 특수문자로 오인하지 않고 추가 대소문자 조건을 강제하지 않습니다.
- 새 가입 흐름: 팀원은 기존 현장 선택, 현장담당자는 새 현장명을 입력해 생성 요청. `users.role`은 항상 일반 계정이며, 현장이나 소속은 관리자 승인 전 생성하지 않습니다. 현장이 하나도 없는 경우에도 요청할 수 있습니다.
- 승인: 관리자 `설정 → 승인 설정 → 현장 생성 요청`에서 승인·반려. 승인 시 새 현장·승인된 담당자 소속·이력·요청 상태를 D1 batch로 함께 반영합니다. 반려·중복 결정·동시 처리 패자는 권한을 얻지 않습니다. 가입자는 자신의 요청 상태만 조회하며 현장담당자는 현장 생성 요청을 승인할 수 없습니다.
- 마이그레이션: 추가 전용 `0003_site_creation_requests.sql`은 로컬 DB에만 적용했습니다. 기존 현장·사용자·방 데이터를 변경하지 않습니다. 운영 DB 마이그레이션·새 코드 배포·Git commit/push는 하지 않았습니다.
- TDD/검증: 규칙 단위·가입 API의 RED 및 새 가입 유형/관리자 요청 목록/신청자 상태 UI의 RED 확인 후 구현. 전체 단위·통합 91/91, 설치된 Chrome 브라우저 18/18(운영 opt-in 1개 skip), typecheck·build 통과. 실제 로컬 Worker에서 가입→대기 차단→관리자 승인→담당자 배정과 반려·개인 요청 격리를 확인했습니다. 요청 스트림 오류 없음. 별도 읽기 전용 보안 검토에서 주요 지적 없음.
- coverage: 실행된 Node 단위·통합 대상 line 97.75%, branch 95.38%, function 96.49%; 새 비밀번호 규칙과 `site-requests.ts`는 모두 100%. TSX/Worker entry/DO를 포함한 전체 앱 80%를 입증하는 수치는 아닙니다.
- 도구: 첫 CI 모드 브라우저 시도는 새 Playwright headless 실행 파일 미설치로 시작하지 못했습니다. 브라우저 다운로드나 의존성 변경 없이 기존 Chrome 채널로 재실행해 전체 통과했습니다.
- 남은 작업/위험: 승인 후 운영 백업·`0003` 적용·배포·운영 가입/생성 요청 검증이 필요합니다. 반려된 생성 요청의 재신청·기존 계정의 추가 현장 생성 요청은 이번 범위에 포함하지 않았습니다. 관리자에게 요청한 짧은 숫자 비밀번호는 보안상 취약하므로 긴 비밀번호 사용을 권장합니다.

## 2026-10-21 — 가입 비밀번호 재입력 및 현장 생성 요청 운영 반영 완료

- 사용자 승인: 운영 DB 백업 후 `0003` 적용·배포·실제 가입/승인/반려 시험. 회원가입 비밀번호 재입력을 추가하며 기존 로그인은 변경하지 않습니다.
- 구현: 가입 화면에 필수 `비밀번호 확인`(마스킹·새 비밀번호 자동완성)을 추가했습니다. UI와 가입 API가 누락·불일치를 거부하고, 확인용 비밀번호는 저장하지 않습니다. 모든 가입 호출자·시험 fixture를 갱신했습니다. 직접 가입 API 호출도 `password_confirmation`이 필요합니다.
- TDD/배포 전 검증: 확인값 누락·불일치 API 및 UI의 RED 확인 후 구현, 단위·통합 101/101과 로컬 브라우저 19/19 통과(운영 opt-in 2건 기본 skip). 타입·빌드·Worker dry-run·`git diff --check` 통과, 전체 `npm audit` 취약점 0건. 실행된 Node 대상 coverage line 97.76%, branch 95.39%, function 96.49%; 전체 앱 coverage는 아닙니다. 별도 읽기 전용 코드/보안 검토에서 주요 지적 없음.
- 운영 백업: `.wrangler/backups/pre-signup-20261021/site-talk.sql`, 59,339 bytes, 0600, SHA-256 `2bf972db07abb1b4ff770820824147d3df34ca613ea9ce1be702200a4c48decb`. 메모리 복원 무결성 정상·FK 위반 0, `0003` 모의 적용 후 기존 행 전체 보존. 처음 검증은 Node SQLite의 기본 FK 활성화와 export의 테이블 순서 때문에 실패했으나, 임시 복원 중 FK 검사를 끄고 완료 후 다시 켜서 전체 관계를 검증했습니다. 운영 FK 설정이나 백업 원문은 변경하지 않았습니다. 다운로드 URL과 SQL 원문은 출력하지 않았습니다.
- 배포: `0003_site_creation_requests.sql` 운영 적용, 기존 Secret 4종 보존. Worker `313e4511-3270-4522-af6e-9a9bc9c88853`에 트래픽 100%, health 200. 기존 도메인·R2·23:50 KST Cron 유지. 복구 북마크·이전 버전·백업 검증 결과는 같은 비공개 디렉터리의 `verification.json`에 기록했습니다. 롤백 시 추가 전용 `0003` 테이블은 유지하며, 실제 신규 사용자 쓰기 이후 DB 전체 복원을 임의 수행하지 않습니다.
- 실제 운영 브라우저: opt-in `production-signup.spec.ts` 1/1(시험 21.6초) 통과. UI의 8자 미만/숫자 누락/특수문자 누락/확인값 누락·불일치 차단, API의 잘못된 정책·불일치 400을 확인했습니다. 담당자 가입→pending 차단→관리자 승인→새 현장 및 담당자 배정, 별도 담당자 가입→관리자 반려→현장/소속 미생성·계속 차단, 팀원 가입→담당자 승인까지 실제 화면과 API로 확인했습니다. 전역 관리자 권한은 부여하지 않으며 비관리자의 현장 생성·관리자 처리 시도는 403입니다.
- 시험 자료 정리: 정확한 합성 사용자 3명·생성 요청 2개·현장 1개·소속 2개·이력 2개만 삭제했습니다. 삭제 CLI 응답에 진행 문구가 섞여 JSON 파싱이 실패했으므로 삭제를 재실행하지 않고 읽기 전용으로 결과를 확인했습니다. 이후 기존 도메인 테이블의 모든 행을 백업과 대조해 완전 일치, FK 위반 0, 기존 사용자 3·방 6·메시지 123·첨부 8·작업 3 유지 확인. 운영 시험 기록은 같은 비공개 디렉터리의 `production-verification.json`과 `production-signup-journal.json`에 보존했습니다.
- 범위 밖/위험: 실제 OpenAI 호출·Push/PWA·OS 클립보드·Git push/Actions는 이번에 수행하지 않았습니다. 관리자 짧은 비밀번호의 보안 위험은 여전히 존재하며 긴 비밀번호를 권장합니다. 반려된 생성 요청의 재신청·기존 계정의 추가 현장 생성 요청은 미구현입니다.

## 2026-10-21 — 최신 요약 모델 카탈로그 추가 (로컬 검증, 미배포)

- 요청: 저장한 공통 API 키를 유지하고 `gpt-6-luna`, `gpt-6.1-sol` 등 최신 모델을 선택할 수 있도록 추가. 공식 OpenAI 모델 문서에서 ID·Responses API·Structured Outputs 지원을 대조했습니다.
- 변경: `packages/shared/ai-models.ts`의 변경 불가 공유 목록에 `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra`를 추가하고 관리자 선택기·서버 저장/조회 검증이 함께 사용합니다. 기존 네 모델·기본값·저장된 키/선택 모델·요약 요청 형식은 변경하지 않습니다. 새 의존성이나 DB 마이그레이션은 없습니다.
- TDD/검증: 새 모델 저장의 `INVALID_MODEL` RED 후 구현. 단위·통합 103/103, 관리자 화면 브라우저 13/13, 타입·빌드·diff 검사 통과. AI 설정/공유 목록 대상 coverage line/function 100%, branch 95%; 전체 앱 coverage는 아닙니다. 모의 Responses 요청에 선택 모델·엄격 JSON 형식이 전달되고, 모델 변경 시 암호문이 그대로 유지되며 키/유료 호출 없이 저장됨을 확인했습니다. 별도 읽기 전용 코드/보안 검토에서 지적 없음.
- 시험 보정: 새 UI 시험의 정확한 label-text 탐색이 select 옵션까지 포함해 실패해 접근성 역할 `combobox`와 이름으로 탐색하도록 수정했습니다. 실제 UI 오류가 아니며 재실행 전체 통과했습니다.
- 운영 상태: 이번 카탈로그 변경은 아직 배포하지 않았으며 현재 운영 버전은 위 `313e4511-3270-4522-af6e-9a9bc9c88853` 기록 그대로입니다. 운영 DB·Secret·저장된 API 키/모델은 수정하지 않았습니다. 실제 유료 호출·계정별 모델 접근 권한·모델별 요약 품질/시간은 미검증이며 배포 승인을 기다립니다.

## 2026-10-21 — 최신 모델 카탈로그 배포 및 GitHub 반영

- 사용자 승인 범위: 최신 카탈로그 운영 배포와 GitHub push. 의존하는 기존 미커밋 현장 승인·관리자 API·공유 요약·가입/비밀번호 확인 구현 및 회귀 시험도 함께 커밋 대상입니다. 운영 DB/Secret/키/선택 모델 변경과 실제 유료 호출은 하지 않습니다.
- 사전 검증: 단위·통합 103/103, 전체 로컬 브라우저 20/20(운영 opt-in 2건 skip), 타입·빌드·dry-run·diff 검사 통과, `npm audit` 취약점 0건. 별도 읽기 전용 코드/보안 검토에서 주요 지적 없음. 비공개 파일 제외 및 실제 키/토큰 패턴 검사 통과.
- 배포: Worker `7e35a8bb-dfdf-4590-8b3e-99711782864f`, 트래픽 100%, health 200. 미적용 migration 0개이며 이번 작업에서는 마이그레이션을 실행하지 않았습니다. 이전 버전 및 비공개 검증 기록은 ignored `.wrangler/releases/` 아래 보관합니다.
- 운영 UI: 실제 관리자로 로그인해 새 모델 세 개·기존 모델 네 개의 선택 가능 여부 확인, 키 입력은 빈 마스킹 상태. 저장 버튼을 누르지 않았으며 설정 PUT 0회, API 전후 설정 상태와 DB의 암호문·모델·수정 정보가 모두 동일함을 확인했습니다. 시험 세션은 로그아웃했습니다. FK 위반 0건.
- GitHub: 기존 `main`과 원격 `main`의 기준 커밋 일치를 확인했습니다. `.wrangler`의 DB 백업·로그인 정보·Secret·검증 기록과 `.dev.vars`는 커밋에서 제외합니다. 기존 워크플로는 main push 시 시험·자동 배포를 시도하지만, GitHub Secret 이름을 조회한 결과 `CLOUDFLARE_API_TOKEN`이 없어 자동 배포는 별도 미완료입니다. 이번 운영 반영은 직접 Wrangler 배포 결과입니다.
- 미검증: 실제 OpenAI 모델 호출/잔액/모델별 품질·실제 Push·전체 앱 coverage. 기존 `production-smoke.spec.ts`는 키 미등록 상태를 전제로 하는 초기 배포용 opt-in 시나리오이므로, 키가 등록된 현재 환경에 실행하지 않았습니다.
- 커밋 훅: 테스트 전용 가짜 키/비밀번호의 직접 할당을 generic secret으로 오인해 첫 커밋이 차단됐습니다. 실제 비밀정보가 아님을 확인하고 테스트용 상수를 명확히 분리해 동일 검증을 유지했습니다. 보안 훅을 끄거나 GitHub/Cloudflare 인증정보를 변경하지 않았습니다.
