import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import { installationStore } from "../services/installations.js";
import { registerHandlers } from "./handlers.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  }
  return value;
}

// 봇이 워크스페이스에서 동작하기 위한 OAuth 스코프.
// 인테이크 플로우에 필요한 최소 권한만 부여한다.
const BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "chat:write",
  "files:read",
  "users:read",
  "im:write",
  "commands",
];

export const receiver = new ExpressReceiver({
  signingSecret: requireEnv("SLACK_SIGNING_SECRET"),
  clientId: requireEnv("SLACK_CLIENT_ID"),
  clientSecret: requireEnv("SLACK_CLIENT_SECRET"),
  stateSecret: requireEnv("SLACK_STATE_SECRET"),
  scopes: BOT_SCOPES,
  installationStore,
  installerOptions: {
    directInstall: true,
    // 기본 redirect URI: <host>/slack/oauth_redirect
    // Slack 앱 설정의 OAuth & Permissions에 동일하게 등록해야 한다.
  },
  // 이벤트 / 인터랙티브 컴포넌트 / 슬래시 명령어 / 옵션 페이로드를 모두
  // 같은 엔드포인트로 받는다. Bolt가 페이로드의 type 필드를 보고 라우팅한다.
  // Slack 앱 설정의 다음 URL을 모두 동일하게 맞춰야 한다:
  //   - Event Subscriptions Request URL
  //   - Interactivity & Shortcuts Request URL
  //   - Slash Commands Request URL (사용 시)
  endpoints: "/slack/events",
});

export const app = new App({
  receiver,
  logLevel: process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG,
});

// 헬스체크 — 배포 환경에서 살아있음 확인용
receiver.router.get("/health", (_request, response) => {
  response.status(200).send("ok");
});

// 이벤트/액션 핸들러 등록
registerHandlers(app);
