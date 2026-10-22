# Site Talk

건설현장의 실시간 업무 대화, 가입 승인, AI 대화 요약·원문 검색을 제공하는 웹앱입니다. 이 README는 **저장소를 복제해 자신의 서비스와 관리자 계정을 만드는 설치자**를 위한 안내입니다. 기존 운영자의 계정·도메인·API 키는 설치자에게 전달되지 않습니다.

## 먼저 확인할 배포 범위

배포 플랫폼은 운영자가 선택합니다. **Docker/Node 서버와 Cloudflare Workers의 두 실행 경로**를 제공합니다. Docker는 특정 클라우드 계정이나 Cloudflare 리소스 없이 동작하며, SQLite와 비공개 파일을 자신의 영구 디스크에 보관합니다.

| 배포 방식 | 현재 상태 |
|---|---|
| Cloudflare Workers + D1 + Durable Objects + R2 | 현재 구현된 전체 앱 배포 경로. 아래에 초기 설치 예시 제공 |
| AWS·GCP·Azure의 VM, VPS·일반 Linux 서버·온프레미스 | 아래 Docker Compose 경로 사용. 단일 인스턴스와 영구 디스크, HTTPS 역방향 프록시 필요 |
| Vercel·Netlify·정적 웹 호스팅 등 | `dist`는 프런트엔드 산출물만 포함. 이것만 배포하면 로그인·채팅·첨부·요약 백엔드는 동작하지 않음. 기존 백엔드로의 동일 출처 프록시 또는 별도 인증·CORS 설계 필요 |
| 로컬 개발 | Docker/Node 서버 또는 기존 Wrangler 개발 환경 사용 |

Docker의 [Node 서버](apps/server/main.mjs)는 기존 인증·권한·요약 로직을 재사용하고 SQL·객체 저장소·WebSocket·예약 실행을 일반 서버에서 제공합니다. Cloudflare 경로는 [Worker 진입점](apps/worker/src/index.ts)을 계속 사용합니다. `npm run build`만으로는 정적 UI만 만들어지므로 전체 앱에는 어느 쪽이든 백엔드가 필요합니다.

**Docker의 운영 범위는 단일 프로세스·단일 인스턴스입니다.** 컨테이너 수평 확장, 여러 replica가 같은 DB를 쓰는 구성, NFS/네트워크 파일시스템, 영구 디스크 없는 serverless 컨테이너는 지원하지 않습니다. 기존 Cloudflare DB/파일을 Docker로 자동 이전하는 기능도 없습니다. 새 독립 설치를 기준으로 하며, 실제 클라우드 계정의 도메인·방화벽·백업·요금은 설치자가 설정합니다.

## 플랫폼에 관계없이 필요한 구성

| 구성 | 필요한 동작 |
|---|---|
| HTTPS 웹·API 서버 | SPA 경로 fallback, 같은 origin의 `/api`, 안전한 세션 쿠키, WebSocket upgrade |
| 영구 SQL 저장소 | 사용자·권한·대화·요약 저장, migration, FK·unique·CHECK·trigger 및 원자적 batch 보장. 현재 SQL은 SQLite/D1용이므로 다른 DB에 그대로 적용한다고 가정하지 않음 |
| 실시간 처리 | 방별 쓰기 직렬화, 메시지 순서·중복 방지, 권한 재확인, 연결 복구. Docker는 단일 서버의 WebSocket, Cloudflare는 Durable Objects |
| 비공개 객체 저장소 | 첨부와 Markdown 보관. Docker는 `/data`의 비공개 파일, Cloudflare는 R2. S3 등 외부 저장소 연결은 미구현 |
| 예약 작업 | 매일 23:50 한국시간(UTC `50 14 * * *`) 요약 처리, lease·재시도·만료 데이터 정리 |
| 비밀 관리 | 서버 암호화 키, 선택적 Push 키, 배포 자격증명. 브라우저 번들·Git·로그에 비밀값을 넣지 않음 |
| 관리자 초기화 | 설치자가 선택한 이메일로 별도 관리자 생성. **첫 가입자를 자동 관리자로 만들지 않음** |
| 외부 AI API | 현재는 OpenAI Responses API 구현. 다른 AI 공급자나 사용자 지정 API URL은 미구현 |

채팅·가입 승인·원문 보관은 OpenAI 키 없이 시작할 수 있습니다. AI 요약은 API 키·사용 가능한 모델·과금 설정이 필요하고, Push는 VAPID 설정과 사용자 단말의 알림 허용이 별도로 필요합니다. 플랫폼 요금과 AI API 요금은 설치자가 자신의 계정에서 확인해야 합니다.

## 1. 저장소 클론과 로컬 확인

