import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { requests } from "../db/schema.js";

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
