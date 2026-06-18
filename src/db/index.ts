import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
}

// Supabase 풀러는 prepared statement를 지원하지 않으므로 비활성화
const queryClient = postgres(databaseUrl, { prepare: false });

export const db = drizzle(queryClient, { schema });
export { schema };
export type Database = typeof db;