준비물: Git, Node.js **24 이상**, npm. 공개 저장소를 클론해 사용할 수 있습니다. 자신의 변경을 push하거나 자동 배포하려면 먼저 자신의 GitHub 계정으로 fork하고 아래 클론 주소를 해당 fork 주소로 바꾸세요.

```sh
git clone https://github.com/seominpapa/sitetalk.git
cd sitetalk
npm ci
npm run db:local
npm run test:seed
npm run build
npx wrangler dev --port 8787 --test-scheduled
```

브라우저에서 `http://127.0.0.1:8787`을 엽니다. 로컬 시험용 관리자 1명과 일반 계정 2명의 무작위 로그인 정보는 Git 제외 파일 `.wrangler/test-users.json`에 저장됩니다. 안전한 로컬 편집기로만 확인하세요. `test:seed`는 원격 DB를 변경하지 않으며 재실행하면 새 계정을 추가합니다. 이 시험용 계정은 운영 관리자 발급을 대신하지 않습니다.

UI 개발은 별도 터미널의 `npm run dev`와 `http://127.0.0.1:5173`을 사용합니다. Vite가 API와 WebSocket을 8787로 전달합니다. PWA·통합 확인은 빌드 후 8787 기준으로 진행합니다.

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

로컬 E2E는 설치된 Chrome과 `.wrangler/test-users.json`을 사용합니다. CI에서는 Playwright Chromium을 설치합니다. E2E 실행 전 수동으로 띄운 8787 서버를 종료하세요. 시험 설정은 자체 서버를 시작하며 `E2E_BASE_URL` 지정 시에는 외부 환경에 쓰기가 발생할 수 있으므로 운영 주소를 무작정 넣지 마세요.

## 2. 설치자 자신의 배포 환경 준비

어느 플랫폼이든 **개발·운영 데이터, 비밀값, 도메인을 기존 운영 환경과 분리**해야 합니다. 현재 저장소에는 기존 운영용 설정이 남아 있으므로 클론 직후 `npm run deploy`, `npm run db:remote`, `--remote` 사용자 발급이나 자동 배포를 실행하면 안 됩니다.

- 자신의 공급자 계정·프로젝트와 과금 조건을 확인합니다.
- Docker는 아래 named volume에 SQLite·첨부·요약을 함께 보관하며 서버 시작 시 migration을 적용합니다. Cloudflare는 자신의 D1·R2를 따로 생성합니다.
- 배포 경로에 맞는 관리자 발급 도구를 사용합니다. 아래 `wrangler` 명령은 Cloudflare에만 사용하며 Docker 설치에는 실행하지 않습니다.
- 자신의 도메인·HTTPS·API·WebSocket 경로를 연결합니다. 기존 `sitetalk.seominpapa.com`이나 기존 운영자의 `workers.dev` 주소를 새 서비스 주소로 사용하지 않습니다.
- CI가 있으면 기존 배포 job·계정·URL을 자신의 환경에 맞게 교체하거나 비활성화합니다. 단순 clone은 자동 배포가 아니며, GitHub Secrets는 복사되지 않습니다.
- 초기 관리자와 API 설정을 마친 후 별도 사용자 세션으로 권한·대화·원문 접근을 확인합니다.

### Docker: 클라우드 VM·일반 서버에 독립 설치

준비물은 Docker Engine/Desktop와 Compose v2입니다. 아래 키 생성 명령을 호스트에서 실행하려면 Node.js 24 이상도 필요합니다. Docker 이미지는 Linux amd64/arm64용 공식 Node 24 버전과 digest를 고정하며, 빌드 단계에서만 개발 의존성을 사용합니다. 실행 컨테이너에는 Wrangler나 Cloudflare 자격증명이 필요하지 않습니다.

1. 위 저장소 클론 후, 예제 설정을 복사하고 **실제 설정 파일을 비공개로 유지**합니다.

```sh
cp .env.docker.example .env.docker
chmod 600 .env.docker
node scripts/ai-encryption-key.mjs
```

안전한 로컬 편집기로 `.wrangler/secrets/ai-settings-encryption.key`의 값을 `.env.docker`의 `AI_SETTINGS_ENCRYPTION_KEY`에 넣습니다. 기존 키 파일이 있으면 생성기가 덮어쓰지 않습니다. 새 서비스용 키인지 먼저 확인하며, 운영 중인 키는 임의 교체하지 않습니다. 키를 명령 인자·채팅·터미널 출력·Git에 노출하지 마세요.

