import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { requestMessages, requests } from "../db/schema.js";

export type Request = typeof requests.$inferSelect;

// 브리핑 완성 시 저장되는 사건 타입
export type RequestType = "legal_question" | "contract_review";

export type CreateRequestInput = {
  type: RequestType;
  slackChannelId: string;
  slackThreadTs: string;
  teamId: string | null;
  requestedBy: string;
  summary: string;
  aiAnalysis: string;
};

export async function createRequest(input: CreateRequestInput): Promise<string> {
  const id = nanoid();
  await db.insert(requests).values({
    id,
    type: input.type,
    status: "pending",
    slackChannelId: input.slackChannelId,
    slackThreadTs: input.slackThreadTs,
    teamId: input.teamId,
    requestedBy: input.requestedBy,
    summary: input.summary,
    aiAnalysis: input.aiAnalysis,
    priority: "normal",
    createdAt: new Date(),
  });
  return id;
}

// 사후 메시지 안내를 결정하려면 스레드에서 가장 최근의 사건이 무엇인지 찾는다.
export async function findRequestByThread(
  slackChannelId: string,
  slackThreadTs: string,
): Promise<Request | null> {
  const [row] = await db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.slackChannelId, slackChannelId),
        eq(requests.slackThreadTs, slackThreadTs),
      ),
    )
    .orderBy(desc(requests.createdAt))
    .limit(1);

  return row ?? null;
}

export async function updateRequestContact(requestId: string, contact: string): Promise<void> {
  await db
    .update(requests)
    .set({ clientContact: contact })
    .where(eq(requests.id, requestId));
}

// 브리핑 완성 이후 의뢰인이 추가로 보낸 메시지를 사건에 누적 기록한다.
export async function appendClientMessage(requestId: string, content: string): Promise<void> {
  await db.insert(requestMessages).values({
    id: nanoid(),
    requestId,
    role: "client",
    content,
    createdAt: new Date(),
  });
}
