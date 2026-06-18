import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";
import type { Message } from "../ai/engine.js";

// 세션 키 — Slack의 teamId + threadTs 조합으로 워크스페이스 간 충돌을 막는다.
export type SessionKey = {
  teamId: string;
  threadTs: string;
};

export async function getSession(key: SessionKey): Promise<Message[] | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.teamId, key.teamId), eq(sessions.threadTs, key.threadTs)))
    .limit(1);

  if (!row) return null;

  try {
    const parsed = JSON.parse(row.messages) as Message[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // 손상된 세션 데이터는 무시하고 새 대화로 처리한다.
    return null;
  }
}

export async function saveSession(key: SessionKey, messages: Message[]): Promise<void> {
  const serialized = JSON.stringify(messages);

  await db
    .insert(sessions)
    .values({
      teamId: key.teamId,
      threadTs: key.threadTs,
      messages: serialized,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [sessions.teamId, sessions.threadTs],
      set: { messages: serialized, updatedAt: new Date() },
    });
}

export async function deleteSession(key: SessionKey): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.teamId, key.teamId), eq(sessions.threadTs, key.threadTs)));
}
