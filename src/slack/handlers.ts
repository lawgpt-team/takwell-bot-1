import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/web-api";
import { classifyMessage, runIntake, type IntakeStep, type Message } from "../ai/engine.js";
import { getSession, saveSession, deleteSession, type SessionKey } from "../services/sessions.js";
import { createRequest, type RequestType } from "../services/requests.js";

// Slack section 블록은 텍스트 3000자 한도 — 안전 마진을 두고 2800자로 자른다.
const SECTION_BLOCK_LIMIT = 2800;

// 빈 멘션 시 보여주는 예시 — 버튼을 누르면 해당 텍스트로 인테이크가 시작된다.
const EXAMPLE_PROMPTS: Record<string, string> = {
  example_unpaid: "거래처가 3개월째 대금을 지급하지 않고 있습니다. 미수금 청구 방법을 알려주세요.",
  example_contract: "용역 계약서를 받았는데 검토해 주실 수 있을까요? 첨부 파일을 곧 올리겠습니다.",
  example_worker: "프리랜서로 일하고 있는데 실제로는 회사 지시를 받고 정해진 시간에 근무합니다. 근로자로 인정받을 수 있을까요?",
};

function buildIntroBlocks(): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "안녕하세요, 법률사무소 *탁월*의 AI 사건정리 비서입니다.\n어떤 법률 문제로 문의하셨는지 알려주시면, 변호사님이 5분 안에 사건을 파악할 수 있도록 정리해 드릴게요.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "미수금 청구" },
          action_id: "example_unpaid",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "계약서 검토" },
          action_id: "example_contract",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "근로자성 문제" },
          action_id: "example_worker",
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "예시 버튼을 누르거나, 직접 상황을 설명해 주세요.",
        },
      ],
    },
  ];
}

function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) {
    chunks.push(text.slice(offset, offset + size));
  }
  return chunks;
}

function buildResultBlocks(text: string, isBriefingComplete: boolean): KnownBlock[] {
  const sections: KnownBlock[] = chunkText(text, SECTION_BLOCK_LIMIT).map((chunk) => ({
    type: "section",
    text: { type: "mrkdwn", text: chunk },
  }));

  if (isBriefingComplete) {
    sections.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "✅ *변호사에게 전달되었습니다.* 3시간 이내에 답변 드릴게요.",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "연락처 남기기" },
            action_id: "open_contact_modal",
            style: "primary",
          },
        ],
      },
    );
  } else {
    sections.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "💬 이 스레드에 답변해주시면 브리핑을 완성합니다.",
        },
      ],
    });
  }

  return sections;
}

function stepToRequestType(step: IntakeStep): RequestType {
  return step === "contract_review" ? "contract_review" : "legal_question";
}

// 멘션 텍스트에서 <@U123> 형식의 봇 멘션을 제거하고 앞뒤 공백을 정리한다.
function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

type IntakeRunContext = {
  channelId: string;
  threadTs: string;
  teamId: string;
  userId: string;
  initialText: string;
  client: any;
};

// 첫 멘션에서 사건 접수를 시작한다. 로딩 메시지 → AI 호출 → 결과로 교체.
async function runInitialIntake(context: IntakeRunContext): Promise<void> {
  const loading = await context.client.chat.postMessage({
    channel: context.channelId,
    thread_ts: context.threadTs,
    text: "분석 중입니다...",
  });

  try {
    const step = classifyMessage(context.initialText);
    const messages: Message[] = [{ role: "user", content: context.initialText }];
    const result = await runIntake(step, messages);

    const blocks = buildResultBlocks(result.text, result.isBriefingComplete);

    await context.client.chat.update({
      channel: context.channelId,
      ts: loading.ts!,
      text: result.text,
      blocks,
    });

    const sessionKey: SessionKey = { teamId: context.teamId, threadTs: context.threadTs };

    if (result.isBriefingComplete) {
      // 빠른 질문/계약서 검토 등으로 첫 응답에서 브리핑이 바로 완성된 경우
      const summary = context.initialText.slice(0, 200);
      await createRequest({
        type: stepToRequestType(step),
        slackChannelId: context.channelId,
        slackThreadTs: context.threadTs,
        teamId: context.teamId,
        requestedBy: context.userId,
        summary,
        aiAnalysis: result.text,
      });
      await deleteSession(sessionKey);
    } else {
      // 후속 답변을 받기 위해 대화 히스토리를 세션에 저장
      messages.push({ role: "assistant", content: result.text });
      await saveSession(sessionKey, messages);
    }
  } catch (error) {
    await context.client.chat.update({
      channel: context.channelId,
      ts: loading.ts!,
      text: "죄송합니다. 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      blocks: [],
    });
    throw error;
  }
}

