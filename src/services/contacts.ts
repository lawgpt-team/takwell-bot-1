import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userContacts } from "../db/schema.js";

// 의뢰인 연락처는 워크스페이스(teamId) 단위로 분리해서 저장한다.
export type ContactKey = {
  slackUserId: string;
  teamId: string;
};

export async function getContact(key: ContactKey): Promise<string | null> {
  const [row] = await db
    .select({ contact: userContacts.contact })
    .from(userContacts)
    .where(
      and(eq(userContacts.slackUserId, key.slackUserId), eq(userContacts.teamId, key.teamId)),
    )
    .limit(1);

  return row?.contact ?? null;
}

export async function upsertContact(key: ContactKey, contact: string): Promise<void> {
  const now = new Date();
  await db
    .insert(userContacts)
    .values({
      slackUserId: key.slackUserId,
      teamId: key.teamId,
      contact,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userContacts.slackUserId, userContacts.teamId],
      set: { contact, updatedAt: now },
    });
}