2. `.env.docker`의 `PUBLIC_ORIGIN`을 설정합니다. 로컬 체험은 `http://localhost:3000`, 운영은 `https://talk.example.com`처럼 **실제 서비스의 origin**을 사용합니다. 경로·쿼리·후행 `/`를 넣지 않습니다. HTTPS가 아닌 주소는 `localhost`·`127.0.0.1`·`[::1]` 로컬 개발에만 허용됩니다. 브라우저도 정확히 같은 주소로 접속해야 합니다. `SITE_TALK_PORT`를 바꾸면 로컬 origin의 포트도 맞춥니다.

```sh
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

설정 검사는 Compose 구문 검사이며 키의 존재·형식·서버 기동·실제 키 유효성을 보장하지 않습니다. `docker compose config`를 `--quiet` 없이 실행하면 비밀값이 출력될 수 있습니다. 암호화 키가 비어 있거나 형식이 틀리면 서버가 시작하지 않습니다. `ps`에서 `healthy`를 확인하고 로컬은 `http://localhost:3000/api/health`를 확인합니다.

컨테이너는 UID/GID 1000의 `node` 사용자, 읽기 전용 루트, capability 제거로 실행됩니다. SQL·첨부·보관 요약·관리자 발급 결과만 `site-talk-data` named volume의 `/data`에 영구 저장합니다. 최초 volume 소유권은 이미지에서 준비하며, 임의 bind mount로 교체할 경우 UID 1000 쓰기 권한을 별도 설정해야 합니다. 프로젝트 디렉터리명 또는 Compose 프로젝트명을 변경하면 다른 volume을 사용할 수 있으므로 유지하세요.

3. **설치자 자신의 관리자 계정**을 생성합니다. 기본 관리자 ID/비밀번호는 없으며 웹의 첫 회원가입도 관리자 권한을 얻지 못합니다.

```sh
docker compose --env-file .env.docker exec app node apps/server/admin.mjs --email owner@example.com --name "서비스 운영자"
```

`owner@example.com`을 본인 로그인 이메일로 바꿉니다. CLI는 강한 무작위 비밀번호를 생성하고 원문 대신 `/data/accounts/{uuid}.json` 경로만 출력합니다. 출력된 실제 경로로 아래 명령의 `{uuid}`를 교체하세요.

```sh
mkdir -m 700 .wrangler/docker-admin
docker compose --env-file .env.docker cp app:/data/accounts/{uuid}.json .wrangler/docker-admin/admin.json
chmod 600 .wrangler/docker-admin/admin.json
```

안전한 편집기로 파일의 이메일·비밀번호·관리자 역할을 확인해 자신의 서비스에 로그인합니다. 이 파일은 비밀번호가 담긴 비밀 문서이므로 비밀번호 관리자에 보관하고 임의 공유하지 않습니다. 이메일은 클라우드 로그인 연동이나 발송 대상이 아닙니다. 중복 이메일로 다시 실행해도 기존 비밀번호를 재설정하지 않습니다. 재시작 시 관리자 계정을 새로 만들 필요가 없습니다.

4. 관리자 `설정 → AI 요약 설정`에서 **설치자 자신의 OpenAI API 키와 모델**을 저장합니다. 아래 공통 API 설정 절을 따르며, 처음에는 `.env.docker`의 `OPENAI_API_KEY`를 비워 두는 것을 권장합니다. 채팅·가입 승인은 API 키 없이도 가능하지만 요약에는 해당 프로젝트의 API 사용 권한·과금이 필요합니다.

5. 운영에서는 같은 서버의 Caddy/Nginx 등으로 HTTPS를 종료하고 WebSocket을 전달합니다. 기본 Compose 포트는 **호스트의 127.0.0.1에만 공개**하므로 인터넷에 3000 포트를 직접 열지 않습니다. 예를 들어 호스트에 설치한 Caddy의 설정은 다음과 같습니다. 실제 도메인 DNS와 80/443 방화벽은 서버를 가리키도록 설정하세요.

```caddyfile
talk.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy가 별도 컨테이너라면 위 `127.0.0.1`은 앱 컨테이너가 아닙니다. 같은 Docker network의 `app:3000`으로 연결하도록 별도 구성해야 합니다. 다른 프록시는 `/api`와 SPA를 같은 origin으로 전달하고 WebSocket upgrade·장기 연결을 허용하세요. `PUBLIC_ORIGIN=https://talk.example.com`으로 저장 후 `up -d`로 컨테이너를 재생성합니다. Cloudflare DNS나 프록시는 필수가 아닙니다.

서버는 위조 가능한 전달 IP 헤더를 신뢰하지 않습니다. 프록시 뒤에서는 로그인 제한(분당 10회)을 같은 프록시 주소의 사용자들이 공유합니다. 많은 사용자가 동시에 로그인하는 환경에는 신뢰 프록시별 IP 전달 설계를 추가해야 하며, 제한을 피하려고 임의의 `X-Forwarded-For`를 신뢰하도록 바꾸지 마세요. 비공개 `/data`와 공개 정적 자산 경로는 겹치면 안 되며 서버가 이런 설정을 거부합니다.

