# Site Talk 요구사항별 수용 기준

기준일: 2026-09-13. `구현`은 소스 존재를 뜻하며 실제 서비스 완료를 뜻하지 않습니다. `단위/통합 통과`는 아래 시험이 확인한 범위에 한정됩니다. 배포환경의 증거는 별도로 필요합니다.

## 명세 26개 그룹

| 명세 | 요구사항 | 현재 증거와 상태 | 완료에 필요한 추가 증거 |
|---|---|---|---|
| 1 | 지정 기술 스택 | Worker 실제 배포·D1 migration·DO/R2 바인딩·health 200 확인 | 원격 사용자 통신·Push·AI 성공 확인 |
| 2 | Site Talk / Construction Site Communication 디자인 | 서비스명·부제 및 업무툴 UI 소스 구현 | 데스크톱·모바일 화면 검토 |
| 3 | 사용자 정보·간단 인증 | 인증 시험 통과·원격 관리자 1명/검증 2명 발급. Google OAuth 미구현이며 명세상 대체 인증 허용 | 원격 로그인·프로필·로그아웃 검증 |
| 4 | 메인 목록·진행/종료·검색·프로필·알림 | App/Chat/Settings UI 구현 | 각 화면 전환 E2E |
| 5 | 방 제목·목적·참여자·유형·프로젝트·공종·위치·키워드 | UI·검증·DB 저장 구현 | 모든 입력 저장 및 재조회 E2E |
| 6 | DO WebSocket·D1 영구 메시지 | 로컬·원격 양방향·reload·소켓 종료·offline 55개·재연결 전체 순서 통과 | 실제 기기·현장 네트워크 사용성 점검 |
| 7 | PDF/Office/이미지/ZIP/문서 전송·비공개 접근 | 로컬·원격 PNG/PDF bytes·권한·MIME 위장 차단 통과; signature 11사례 단위 시험 | 다른 문서 형식 확인 |
| 8 | Cmd/Ctrl+V 이미지·드롭 | 합성 ClipboardEvent·이미지 확대·drag/drop E2E 통과 | 실제 OS Cmd/Ctrl+V 및 배포환경 확인 |
| 9 | Enter/Shift+Enter·진행률 | 로컬 키보드 전송·Shift+Enter 통과, 진행률 UI 구현 | 업로드 진행률 시각 검증·배포환경 확인 |
| 10 | 종료 정보·read-only·향후 reopen 구조 | closure·status·DB trigger 구현, rollback/닫힌방 시험 통과 | 동시 종료·전송 및 UI readonly 검증. reopen 기능 자체는 제외 |
| 11 | 숨긴 방 Push·클릭 이동 | 암호화/VAPID/대상 필터 시험 통과; 원격 VAPID 3종 Secret 등록 | 실제 브라우저 구독·숨김 수신·클릭 deep link·로그아웃 격리 |
| 12 | unread·읽음 정보 | room_reads·seq 구현 | B 미열람 증가·진입 감소·읽음 순서 역행 방지 |
| 13 | 명시된 7종 검색 | SQL 조건·참여자 권한 필터 구현 | 검색 대상별 결과·방 이동·비참여자 제외 |
| 14 | Daily Cron→OpenAI→R2 | Cron 배포·모의 통합 통과; 실제 API는 잔액 부족 429. 원격 OpenAI 키 의도적 미등록 | 충전 확인 후 원격 키 등록·실제 Cron→AI→R2 성공 |
| 15 | Markdown 형식·원문 보존·AI 역할 제한 | 원문·종료·fence·AI schema·긴 대화 모든 구간 시험 통과 | 실제 산출물의 모든 필드·첨부 링크 확인 |
| 16 | 프로필·알림·로그아웃·관리자 목록/저장량/종료 방 | UI/API·관리자 권한 구현 | 역할별 E2E. 저장량은 첨부 metadata 합임을 표시 |
| 17 | PWA manifest·설치·기기 대응 | manifest·아이콘·Service Worker 구현 | 실제 PC/모바일 설치 및 반응형 확인 |
| 18 | 명확한 workspace | apps/web, apps/worker, packages/shared, database, docs 구조 구현 | 문서 경로·배포 구조 최종 일치 |
| 19 | Secret·빈 환경변수 예제 | 빈 예제·서버 참조·OpenAI 로컬 0600 저장·원격 VAPID 3종 확인 | 충전 후 원격 OpenAI Secret 및 번들 비밀값 미포함 확인 |
| 20 | 경량 Web API·서버리스·영구 저장·AI 분리 | 런타임 의존성 React 중심, 서버리스 소스 구현 | 배포환경과 장애 격리 확인 |
| 21 | 제외 범위 준수 | 챗봇/RAG/통화/OCR/네이티브 앱/일정 기능 미구현 | 범위 밖 기능을 완료 조건에 추가하지 않음 |
| 22 | 최종 사용자 전체 흐름 | 개별 구성 구현 | 아래 전체 시나리오의 로컬·배포 모두 통과 |
| 23 | 11단계 구현 순서 | docs/progress.md 단계별 추적 | 단계별 시험·문제·잔여 결과 최종 보완 |
| 24 | 로컬·Cloudflare에서 실제 시나리오 | 로컬·원격 E2E 4/4 통과; 실제 Push/OS CmdV/AI 미완료 | 남은 실환경 증거 필요; 전체는 미완료 |
| 25 | README 필수 항목 | README에 개요·구조·개발·Cloudflare·D1/R2/DO/Push/Secrets/Cron/OpenAI/CI/CD/migration/문제해결 기재 | 실제 provisioning·Actions 파일과 최종 동기화 |
| 26 | 단계별 구현·시험·기록·불필요 리팩터 금지 | progress 문서와 단계별 시험 | 최종 감사와 미해결 사항 명시 |

