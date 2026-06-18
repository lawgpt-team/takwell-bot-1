import "dotenv/config";
import { app } from "./slack/app.js";

const port = Number(process.env.PORT ?? 3000);

async function main() {
  await app.start(port);
  console.log(`⚡ Takwell Intake Bot 시작: http://localhost:${port}`);
}

main().catch((error) => {
  console.error("❌ 앱 시작 실패:", error);
  process.exit(1);
});