### Docker 업데이트·백업·복원

새 버전을 받기 **전에** `.env.docker`와 암호화 키를 별도 안전한 위치에 백업하고, 앱을 정지한 뒤 전체 `/data`를 백업합니다. 실행 중 SQLite 파일 하나만 복사하면 WAL과 첨부의 일관성을 잃을 수 있습니다.

```sh
docker compose --env-file .env.docker stop app
# 아래 경로는 저장소 밖의 권한 제한된 실제 백업 디렉터리로 교체합니다.
docker compose --env-file .env.docker cp app:/data /안전한_백업_경로/site-talk-data
# 검토한 새 버전의 소스를 받은 뒤:
docker compose --env-file .env.docker up -d --build
```

백업에는 DB·첨부·요약·관리자 비밀번호 문서가 함께 들어 있으므로 암호화와 접근 제어를 적용합니다. 복원은 **앱을 정지한 상태에서** 일치하는 전체 `/data`와 원래 암호화 키를 복구한 뒤 UID/GID 1000 소유권을 확인하고 기동합니다. 시작 시 미적용 migration만 반영합니다. 새 schema에 구버전 코드를 무작정 덮어쓰지 마세요.

`docker compose down`은 named volume을 유지하지만 **`down -v`, `docker volume rm`, 서버 디스크 삭제는 영구 데이터를 제거**합니다. Docker 설치와 기존 Cloudflare 운영 데이터는 별개이며 이 명령으로 이전되지 않습니다. 운영 서버는 계속 실행되어야 예약 요약이 동작합니다. 기동 시 당일 23:50 KST가 지났으면 미완료 일일 작업을 실행하며, 그 이전에 기동하면 다음 예약을 기다립니다.

### Docker 설치 경로 자동 시험

개발 호스트에서 `npm ci` 후 로컬 Docker와 Chrome을 실행한 상태로 아래 명령을 사용합니다. CI는 Playwright Chromium을 먼저 설치합니다.

```sh
npm run test:docker
```

시험은 무작위 Compose 프로젝트·임시 설정·새 volume·관리자 계정을 만들고, 관리자 API 설정·가입 승인·두 브라우저 대화·PDF 전송·컨테이너 재생성 후 데이터 보존을 확인합니다. 실제 OpenAI 키나 운영 DB는 사용하지 않으며 유료 API도 호출하지 않습니다. 정상 종료·실패 시 시험 전용 리소스만 삭제합니다. 강제 종료 시 남은 `site-talk-test-*` 리소스와 비공개 임시 파일은 대상이 시험용인지 확인한 뒤 정리하세요. 원격 Docker daemon은 안전을 위해 거부합니다.

### 현재 구현된 예시: Cloudflare에 독립 설치

이 절은 전체 앱을 실제 실행할 수 있는 **현재 구현의 한 경로**입니다. 다른 플랫폼 배포를 완료했다는 의미는 아닙니다.

1. `npx wrangler login`, `npx wrangler whoami`로 **자신의 계정 ID**를 확인합니다.
2. 원격 명령 전에 `wrangler.jsonc`의 `account_id`를 자기 계정으로 변경하고, 기존 `d1_databases[0].database_id` 속성 전체를 삭제합니다. 빈 문자열·`null`로 남기거나 기존 서비스의 실제 ID를 그대로 사용하지 마세요.
3. 아래 명령으로 자기 계정의 새 리소스를 생성합니다. 같은 이름의 리소스가 이미 있으면 기존 데이터 유무를 먼저 확인하며, 임의로 재사용·삭제하지 않습니다.

```sh
npx wrangler d1 create site-talk
npx wrangler r2 bucket create site-talk-files
```

4. 출력된 **새 D1 ID**를 `wrangler.jsonc`에 넣습니다. 이름·바인딩은 다음과 같이 유지하면 기존 도구를 그대로 사용할 수 있습니다.

| 항목 | 설정 |
|---|---|
| Worker `name` | 자기 계정 안에서 사용할 이름. 기본 `site-talk`; 기존 동명의 Worker와 충돌하지 않는지 확인 |
| D1 `binding` / `database_name` | `DB` / `site-talk` |
| D1 `database_id` | **본인이 새로 만든 DB ID** |
| D1 `migrations_dir` | `database/migrations` |
| R2 `binding` / `bucket_name` | `FILES` / `site-talk-files`. 다른 버킷명을 선택했다면 설정도 변경 |
| Durable Object | `ROOMS` → `ChatRoom`, 기존 `new_sqlite_classes` migration 유지 |
| 정적 자산 | `dist`와 기존 SPA fallback·API 우선 설정 유지 |
| 예약 | `50 14 * * *` (UTC), 한국시간 23:50 |

