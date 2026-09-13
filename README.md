# Site Talk

Construction Site Communication — 건설현장의 목적 있는 대화를 만들고, 협의가 끝나면 원문과 결론을 현장 지식으로 보존하는 실시간 업무 메신저입니다.

[Site Talk](https://site-talk.sjkwak300.workers.dev)을 Cloudflare에 배포했고 원격 브라우저 E2E 4/4(3.0분)를 통과했습니다. 실제 브라우저 Push 수신·OS 클립보드 입력·AI 아카이브 성공은 아직 입증되지 않았습니다. 실제 OpenAI 요청은 잔액 부족 오류로 실패했습니다. 요구사항별 증거는 [수용 기준](docs/acceptance.md), 단계별 변경·시험 기록은 [진행 기록](docs/progress.md)에 정리합니다.

## Architecture

```text
React + Vite + TypeScript / PWA
          │ 같은 origin의 /api
          ▼
Cloudflare Worker ── D1: 사용자·세션·방·메시지·읽음·종료 정보
          │
          ├─ 방별 Durable Object ─ WebSocket 실시간 전달
          ├─ R2 ─ 인증된 첨부파일 업로드·다운로드
          └─ Web Push ─ 현재 해당 방을 보지 않는 참여자 알림

Cron(한국 시간 23:50) ─ D1 종료 방 ─ OpenAI ─ Markdown ─ R2
```

프론트엔드와 API 코드는 분리되어 있으며, MVP 배포에서는 Worker Static Assets로 같은 origin에서 제공합니다. 쿠키·WebSocket·파일 인증을 일관되게 유지하며 프론트엔드의 별도 Pages 배포는 필수 조건이 아닙니다. 향후 앱 클라이언트는 공통 API를 사용할 수 있으나, 다른 origin을 이용할 때는 인증·CORS 정책을 함께 설계해야 합니다.

Docker, Python, Railway, 상시 Node 서버를 사용하지 않습니다. Node는 개발·빌드·시험 도구입니다. 업무 데이터는 D1에 영구 저장하고, R2에는 파일과 Markdown만 저장합니다. AI 처리 실패는 채팅 저장 경로에 전파하지 않습니다.

```text
apps/web/                React UI, PWA, 반응형 스타일
apps/worker/src/         HTTP API, 인증, 방별 DO, Push, Archive
packages/shared/        타입과 API 클라이언트
database/migrations/    D1 SQL migration
tests/                  단위·통합·브라우저 E2E
scripts/                로컬 테스트 사용자, VAPID 도구
docs/                   진행 기록과 수용 기준
wrangler.jsonc          Worker, D1, DO, R2, Cron 설정
```

## Local Development

Node.js 24 이상, npm을 사용합니다. 이 작업 환경에서 확인한 Node 버전은 26.5.0입니다. Node 내장 TypeScript 실행·SQLite를 시험에 사용합니다.

```sh
npm install
npm run db:local
npm run test:seed
npm run build
npx wrangler dev --port 8787 --test-scheduled
```

브라우저에서 `http://127.0.0.1:8787`에 접속합니다. 로컬 테스트 사용자 3명의 무작위 비밀번호는 Git에서 제외된 `.wrangler/test-users.json`에만 저장됩니다. `test:seed`는 원격 DB를 수정하지 않으며, 재실행하면 새로운 테스트 계정이 추가됩니다. 테스트 계정 파일을 커밋·공유하지 마세요.

UI를 실시간 수정하려면 API 실행을 유지한 별도 터미널에서 `npm run dev`를 실행하고 `http://127.0.0.1:5173`을 엽니다. Vite가 `/api` HTTP 및 WebSocket을 8787로 전달합니다. 통합·PWA 검증은 빌드 후 8787 origin을 기준으로 합니다.

로컬 비밀값은 저장소 루트의 `.dev.vars`에 설정합니다. 변수 목록은 `.env.example`을 참고하세요. 이 파일에는 실제 값을 넣지 않습니다. 브라우저용 `VITE_` 변수에 OpenAI 키·VAPID 개인키를 넣으면 안 됩니다.

```sh
npm run typecheck
npm test
npm run test:e2e
```

E2E는 `.wrangler/test-users.json`을 사용하고, 8787 서버가 없으면 Playwright 설정이 로컬 Worker를 시작합니다. 로컬에서는 설치된 Chrome을 사용하며, CI에서는 Playwright Chromium을 설치합니다. `E2E_BASE_URL`로 검증 origin을 바꾸면 자동 서버 시작을 생략하며 원격 검증 계정·테스트 데이터 준비도 별도로 필요합니다. 다른 환경의 계정을 로컬 fixture로 간주하지 마세요.

## Cloudflare 설정

Cloudflare 계정에 로그인하고 대상 계정을 확인합니다.

```sh
npx wrangler login
npx wrangler whoami
```

Workers Paid 계정에서 사용자 승인으로 Workers/D1 범위의 Wrangler 인증을 완료했습니다. R2도 약관과 반복 초과 사용량 과금에 대한 명시적 승인 후 활성화를 확인했습니다. `wrangler.jsonc`에는 대상 `account_id`와 실제 D1 ID를 고정했습니다.

배포 URL은 `https://site-talk.sjkwak300.workers.dev`이며 VAPID 등록 후 확인한 활성 버전은 `036c5e8b-6dfa-41a5-b395-1f2b02a1fd97`입니다. Worker·D1·DO·비공개 R2 바인딩과 Cron 배포, health 200까지 확인했습니다. 이는 GitHub Actions 자동 배포 성공이나 실제 Push·AI 처리 성공과는 별도 증거입니다.

## D1 생성 방법

현재 `site-talk` D1은 APAC에 생성되어 있고 ID는 `b274b206-a838-4ae2-8a05-30a475682abe`입니다. 최초 migration 23개 명령 적용과 `messages_active_room` trigger를 확인했습니다. 아래 생성 명령은 새로운 환경을 구성할 때의 참고이며 기존 DB를 다시 만들 필요는 없습니다.

```sh
npx wrangler d1 create site-talk
```

출력의 `database_id`를 `wrangler.jsonc`의 `d1_databases`에 넣습니다. `binding`은 `DB`, `database_name`은 `site-talk`, `migrations_dir`는 `database/migrations`입니다.

```sh
npm run db:remote
```

실제 DB 생성·migration은 계정 데이터를 변경합니다. 배포 대상 계정과 DB 이름을 확인한 후 실행합니다.

## R2 생성 방법

현재 R2는 활성화되어 있으며 `site-talk-files`를 APAC·Standard·비공개로 생성했습니다. `r2.dev` 퍼블릭 액세스 비활성도 확인했습니다. 아래 명령은 새로운 환경 구성 시 참고입니다. 다른 계정에서 R2가 비활성 상태라면 결제 조건을 검토하고 활성화해야 합니다.

```sh
npx wrangler r2 bucket create site-talk-files
```

버킷 바인딩은 `FILES`입니다. 퍼블릭 액세스는 필요하지 않습니다. 첨부는 `attachments/{roomId}/{attachmentId}`, 아카이브는 `site-talk-archive/YYYY/MM/DD/{제목}--{roomId}.md`에 저장합니다. 같은 제목의 방도 서로 덮어쓰지 않습니다.

파일은 방 참여자 인증을 통과한 `/api/attachments/{id}`로 내려받습니다. PNG/JPEG/GIF/WebP/PDF의 실제 byte signature를 확인한 파일만 제한된 inline 미리보기를 제공합니다. PDF라고 선언한 HTML 등 불일치 파일은 `application/octet-stream`과 attachment 다운로드로 처리합니다. 파일당 최대 20MB입니다. 관리자의 현재 저장량 표시는 D1에 기록된 첨부 크기 합이며, R2 청구 사용량이나 Markdown 크기까지 포함한 실측값은 아닙니다.

## Durable Objects 설정

`wrangler.jsonc`에 `ROOMS → ChatRoom` 바인딩과 `new_sqlite_classes: ["ChatRoom"]` migration이 정의되어 있습니다. 최초 Worker 배포 시 해당 namespace를 만듭니다. 방 ID를 `idFromName`에 전달해 방마다 DO 하나를 사용합니다.

메시지·종료·참여자 변경은 방별로 직렬화합니다. 메시지는 D1 batch에 먼저 저장되며 `seq`로 정렬하고 `(room_id,user_id,client_id)`로 중복을 방지합니다. 종료된 방에는 DB trigger도 새 메시지를 차단합니다. DO WebSocket hibernation과 visibility heartbeat로 접속 상태를 관리합니다.

## 사용자 인증·프로필

MVP는 관리자가 발급한 이메일·비밀번호 계정을 사용합니다. 공개 회원가입이나 이메일만 입력하는 테스트 로그인 API는 없습니다. 비밀번호는 salt를 사용한 PBKDF2 해시, 세션은 무작위 토큰의 SHA-256 해시로 저장합니다. 브라우저에는 HttpOnly·SameSite 쿠키를 발급하며 HTTPS에서는 Secure를 적용합니다.

인증 코드는 `auth.ts`로 분리되어 있고 `password_hash`는 nullable이므로 향후 Google OAuth 계정을 수용할 수 있습니다. Google OAuth 자체는 아직 구현하지 않았습니다. 원격 사용자 발급에는 운영용 provisioning 도구를 사용합니다.

```sh
node scripts/create-user.mjs --email name@company.com --name "사용자 이름" --remote
node scripts/create-user.mjs --email admin@company.com --name "관리자 이름" --admin --remote
```

`--company`, `--department`도 선택할 수 있습니다. `--remote`를 생략하면 로컬 D1에만 발급합니다. 무작위 비밀번호는 stdout에 출력하지 않고 Git에서 제외된 `.wrangler/accounts/{uuid}.json`에 권한 0600으로 저장합니다. 발급 결과가 `pending`이면 원격 DB 상태를 확인하기 전 무작정 재시도하지 않습니다. 로그인 정보는 사용자에게 안전한 경로로 전달하고, 로컬 `test:seed`를 운영 발급에 사용하지 않습니다.

배포환경 관리자 1명과 검증용 사용자 2명을 발급하고 원격 관리자 API 로그인·로그아웃 200을 확인했습니다. 비밀번호는 Git에서 제외된 0600 파일로만 전달하며 이 문서에 포함하지 않습니다. 원격 시험은 `E2E_BASE_URL`과 별도 `E2E_CREDENTIALS_FILE`을 사용합니다.

## Web Push VAPID 설정

사용자 단말의 알림 허용 동작으로 Service Worker Push 구독을 생성합니다. 구독은 D1에 보관하고 현재 방이 보이지 않는 알림 활성 참여자에게 발송합니다. 지원 endpoint를 검증하고 VAPID 서명·RFC 8291 암호화를 사용합니다.

```sh
node scripts/vapid.mjs
```

키는 콘솔에 출력하지 않고 Git에서 제외된 `.wrangler/vapid.env`에 권한 0600으로 저장합니다. 파일이 이미 있으면 덮어쓰지 않고 실패합니다. 해당 값을 안전한 로컬 환경/Cloudflare Secrets의 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`로 등록하고 `VAPID_SUBJECT`를 별도 설정하세요. 이 파일은 자동으로 Worker에 주입되지 않습니다. subject는 관리 가능한 연락처의 `mailto:` 주소 또는 HTTPS URL입니다. 기존 Push 구독은 애플리케이션 서버 키에 연결되므로 운영 중 키를 변경하면 재구독이 필요합니다.

실제 Push는 브라우저·OS 권한과 HTTPS가 필요합니다. 로컬 예외 origin 동작과 실제 HTTPS 배포 동작을 각각 검증해야 합니다. 지원하지 않는 브라우저에서는 UI가 상태를 표시합니다. iOS 등 설치·권한 조건이 있는 환경은 해당 기기에서 최종 확인해야 합니다.

배포 Worker에는 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` 세 Secret 이름 등록을 확인했습니다. Secret 등록은 실제 Push 수신 성공의 증거가 아닙니다.

## Cloudflare Secrets 설정

값을 채팅이나 소스 파일에 붙여 넣지 않고, 안전한 로컬 터미널의 Wrangler 입력으로 등록합니다.

```sh
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

`OPENAI_MODEL`은 공개 설정이며 `wrangler.jsonc`에 지정합니다. `.dev.vars`, `.env*`, `.wrangler/`는 Git 제외 대상입니다. 공개 예시 파일 `.env.example`에는 빈 변수명만 둡니다. 배포 토큰은 GitHub Actions Secrets로 보관하고 클라이언트 빌드 변수로 전달하지 않습니다.

## Cron 설정

설정값 `50 14 * * *`는 UTC 14:50, 한국 시간 매일 23:50입니다. 실행 시 아직 보관되지 않은 종료 방과 재시도 가능한 실패 작업을 처리합니다. 당일 마지막 실행 이후 종료된 방은 다음 실행에서 처리됩니다.

로컬에서 `--test-scheduled`로 실행 중일 때:

```sh
curl 'http://127.0.0.1:8787/__scheduled'
```

Cron에는 세션·rate-limit 만료 데이터 정리도 포함됩니다. 테스트 scheduled endpoint는 로컬 개발 도구의 기능이며 공개 관리자 API로 구현하지 않았습니다.

## OpenAI API 및 Markdown Archive

Cloudflare와 별도의 OpenAI API 사용 권한·과금 설정이 필요합니다. 현재 기본 모델은 설정 파일의 `gpt-4.1-mini`입니다. 사용자 승인으로 생성한 API 키는 안전한 로컬 선택 절차를 통해 Git에서 제외된 `.dev.vars`에 권한 0600으로 저장했습니다. 키 값은 문서·로그에 기록하지 않습니다. 실제 요약 요청은 HTTP 429로 실패했고, 진단에서 `code: credit_balance_exhausted`, `type: insufficient_quota`를 확인했습니다. 잔액 충전이 확인되기 전에는 추가 실제 요청을 보내지 않습니다. 배포 Worker의 `OPENAI_API_KEY`는 반복 실패·재시도 소모를 막기 위해 아직 등록하지 않았습니다. 성공한 실제 요약·Cron→R2 아카이브는 아직 없습니다.

키 미설정 환경에서는 작업의 시도 횟수를 소비하지 않고 처리를 건너뜁니다. 키가 있지만 API에서 과금 오류를 반환하는 경우는 실패 작업이므로, 설정 후에도 계정 잔액·권한을 확인해야 합니다.

AI는 요약·결정사항·Action Items·키워드만 생성합니다. 원문, 방 목적, 종료 결론·담당자·기한·메모는 코드가 직접 Markdown에 작성합니다. OpenAI에는 `store:false`와 구조화된 응답 형식을 요청하며, 실패·거부·불완전 응답을 성공으로 처리하지 않습니다.

현재 작업은 한 번에 최대 10개, 작업당 최대 5회 시도하며 lease로 중복 Cron 실행을 제어합니다. 긴 대화는 모든 메시지·첨부 metadata를 여러 구간으로 나누고, JSON escape와 Responses 요청 envelope를 포함한 직렬화된 요청 문자열을 요청당 250,000 UTF-16 코드 단위 이내로 검사합니다. 이는 앱 자체의 문자열 길이 예산이며 250KB/UTF-8 byte 한도나 OpenAI API의 제한을 의미하지 않습니다. 구간 요약은 `[구간 i/N]`로 연결하고 결정사항·Action Items·키워드는 중복을 제거합니다. 추가 AI 병합 호출은 하지 않습니다. 원문 Markdown에는 전체 대화를 그대로 보존합니다.

작업당 8분, Cron 한 번당 12분의 처리 예산을 적용하고 각 구간 호출 전에 lease 소유권을 다시 확인합니다. 어느 구간이든 실패하면 불완전한 결과를 R2에 저장하거나 done으로 표시하지 않습니다. 공유 문맥 또는 단일 기록 자체가 한도를 넘거나 시간 예산·5회 시도를 소진하면 실패로 남으므로 원인 수정 후 관리자의 재처리가 필요합니다.

## GitHub → Cloudflare 배포 방법

비공개 GitHub 저장소 [seominpapa/sitetalk](https://github.com/seominpapa/sitetalk)의 수정 커밋 `c87e53b`에 대한 [Actions 실행](https://github.com/seominpapa/sitetalk/actions/runs/34743470826)은 설치·타입검사·단위시험·빌드·전체 브라우저 시험을 통과했습니다. 해당 과거 실행의 deploy job은 `Cloudflare API token is not configured`로 중단됐습니다. 이후 Wrangler로 원격 migration·최초 Worker 배포를 완료했지만 이는 자동 배포가 아닙니다. GitHub에는 `CLOUDFLARE_ACCOUNT_ID`를 등록했고 `CLOUDFLARE_API_TOKEN`은 아직 없어 CI/CD 전체는 미완료입니다. 토큰에는 선택한 계정에서 Worker 배포·D1 migration 등 워크플로가 실제 사용하는 최소 권한을 부여합니다.

`.github/workflows/deploy.yml`은 PR과 main push에서 의존성 설치 → typecheck → 단위·통합 시험 → build → 로컬 D1·테스트 사용자 준비 → 브라우저 E2E를 실행합니다. main push 또는 main에서 실행한 workflow_dispatch는 시험 성공 뒤 `production` environment에서 원격 migration → Worker 배포를 수행합니다. 토큰·account ID 누락과 D1 자리표시자는 배포 전에 실패합니다. GitHub의 production environment 승인 규칙이 있다면 그 규칙도 적용됩니다. 워크플로 파일 존재나 로컬 build 성공만으로 자동 배포 성공을 판정하지 않습니다.

수동으로 동일 산출물을 배포할 때:

```sh
npm run typecheck
npm test
npm run db:remote
npm run deploy
```

원격 배포 후 두 명의 독립 세션에서 전체 수용 시나리오를 실행하고, Push 수신·첨부 다운로드·OpenAI 호출·R2 아카이브 객체를 확인해야 합니다.

## Database Migration 방법

새 변경은 `database/migrations`에 번호가 증가하는 SQL 파일로 추가합니다. 배포한 migration을 수정해 재적용하지 않습니다.

```sh
npm run db:local
npm run db:remote
```

D1 batch를 사용해 메시지·첨부 metadata, 종료 정보·archive job을 함께 저장합니다. SQL FK·unique·CHECK 제약과 종료 방 INSERT trigger가 적용됩니다. 날짜 기한은 `YYYY-MM-DD`, timestamp는 epoch millisecond 정수입니다. 원격 migration 전에는 실제 대상 DB와 데이터 보존 계획을 확인합니다.

## Troubleshooting

| 증상 | 확인할 사항 |
|---|---|
| 로그인 실패 | 로컬 테스트 계정 파일, 대상 origin, 세션 쿠키, 사용자 발급 여부. 연속 실패 시 rate limit을 기다립니다. |
| Worker 시작 시 assets 오류 | `npm run build`로 `dist` 생성 여부를 확인합니다. |
| D1 바인딩·테이블 오류 | `DB` 바인딩, 실제 database ID, 해당 환경 migration 적용 여부를 확인합니다. |
| R2 배포 오류 | R2 활성화·버킷 이름·계정 권한을 확인합니다. 로컬 에뮬레이션 성공은 원격 활성화 증거가 아닙니다. |
| 실시간 연결 반복 끊김 | WebSocket 경로·Vite proxy·로그인 만료·탭 수 제한·네트워크 상태를 확인합니다. |
| 업로드 실패 | 파일당 20MB, 빈 파일 여부, 네트워크·R2 상태를 확인합니다. 재시도 후 중복 여부도 확인합니다. |
| 알림 미수신 | OS/브라우저 권한, Service Worker, VAPID 3종 설정, 구독 저장, 현재 방 visibility를 확인합니다. |
| Archive pending | 키 설정·Cron 실행·종료 상태를 확인합니다. |
| Archive failed | HTTP 오류·모델 권한·입력 크기·5회 재시도 한도를 확인합니다. 원문은 D1에 남습니다. |
| OpenAI 429 / credit_balance_exhausted | API 계정의 잔액·과금 상태를 확인합니다. 현재 확인된 원인은 insufficient_quota이며 충전 전 반복 호출하지 않습니다. |
| 다운로드 404 | 파일 존재 여부와 방 참여 권한을 확인합니다. 비참여자에게도 내용을 노출하지 않습니다. |

운영 확인에는 `npx wrangler tail`과 Cloudflare 대시보드 로그를 사용합니다. API 키·세션 토큰·Push endpoint 토큰·메시지 본문을 로그에 추가하지 마세요.

## 검증 상태와 제외 범위

2026-09-13 최종 검증: `npm test` 33/33, `npm run typecheck`, `npm run build`, 확장된 브라우저 E2E 전체 4/4(6.7초)가 통과했습니다. 로컬 Worker/D1/R2 에뮬레이터에서 두 사용자 실시간 메시지, 실제 WebSocket 종료·offline 중 55개 메시지·재연결 후 전체 순서 복구, Shift+Enter, 합성 clipboard 이미지·확대·drag/drop, PDF 다운로드, MIME 위장 파일 다운로드 강제, 검색, 종료·쓰기 차단, 읽음 위치, 초대 권한을 확인했습니다. 브라우저 Push unsubscribe가 실패해도 서버 로그아웃은 완료되도록 RED→GREEN으로 검증했습니다.

최초 GitHub E2E에서 느린 방 목록 갱신이 다음 메시지 전송 잠금을 유지하는 경합을 발견했습니다. 메시지 저장 응답 이후 목록 갱신을 비동기로 분리했고, 목록 응답 1.5초 지연 회귀 검사를 포함한 로컬 전체 E2E 4/4(6.4초), 단위·통합 시험 33/33, typecheck·build를 다시 통과했습니다. 수정 커밋의 GitHub 테스트 job도 통과했으며 배포 job만 인증 설정 부족으로 중단됐습니다.

Cloudflare 배포환경에서도 브라우저 E2E 전체 4/4(3.0분)를 통과했습니다. 두 사용자 채팅·55개 재연결 복구·이미지/PDF 공유·검색·종료·권한·로그아웃을 실제 원격 D1/R2/DO에서 확인했습니다. 최초 원격 실행은 55개 순차 요청의 각 약 1.3초 왕복으로 첫 시험의 90초 예산을 초과했습니다. HTTPS 첫 시험만 총 180초로 늘리고 기능 assertion을 유지해 재검증했으며 429는 없었습니다.

합성 ClipboardEvent는 실제 OS Cmd+V 검증을 대신하지 않습니다. `npm audit`은 취약점 0건이며 GitHub 테스트 job, 실제 Cloudflare migration·배포·health 200·원격 E2E를 확인했습니다. 실제 Push 수신·성공한 실제 OpenAI/Cron/R2 아카이브는 아직 없습니다. CI/CD 전체 성공과 전체 코드 80% coverage 달성도 입증되지 않았습니다. 일부 Push/Archive 시험의 coverage를 전체 앱 coverage로 해석하지 않습니다.

음성·영상 통화, RAG, Vector DB, 번역·OCR, 문서 분석, AI 챗봇, 결재·일정·Todo, Tauri·네이티브 앱은 MVP 범위에 포함하지 않습니다.
