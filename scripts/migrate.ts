import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
  }

  // 마이그레이션 전용 단일 커넥션 — 끝나면 즉시 종료
  const migrationClient = postgres(databaseUrl, { max: 1, prepare: false });
  const database = drizzle(migrationClient);

  console.log("🔄 마이그레이션 시작...");
  await migrate(database, { migrationsFolder: "./drizzle" });
  console.log("✅ 마이그레이션 완료");

  await migrationClient.end();
}

runMigrations().catch((error) => {
  console.error("❌ 마이그레이션 실패:", error);
  process.exit(1);
});