## 전체 사용자 시나리오

아래 각 행은 로컬과 Cloudflare 배포환경을 별도로 검증합니다. 인증된 실제 브라우저와 실제 리소스가 필요한 항목은 모의 fetch 결과로 대체하지 않습니다.

| 순서 | 동작 | 로컬 | Cloudflare | 수집할 증거 |
|---|---|---|---|---|
| 1 | A 로그인 | Chrome 독립 세션 E2E 통과 | 독립 브라우저 로그인·로그아웃 통과 | 로그인 성공·세션·me 응답 |
| 2 | “발파계획 변경 협의” 생성 | UI 생성 통과; 선택 metadata 재조회 일치 | UI 생성·metadata 통과 | 목적·참여자·선택 metadata 저장 |
| 3 | B 참여/초대 | 초기 B 참여 및 생성자의 추가 초대 API 통과 | B 참여·생성자 초대·권한 차단 통과 | B 목록·방 상세·권한 |
| 4 | A 전송→B 즉시 표시 | 양방향·reload·실제 WS 종료·offline 55개·재연결 전체 순서 통과 | 동일 시나리오 통과, 실제 DO/D1 사용 | 독립 브라우저 화면·D1 영구 데이터 |
| 5 | B가 앱을 보지 않을 때 Push | 모의 전달 시험 통과, 실제 미검증 | 미검증 | 브라우저 알림·click 방 URL |
| 6 | A Cmd+V 이미지→R2→B | 합성 ClipboardEvent·B thumbnail·확대·drag/drop 통과 | 동일 이벤트 시나리오·실제 R2 통과; OS 키보드 미검증 | 실제 OS Cmd/Ctrl+V는 추가 확인 필요 |
| 7 | PDF 첨부→B 다운로드 | 원본 bytes·비참여자 404·HTML PDF 위장 다운로드 강제 통과 | 동일 실제 R2 왕복·권한 통과 | 원본/다운로드 bytes 일치 |
| 8 | 결론·담당자·기한 포함 종료 | UI 종료·3개 필드 재조회·B readonly 통과 | 동일 UI/API 흐름 통과 | closure 조회·UI·DB 상태 |
| 9 | 종료 뒤 메시지/첨부 차단 | 두 POST 409 및 기존 PDF bytes 보존 통과 | 동일 쓰기 차단·파일 보존 통과 | 409·데이터 미생성·기존 파일 보존 |
| 10 | Cron 실행→OpenAI 호출 | 실제 요약 요청은 잔액 부족 429 실패. 성공 Cron→AI 미검증 | Cron 배포 완료; 재시도 소모를 막기 위해 OpenAI 키 미등록 | 충전 확인 후 원격 키 등록·실제 성공 실행 |
| 11 | Markdown 생성·R2 저장 | 원문 보존 단위·모의 통합 통과 | 미검증 | 실제 객체 key·본문·인증 다운로드 |

## 실패·보안·동시성 필수 확인

- 비로그인 API 401, 비참여자 방·검색·첨부 접근 거부, 일반 사용자 관리자 API 거부.
- 세션 해시 저장, HTTPS 쿠키 속성, cross-origin 변경 요청 거부, 로그인/API rate limit.
- 메시지 ID 중복 재시도, 50개 넘게 놓친 기록 복구, 순서·원문 보존.
- 종료와 전송 경쟁, 종료 transaction 실패 rollback, 커밋 전/후 첨부 실패 cleanup 구분.
- Push의 현재 방 visibility, 다른 방·숨긴 앱 알림, endpoint 만료, 공유 브라우저 로그아웃 격리.
- AI 429/거부/잘못된 JSON/단일 기록 초과 시 원문 보존, 긴 대화 모든 메시지·첨부 구간 전달, 구간 실패 시 R2/done 없음, 중복 Cron claim·lease·재시도.
- Service Worker가 인증된 업무 API 데이터를 공개 cache에 저장하지 않는지 확인.

## 실행 결과 기록