export function registerHandlers(app: App): void {
  // ────────────────────────────────────────────────────────────
  // 1. 사건 접수 시작 (app_mention)
  // ────────────────────────────────────────────────────────────
  app.event("app_mention", async ({ event, client, context, logger }) => {
    try {
      const rawText = (event as any).text ?? "";
      const cleanedText = stripMention(rawText);
      const channelId = event.channel;
      // app_mention은 thread_ts가 없을 수 있다 (탑레벨 멘션 → ts 자체가 스레드 시작점)
      const threadTs = (event as any).thread_ts ?? event.ts;
      const teamId = (event as any).team ?? context.teamId ?? "unknown";
      const userId = (event as any).user;

      if (!cleanedText) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: "어떤 법률 문제로 문의하셨나요?",
          blocks: buildIntroBlocks(),
        });
        return;
      }

      await runInitialIntake({
        channelId,
        threadTs,
        teamId,
        userId,
        initialText: cleanedText,
        client,
      });
    } catch (error) {
      logger.error("app_mention 처리 중 오류:", error);
    }
  });

  // ────────────────────────────────────────────────────────────
  // 2. 스레드 후속 대화 (message)
  // ────────────────────────────────────────────────────────────
  app.message(async ({ message, client, context, logger }) => {
    try {
      const anyMessage = message as any;

      // 봇 자신의 메시지는 무시
      if (anyMessage.bot_id) return;
      // 스레드 안에서만 동작 (탑레벨 메시지는 무시)
      if (!anyMessage.thread_ts) return;
      // 일반 텍스트 메시지만 처리 (subtype이 있으면 시스템 메시지나 변경 알림이므로 무시)
      if (anyMessage.subtype && anyMessage.subtype !== "file_share") return;

      const text: string = anyMessage.text ?? "";
      if (!text.trim()) return;

      const channelId = anyMessage.channel as string;
      const threadTs = anyMessage.thread_ts as string;
      const teamId = anyMessage.team ?? context.teamId ?? "unknown";
      const userId = anyMessage.user as string;

      const sessionKey: SessionKey = { teamId, threadTs };
      const session = await getSession(sessionKey);

      // 세션이 없으면 인테이크 중인 스레드가 아니다 → 일단 무시 (post-briefing 처리는 별도)
      if (!session) return;

      const loading = await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "분석 중입니다...",
      });

      try {
        const updatedMessages: Message[] = [...session, { role: "user", content: text }];
        const result = await runIntake("step2", updatedMessages);

        const blocks = buildResultBlocks(result.text, result.isBriefingComplete);
        await client.chat.update({
          channel: channelId,
          ts: loading.ts!,
          text: result.text,
          blocks,
        });

        if (result.isBriefingComplete) {
          const firstUserMessage =
            updatedMessages.find((entry) => entry.role === "user")?.content ?? "";
          await createRequest({
            type: "legal_question",
            slackChannelId: channelId,
            slackThreadTs: threadTs,
            teamId,
            requestedBy: userId,
            summary: firstUserMessage.slice(0, 200),
            aiAnalysis: result.text,
          });
          await deleteSession(sessionKey);
        } else {
          updatedMessages.push({ role: "assistant", content: result.text });
          await saveSession(sessionKey, updatedMessages);
        }
      } catch (error) {
        await client.chat.update({
          channel: channelId,
          ts: loading.ts!,
          text: "죄송합니다. 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
          blocks: [],
        });
        throw error;
      }
    } catch (error) {
      logger.error("message 처리 중 오류:", error);
    }
  });

  // ────────────────────────────────────────────────────────────
  // 3. 예시 버튼 클릭 (example_unpaid / example_contract / example_worker)
  // ────────────────────────────────────────────────────────────
  for (const actionId of Object.keys(EXAMPLE_PROMPTS)) {
    app.action(actionId, async ({ ack, body, client, logger }) => {
      await ack();
      try {
        const exampleText = EXAMPLE_PROMPTS[actionId]!;
        const blockBody = body as any;
        const channelId = blockBody.channel?.id ?? blockBody.container?.channel_id;
        const threadTs =
          blockBody.message?.thread_ts ?? blockBody.message?.ts ?? blockBody.container?.message_ts;
        const teamId = blockBody.team?.id ?? "unknown";
        const userId = blockBody.user?.id;

        if (!channelId || !threadTs || !userId) {
          logger.warn("예시 버튼: 필요한 컨텍스트 누락", { channelId, threadTs, userId });
          return;
        }

        // 의뢰인이 직접 텍스트를 입력한 것처럼 보이도록 먼저 스레드에 표시
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `📝 ${exampleText}`,
        });

        await runInitialIntake({
          channelId,
          threadTs,
          teamId,
          userId,
          initialText: exampleText,
          client,
        });
      } catch (error) {
        logger.error("예시 버튼 처리 중 오류:", error);
      }
    });
  }
}