현재 관리자 발급·migration·시험 도구는 D1 이름 `site-talk`을 사용합니다. DB 이름을 바꾸려면 `package.json`, `scripts/create-user.mjs`, `scripts/test-users.mjs`의 호출도 함께 변경해야 합니다. 바인딩 `DB`, `FILES`, `ROOMS`는 서버 코드가 참조하므로 임의로 바꾸지 마세요.

R2는 비공개로 유지합니다. 파일 공개 URL은 필요하지 않으며 다운로드는 인증된 API를 통과합니다. R2 활성화·플랜·초과 사용 요금은 자기 계정에서 확인하세요.

5. 리소스 대상이 맞는지 다시 확인한 후 migration과 최초 관리자 발급을 수행합니다. 빈 DB에도 `0001`부터 `0004`까지 모두 필요하며, 기존 설치 업그레이드 시에는 먼저 DB를 백업합니다.

```sh
npm run db:remote
node scripts/create-user.mjs --email owner@example.com --name "서비스 운영자" --admin --remote
npm run deploy
```

`owner@example.com`은 **본인의 로그인 이메일**로 교체하세요. 관리자 생성은 이메일 발송이나 클라우드 계정 연동이 아닙니다. 배포에 성공하면 Wrangler가 출력한 **자신의 서비스 URL**을 사용합니다.

6. 다음 절의 서버 암호화 키를 등록한 뒤 관리자 화면에서 OpenAI 키를 저장합니다.
7. 사용자 지정 도메인은 자신의 DNS에서 해당 Worker에 연결합니다. 현 구현의 운영 도메인은 Cloudflare에서 별도 관리하며 `wrangler.jsonc`에 `routes`가 없습니다. 이 저장소를 배포해도 기존 운영자의 도메인은 새 계정에 연결되지 않습니다.

## 3. 설치자가 관리자로 로그인하기

Docker는 위의 [서버 관리자 CLI](apps/server/admin.mjs)를 사용합니다. **다음 항목은 Cloudflare 설치자용**입니다. Cloudflare의 초기 관리자 생성 도구는 [create-user.mjs](scripts/create-user.mjs)이며 `--admin`이 앱의 전역 관리자 역할을 부여합니다. `--remote`가 없으면 **로컬 DB에만** 생성되므로 운영 주소에서는 로그인할 수 없습니다.

- 비밀번호는 강한 무작위 값으로 생성되며 stdout에 출력하지 않습니다.
- 생성 결과에 표시된 `.wrangler/accounts/{uuid}.json`을 안전한 로컬 편집기로 열어 `email`, `password`, `role: "admin"`, `status: "created"`를 확인합니다. 파일 권한은 0600이고 Git에서 제외됩니다.
- 자신의 배포 URL에서 이 이메일·비밀번호로 로그인하면 관리자가 됩니다. 기본 관리자 ID·공통 비밀번호·웹의 최초 관리자 설치 마법사는 없습니다.
- 결과가 `pending`이면 대상 DB의 생성 여부부터 확인하세요. 중복 이메일 재발급이나 무작정 재실행으로 비밀번호를 바꾸지 않습니다.
- 비밀번호 변경·분실 복구 UI와 이메일 발송은 현재 없습니다. 생성된 로그인 정보는 안전하게 보관하고, 수동 복구 시에는 대상 DB와 세션 무효화를 함께 검토해야 합니다.
- Docker CLI와 이 도구는 각자 다른 DB를 사용합니다. 공용 가입 API를 관리자 생성용으로 열면 안 됩니다.

**일반 가입자는 최초 가입자라도 관리자가 되지 않습니다.** 담당자 가입은 현장 생성 요청만 등록하고 관리자 승인 후 담당자가 됩니다. 담당자는 자신의 현장 팀원 가입을 승인하며, 관리자는 현장·담당자·팀원 전체 승인과 팀원의 담당자 승격을 관리합니다.

관리자 로그인 후 `설정 → 승인 설정`에서 현장 등록·사용자 배정 또는 현장 생성 요청 승인·반려를 진행합니다. 관리자 권한과 현장담당자 역할은 별개입니다. CLI로 발급한 일반 계정도 관리자의 현장 배정이 필요합니다.

## 4. 서버 비밀값과 관리자 API 설정