| 검사 | 현재 확인한 결과 | 범위/제한 |
|---|---|---|
| `npm test` | 33/33 통과 | 단위·SQLite·모의 통합·재연결·VAPID private 저장·MIME 11사례(1시험)·긴 대화 구간 처리 |
| `npm run typecheck` | 통과 | 현재 TypeScript 소스 |
| `npm run build` | 통과 | 프론트 번들 생성이며 배포 증거 아님 |
| `npm run test:e2e` | 전송 경합 회귀 검사 포함 전체 4/4 통과, 6.4초; GitHub 테스트 job 통과 | 실제 Chrome + 로컬 Worker/D1/R2; 소켓 재연결·Shift+Enter·확대·drop 포함, 실제 Push/OpenAI 성공 제외 |
| `npm audit` | 취약점 0건 | 현재 설치 의존성 audit 결과 |
| Wrangler deploy dry-run | 4.131.1에서 통과 | 로컬 점검, 인증·원격 배포 증거 아님 |
| 실제 Cloudflare 배포 | Worker 활성 버전 `036c5e8b-6dfa-41a5-b395-1f2b02a1fd97`, health 200, Cron 배포 확인 | [배포 URL](https://site-talk.sjkwak300.workers.dev); Wrangler 인증 배포이며 GitHub 자동 배포 아님 |
| 원격 D1 / R2 | APAC D1 migration 23명령·종료 trigger 확인; APAC Standard R2 생성·r2.dev 비활성 | 실제 사용자 데이터·파일 왕복 E2E 통과 |
| 원격 전체 브라우저 E2E | 4/4 통과, 3.0분 | 핵심 2.3분 / 원자성 14.0초 / 읽음·초대 25.2초 / 로그아웃 4.3초; 실제 Push·OS CmdV·AI 아카이브 제외 |
| 원격 사용자 / VAPID | 관리자 1명·검증 2명 발급, VAPID Secret 3개 이름 등록 확인 | credentials는 ignored 0600 파일, 실제 Push 수신은 미검증 |
| 전체 coverage ≥80% | 미입증 | 일부 모듈 coverage를 전체 coverage로 대체하지 않음 |
| GitHub Actions → Cloudflare 배포 | 과거 `c87e53b` 테스트 job 통과·deploy job 토큰 미설정 실패; 현재 account ID Secret만 등록 | [과거 실행 기록](https://github.com/seominpapa/sitetalk/actions/runs/34743470826); 이후 수동 배포는 완료, 자동 배포는 미완료 |
| 실제 Web Push / OpenAI / R2 Archive | Push 미검증; 실제 AI는 잔액 부족 429; 성공 Archive 없음 | 충전 전 실제 AI 호출 중단 및 원격 키 미등록; R2·인증 장애는 해소 |

완료 판정: 전체 사용자 흐름의 로컬·원격 필수 행 및 보안·동시성 확인이 충족되고, 요청된 문서·배포·검증 증거가 모두 확보되어야 합니다. 현재는 완료 조건을 충족하지 않았습니다.

추가 로컬 E2E 증거: unread 0→2→읽음 0→오래된 읽음 요청 뒤 0→새 메시지 1, 자신의 메시지 제외, 검색 7개 대상, 일반 참여자 초대/관리자 API 403, 생성자 초대 성공, 로그아웃 후 me/room 401. 모바일 390×844에서 가로 넘침이 없으며 `test-results/site-talk-mobile.png` 화면을 검토했습니다. 로컬 PNG/PDF fixture 사용은 실제 현장 자료나 모든 파일 형식 검증을 뜻하지 않습니다.

로그아웃 회귀 시험: 브라우저 unsubscribe 오류를 주입한 실패 시험 이후, Push 정리를 best effort로 수행하되 서버 로그아웃을 항상 실행하도록 수정해 통과했습니다. 실제 Push의 사용자 간 격리 검증은 별도로 남습니다.

원격 시험 예산: 최초 실행은 3개 통과·핵심 시험 90초 timeout이었습니다. 55개 순차 메시지 요청 각 약 1.3초 왕복으로 누적 시간이 초과되어, HTTPS 첫 시험만 총 180초로 조정하고 모든 기능 assertion을 유지해 전체 재검증했습니다. 최종 4/4 통과했고 정상 흐름의 API 429는 없었습니다. 원격 desktop/mobile 스크린샷을 직접 검토했습니다.

실패 실행의 도구 기록에 포함된 세션은 정확한 token_hash 한 건만 대상으로 폐기했습니다. 대상 세션 수 1→삭제 변경 1→잔존 0을 확인했고 다른 데이터는 변경하지 않았습니다. 쿠키·토큰 값을 문서에 복제하지 않습니다. 현재 검토 산출물은 desktop/mobile PNG 두 개이며 trace ZIP은 보관하지 않습니다.

Archive 예산은 직렬화된 JSON 요청 문자열의 250,000 UTF-16 코드 단위이며 250KB/UTF-8 byte 한도나 OpenAI 제한을 가정하지 않습니다. 구간별 `[구간 i/N]` 요약을 추가 AI 병합 없이 연결하고 작업 8분·호출 전체 12분 예산 및 구간별 lease 확인을 적용합니다. 공유 문맥·단일 기록 자체가 너무 크거나 구간 처리에 실패하면 원문을 유지하고 R2/done을 만들지 않습니다.