[.env.example](.env.example)은 공통 변수명 참고용, [.env.docker.example](.env.docker.example)은 Docker용 예제입니다. 실제 키를 넣어 커밋하면 안 됩니다. Docker는 `.env.docker`를 런타임에 주입하고, Wrangler 로컬은 `.dev.vars`, Cloudflare 운영은 Worker Secret을 사용합니다. 임의의 `.env` 파일이 자동으로 모든 플랫폼에 주입되는 구조가 아닙니다.

| 항목 | 필요 시점 / 등록 위치 |
|---|---|
| `AI_SETTINGS_ENCRYPTION_KEY` | 관리자 API 키 저장에 필수. 독립적인 무작위 32바이트 Base64 값, 서버 Secret |
| OpenAI API 키 | AI 요약에 필요. **관리자 `설정 → AI 요약 설정`에서 저장**. 모든 현장 요약이 공통 사용 |
| 요약 모델 | 같은 관리자 화면에서 선택. API 프로젝트에서 사용 가능한 모델인지 별도 확인 |
| `OPENAI_API_KEY` | 선택적 서버 fallback. DB에 관리자 설정이 **없을 때만** 사용; 권장 설치 경로에서는 중복 등록 불필요 |
| `OPENAI_MODEL` | 선택적 서버 기본값. DB 저장 모델이 우선 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push 사용 시 서버에 등록. OpenAI와 별개이며 관리자 AI 입력란에 넣지 않음 |
| 배포 토큰·계정 ID | 선택한 플랫폼/CI에만 등록. 앱 사용자 비밀번호·AI 키와 별개 |

### 암호화 키 준비

기존 생성기를 재사용합니다. 파일이 있으면 덮어쓰지 않고 실패하므로 이미 설정한 환경에서는 다시 만들지 마세요.

```sh
node scripts/ai-encryption-key.mjs
```

키는 `.wrangler/secrets/ai-settings-encryption.key`에 0600으로 저장됩니다. 현재 배포 예시에서는 Worker 생성 후 다음과 같이 등록합니다. 쉘 인자나 채팅에 키 원문을 넣지 않습니다.

```sh
npx wrangler secret put AI_SETTINGS_ENCRYPTION_KEY < .wrangler/secrets/ai-settings-encryption.key
```

Docker는 **같은 변수명과 동일한 값**을 `.env.docker` 또는 서버 Secret 관리 체계에 등록합니다. Node 서버는 비밀값 `AI_SETTINGS_ENCRYPTION_KEY`, `OPENAI_API_KEY`, VAPID 3종을 해당 변수의 `_FILE`로 지정한 읽기 가능한 파일에서도 읽을 수 있습니다. 값과 `_FILE`을 동시에 설정하지 마세요. Compose Secret을 쓰려면 서비스에 별도 mount하고 UID 1000의 읽기 권한을 확인해야 합니다. 기본 Compose는 별도 Secret mount를 자동 생성하지 않습니다.

DB에 저장된 API 키는 이 키로 암호화되므로, 키를 분실·임의 교체하면 복호화할 수 없습니다. DB와 함께 별도 안전한 저장소에 백업하세요. 개발용 키와 운영용 키는 분리합니다. Wrangler 로컬 관리자 화면에서 API 설정을 시험할 때는 별도 개발용 키를 `.dev.vars`의 `AI_SETTINGS_ENCRYPTION_KEY`에 넣고 로컬 서버를 다시 시작합니다.

### 관리자 화면에서 OpenAI 등록

1. 자신의 배포 주소에 관리자로 로그인 → `설정 → AI 요약 설정`.
2. 암호화 준비 상태를 확인하고, 자신의 OpenAI API 프로젝트에서 발급한 API 키를 입력합니다.
3. 사용할 요약 모델을 선택 → `AI 설정 저장`.
4. 등록 상태를 확인합니다. 저장된 키 원문은 다시 표시하지 않으며 키 입력을 비워 저장하면 기존 키를 유지합니다.

ChatGPT 로그인 정보·구독과 OpenAI API 프로젝트의 키·과금은 구분해야 합니다. 키 발급·API 사용 권한·과금은 [OpenAI API 안내](https://platform.openai.com/docs/quickstart)에서 확인하세요. 앱에 표시되는 모델 목록이 해당 프로젝트의 사용 권한을 보장하지는 않습니다.

설정 저장은 API 연결·잔액·실제 요약 성공을 확인하는 호출이 아닙니다. 실제 요약 시 사용료가 발생하며, DB의 키 복호화 실패 시 fallback 키로 우회하지 않습니다. API 키를 프런트엔드 `VITE_` 변수·localStorage·공개 저장소에 넣지 마세요.

### 자동요약 예약과 열람

`설정 → 자동요약 예약`에서 현장담당자는 승인된 자기 현장, 관리자는 전체 현장의 예약을 변경합니다. 기본값은 **ON**이고 매일 23:50 한국시간에 **종료된 대화만** 처리합니다. 진행 중인 대화는 자동 종료하지 않습니다.

OFF이면 대기·재시도 작업은 보류되고 ON이면 다음 예약에 처리됩니다. 토글 저장 자체는 AI를 호출하지 않지만 이미 시작된 API 요청은 완료될 수 있습니다. 완료된 요약과 원문은 OFF에서도 조회할 수 있습니다.

승인된 현장 직원은 `현장 대화 요약`에서 요약 검색과 `대화 원문 열람`을 사용할 수 있습니다. 원문은 읽기 전용이며 대화방 참여 권한을 추가하지 않습니다.

## 5. 선택 기능: Web Push

```sh
node scripts/vapid.mjs
```

자기 서비스용 VAPID 키가 `.wrangler/vapid.env`에 0600으로 생성됩니다. 기존 파일은 덮어쓰지 않습니다. 현재 배포 예시에서는 다음처럼 두 키를 등록하고, 연락 가능한 `mailto:` 주소 또는 HTTPS URL을 `VAPID_SUBJECT`로 입력합니다.

```sh
npx wrangler secret bulk .wrangler/vapid.env
npx wrangler secret put VAPID_SUBJECT
```

Docker에서는 생성 파일의 두 키와 subject를 `.env.docker`에 비공개로 등록한 뒤 `docker compose --env-file .env.docker up -d`로 재생성합니다. 다른 Secret 관리 체계에서도 같은 키 쌍과 subject를 설정해야 합니다. 생성 파일은 자동 주입되지 않습니다. 등록 후 브라우저의 `설정 → 프로필·알림`에서 알림을 허용하고 구독합니다. 해당 방을 보고 있지 않은 알림 활성 참여자가 대상입니다.

HTTPS·Service Worker·OS/브라우저 권한이 필요하며, 모바일 설치 조건은 기기에서 확인해야 합니다. 도메인이나 VAPID 키를 바꾸면 재로그인·재구독이 필요할 수 있습니다. Secret 등록이나 구독 저장만으로 실제 단말 Push 수신이 검증되지는 않습니다.

## 6. 자동 배포를 사용하는 경우

자신의 저장소와 CI 자격증명을 사용합니다. **현재 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)의 deploy job은 Cloudflare 예시 구현**이며 범용 배포 job이 아닙니다.

시험 job은 기존 Worker 브라우저 시험과 새 Docker 설치·영속성 시험을 모두 실행합니다. 이것이 클라우드 VM으로의 실제 배포를 수행한다는 뜻은 아닙니다.

- 원본이 아닌 자신의 저장소에 push합니다. `main` push/수동 실행은 시험 성공 후 실제 운영 DB migration·배포를 수행할 수 있습니다.
- Cloudflare 예시를 사용할 때는 자신의 GitHub `production` environment에 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`를 등록하고, `wrangler.jsonc`의 계정·리소스와 일치시킵니다. 토큰은 해당 작업에 필요한 최소 리소스 권한·만료일로 제한합니다.
- `Verify production endpoints`의 **기존 운영 URL 두 개를 반드시 자신의 health URL로 교체**하세요. 사용자 지정 도메인이 없으면 그 주소 검사는 제거하고 자신의 기본 주소를 검사합니다. 기존 주소의 200 응답은 새 설치 성공 증거가 아닙니다.
- Docker를 선택했다면 현재 deploy job을 비활성화하거나 자신의 이미지 build·서버 전송·Compose 재기동·health 검사로 교체합니다. 이 저장소에는 클라우드 VM용 자동 배포 자격증명이나 workflow가 포함되어 있지 않습니다.
- GitHub environment의 승인 규칙, DB 백업, 배포 후 실제 로그인·WebSocket 확인을 적용합니다. CI가 성공했다는 표시는 어떤 저장소·커밋·환경을 검증했는지와 함께 확인해야 합니다.

새 기능은 로컬 검증 → 운영 DB 백업 → 추가 migration → 배포 → 수용 확인 순서로 반영합니다. 배포된 migration은 수정하지 않습니다. 구버전 코드는 새 권한 또는 예약 OFF를 무시할 수 있으므로 무조건적인 코드·DB 전체 롤백은 안전하지 않습니다.

## 7. 설치 완료 수용 확인

다음 항목을 **자기 배포 환경**에서 확인해야 설치 완료입니다.

- [ ] 자기 URL의 HTTPS·`/api/health` 정상, 로컬이 아닌 새 운영 DB 사용 확인
- [ ] 발급한 설치자 계정 로그인 → 관리자 승인 설정·AI 설정 접근 가능
- [ ] 일반 가입자는 관리자 API 접근 차단, 담당자/팀원 승인 전 현장 접근 차단
- [ ] 현장 생성 요청 → 관리자 승인·반려, 담당자의 팀원 승인·관리자의 승격 동작
- [ ] 두 계정의 실시간 대화·재연결 복구·첨부 다운로드·종료 후 쓰기 차단
- [ ] 서버 암호화 키 백업 및 관리자 공통 API 키 등록, 키 원문 비노출
- [ ] 담당자 예약 OFF→ON 저장과 재조회, 사용료 확인 후 종료된 대화의 실제 예약 요약→비공개 파일 보관
- [ ] 승인된 현장 직원의 요약 검색·읽기 전용 원문 열람
- [ ] Push를 쓴다면 실제 기기의 알림 수신·로그아웃 후 격리 확인

키 등록 성공, 정적 페이지 표시, 로컬 시험, 다른 운영 서비스의 health는 이 확인을 대신하지 않습니다. 외부 API 오류가 나도 원문은 DB에 보존되며 잔액·권한 확인 없이 유료 요청을 반복하지 마세요.

## 문제 해결

| 증상 | 먼저 확인 |
|---|---|
| 클론·push 권한 오류 | 공개 원본은 읽기 전용으로 클론 가능. 자신의 변경은 fork한 저장소에 push |
| 운영 로그인 실패 | 관리자 파일의 `created` 상태·이메일·비밀번호, `--remote` 여부, DB·접속 주소 일치, 로그인 제한 |
| Docker 서버 시작 실패 | `.env.docker`의 필수 origin·암호화 키, UID 1000의 `/data` 쓰기 권한, 같은 volume을 쓰는 두 번째 서버가 없는지 확인 |
| Docker 로그인·WebSocket 실패 | 브라우저 주소와 `PUBLIC_ORIGIN`의 scheme·호스트·포트 일치, 운영 HTTPS 프록시와 upgrade 전달 |
| 관리자 메뉴 없음 | 공개 가입이 아니라 `--admin`으로 발급했는지 확인. 현장담당자는 전역 관리자가 아님 |
| API 키 저장 불가 | 서버 `AI_SETTINGS_ENCRYPTION_KEY` 형식·등록 여부, 전체 migration, 관리자 로그인 |
| 요약 대기/실패 | 현장 예약 ON, 대화 종료, 실제 Cron, 모델 접근 권한·API 과금·재시도 상태 |
| 첨부·실시간 실패 | 비공개 객체 저장소, WebSocket 프록시·인증·HTTPS, 파일당 20MB 한도 |
| 알림 미수신 | VAPID 3종·구독·Service Worker·단말 권한·현재 방 표시 여부 |
| 정적 호스팅에서 화면만 나옴 | 전체 백엔드와 `/api`·WebSocket 라우팅이 필요한데 `dist`만 배포하지 않았는지 확인 |

## 구조·검증 기록

```text
apps/web/                React·Vite UI / PWA
apps/worker/src/         공통 업무 로직·Worker 백엔드·인증·방별 실시간 처리·요약
apps/server/             독립 Node HTTP·WebSocket 서버·SQLite/파일 저장소·관리자 CLI
packages/shared/        타입·API 클라이언트·가입 정책
database/migrations/    SQLite/D1 migration
scripts/                관리자 발급·로컬 시험 계정·암호화/VAPID 키 생성
tests/                  단위·통합·브라우저 시험
docs/                   진행 기록·수용 기준
Dockerfile·compose.yaml  비루트 단일 서버 이미지·영구 volume 설정
```

현재 구현의 시험 결과·배포 이력은 [진행 기록](docs/progress.md)과 [수용 기준](docs/acceptance.md)을 확인하세요. 기존 운영 환경에서 통과한 시험은 새 설치나 다른 플랫폼의 배포 보증이 아닙니다. 운영 사용자 데이터·비밀번호·API 키·DB 백업은 저장소에 포함하지 않습니다.

## 라이선스

Site Talk의 코드와 문서는 [MIT License](LICENSE)로 제공합니다. 저작권·허가 고지를 유지하면 사용·수정·재배포·상업적 이용이 가능합니다. 보증은 제공하지 않습니다. 외부 의존성은 각 패키지의 라이선스를 따르며, 호스팅·OpenAI API 등의 이용 약관과 사용료는 별도입니다. `package.json`의 `private: true`는 실수로 npm에 게시하는 것을 막는 설정으로 GitHub 공개 여부와는 무관합니다.

공식 자료: [Cloudflare Workers](https://developers.cloudflare.com/workers/), [Wrangler 명령](https://developers.cloudflare.com/workers/wrangler/commands/), [OpenAI API](https://platform.openai.com/docs/overview).
