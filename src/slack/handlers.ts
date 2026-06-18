import type { App } from "@slack/bolt";
import type { KnownBlock, ModalView } from "@slack/web-api";
import { classifyMessage, runIntake, type IntakeStep, type Message } from "../ai/engine.js";
import { getSession, saveSession, deleteSession, type SessionKey } from "../services/sessions.js";
import {
  appendClientMessage,
  createRequest,
  findRequestByThread,
  updateRequestContact,
  type Request,
  type RequestType,
} from "../services/requests.js";
import { getContact, upsertContact } from "../services/contacts.js";
import { buildHomeView } from "../workflows/onboarding.js";

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

// requestId는 브리핑 완성 후 "연락처 남기기" 버튼이 어떤 사건과 연결되는지 식별하는 키.
function buildResultBlocks(
  text: string,
  isBriefingComplete: boolean,
  requestId?: string,
): KnownBlock[] {
  const sections: KnownBlock[] = chunkText(text, SECTION_BLOCK_LIMIT).map((chunk) => ({
    type: "section",
    text: { type: "mrkdwn", text: chunk },
  }));

  if (isBriefingComplete && requestId) {
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
            value: requestId,
            style: "primary",
          },
        ],
      },
    );
  } else if (!isBriefingComplete) {
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

// 첫 멘션에서 사건 접수를 시작한다. 로딩 메시지 → AI 호출 → (완성이면 사건 저장 후) 결과로 교체.
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
    const sessionKey: SessionKey = { teamId: context.teamId, threadTs: context.threadTs };

    let requestId: string | undefined;
    if (result.isBriefingComplete) {
      // 브리핑이 완성되면 먼저 사건을 저장해서 requestId를 확보해야
      // "연락처 남기기" 버튼이 어떤 사건과 연결되는지 알 수 있다.
      requestId = await createRequest({
        type: stepToRequestType(step),
        slackChannelId: context.channelId,
        slackThreadTs: context.threadTs,
        teamId: context.teamId,
        requestedBy: context.userId,
        summary: context.initialText.slice(0, 200),
        aiAnalysis: result.text,
      });
      await deleteSession(sessionKey);
    } else {
      // 후속 답변을 받기 위해 대화 히스토리를 세션에 저장
      messages.push({ role: "assistant", content: result.text });
      await saveSession(sessionKey, messages);
    }

    const blocks = buildResultBlocks(result.text, result.isBriefingComplete, requestId);
    await context.client.chat.update({
      channel: context.channelId,
      ts: loading.ts!,
      text: result.text,
      blocks,
    });
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

// 브리핑이 완성된 사건의 스레드에서 새 메시지가 들어왔을 때.
// 활성 사건이 있으면 status별 안내를 보내고, 어떤 경우든 의뢰인 메시지를 로그에 누적한다.
async function handlePostBriefingMessage(args: {
  channelId: string;
  threadTs: string;
  text: string;
  client: any;
}): Promise<void> {
  const request = await findRequestByThread(args.channelId, args.threadTs);
  if (!request) return;

  // 사건 로그에 의뢰인 메시지 누적 (변호사가 나중에 확인할 수 있도록)
  await appendClientMessage(request.id, args.text);

  const reply = buildPostBriefingReply(request);
  await args.client.chat.postMessage({
    channel: args.channelId,
    thread_ts: args.threadTs,
    text: reply,
  });
}

function buildPostBriefingReply(request: Request): string {
  switch (request.status) {
    case "completed":
      return "✅ 이 사건은 종료되었습니다. 새로운 문의는 채널에서 다시 `@탁월`을 멘션해 주세요.";
    case "contacted":
      return "✉️ 변호사 답변은 등록하신 연락처로 발송됩니다. 추가하신 내용은 사건 기록에 함께 저장해 두었어요.";
    default:
      // pending / lawyer_review
      return "📌 보충 정보가 변호사에게 전달되었습니다. 답변이 준비되는 대로 다시 안내드릴게요.";
  }
}

// ────────────────────────────────────────────────────────────
// 연락처 모달
// ────────────────────────────────────────────────────────────

type ContactModalMetadata = {
  requestId: string;
  channelId: string;
  threadTs: string;
  teamId: string;
};

const CONTACT_BLOCK_ID = "contact_block";
const CONTACT_INPUT_ACTION_ID = "contact_input";

function buildContactModal(metadata: ContactModalMetadata, prefilledContact: string | null): ModalView {
  const inputElement: any = {
    type: "plain_text_input",
    action_id: CONTACT_INPUT_ACTION_ID,
    placeholder: { type: "plain_text", text: "name@example.com 또는 010-1234-5678" },
  };
  if (prefilledContact) {
    inputElement.initial_value = prefilledContact;
  }

  return {
    type: "modal",
    callback_id: "contact_modal_submit",
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: "연락처 남기기" },
    submit: { type: "plain_text", text: "저장" },
    close: { type: "plain_text", text: "취소" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "변호사가 답변드릴 *이메일* 또는 *전화번호*를 남겨주세요.",
        },
      },
      {
        type: "input",
        block_id: CONTACT_BLOCK_ID,
        label: { type: "plain_text", text: "연락처" },
        element: inputElement,
      },
    ],
  };
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
  // 2. 스레드 메시지 (인테이크 진행 중 또는 사후 메시지)
  // ────────────────────────────────────────────────────────────
  app.message(async ({ message, client, context, logger }) => {
    try {
      const anyMessage = message as any;

      if (anyMessage.bot_id) return;
      if (!anyMessage.thread_ts) return;
      if (anyMessage.subtype && anyMessage.subtype !== "file_share") return;

      const text: string = anyMessage.text ?? "";
      if (!text.trim()) return;

      const channelId = anyMessage.channel as string;
      const threadTs = anyMessage.thread_ts as string;
      const teamId = anyMessage.team ?? context.teamId ?? "unknown";
      const userId = anyMessage.user as string;

      const sessionKey: SessionKey = { teamId, threadTs };
      const session = await getSession(sessionKey);

      if (!session) {
        // 세션이 없는 스레드 — 브리핑이 이미 완성된 사건인지 확인하고 사후 메시지로 처리
        await handlePostBriefingMessage({ channelId, threadTs, text, client });
        return;
      }

      // 인테이크 진행 중 — step2로 대화를 이어간다
      const loading = await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: "분석 중입니다...",
      });

      try {
        const updatedMessages: Message[] = [...session, { role: "user", content: text }];
        const result = await runIntake("step2", updatedMessages);

        let requestId: string | undefined;
        if (result.isBriefingComplete) {
          const firstUserMessage =
            updatedMessages.find((entry) => entry.role === "user")?.content ?? "";
          requestId = await createRequest({
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

        const blocks = buildResultBlocks(result.text, result.isBriefingComplete, requestId);
        await client.chat.update({
          channel: channelId,
          ts: loading.ts!,
          text: result.text,
          blocks,
        });
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
  // 3. 예시 버튼 클릭
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

  // ────────────────────────────────────────────────────────────
  // 4. 연락처 모달 열기
  // ────────────────────────────────────────────────────────────
  app.action("open_contact_modal", async ({ ack, body, client, logger }) => {
    await ack();
    try {
      const actionBody = body as any;
      const triggerId = actionBody.trigger_id;
      const requestId = actionBody.actions?.[0]?.value;
      const channelId = actionBody.channel?.id ?? actionBody.container?.channel_id;
      const threadTs =
        actionBody.message?.thread_ts ?? actionBody.message?.ts ?? actionBody.container?.message_ts;
      const teamId = actionBody.team?.id ?? "unknown";
      const userId = actionBody.user?.id;

      if (!triggerId || !requestId || !channelId || !threadTs || !userId) {
        logger.warn("연락처 모달: 필요한 컨텍스트 누락", {
          triggerId,
          requestId,
          channelId,
          threadTs,
          userId,
        });
        return;
      }

      // 이전에 남긴 연락처가 있으면 모달에 미리 채워둔다
      const existingContact = await getContact({ slackUserId: userId, teamId });

      const metadata: ContactModalMetadata = {
        requestId,
        channelId,
        threadTs,
        teamId,
      };

      await client.views.open({
        trigger_id: triggerId,
        view: buildContactModal(metadata, existingContact),
      });
    } catch (error) {
      logger.error("연락처 모달 열기 중 오류:", error);
    }
  });

  // ────────────────────────────────────────────────────────────
  // 5. 연락처 모달 제출
  // ────────────────────────────────────────────────────────────
  app.view("contact_modal_submit", async ({ ack, body, view, client, logger }) => {
    try {
      const rawContact =
        view.state.values[CONTACT_BLOCK_ID]?.[CONTACT_INPUT_ACTION_ID]?.value ?? "";
      const contact = rawContact.trim();

      if (!contact) {
        await ack({
          response_action: "errors",
          errors: { [CONTACT_BLOCK_ID]: "연락처를 입력해주세요." },
        });
        return;
      }

      await ack();

      const metadata = JSON.parse(view.private_metadata) as ContactModalMetadata;
      const userId = body.user.id;

      await upsertContact({ slackUserId: userId, teamId: metadata.teamId }, contact);
      await updateRequestContact(metadata.requestId, contact);

      await client.chat.postMessage({
        channel: metadata.channelId,
        thread_ts: metadata.threadTs,
        text: `✅ 연락처가 저장되었습니다 (${contact}). 변호사가 곧 답변드릴게요.`,
      });
    } catch (error) {
      logger.error("연락처 모달 제출 중 오류:", error);
    }
  });

  // ────────────────────────────────────────────────────────────
  // 6. 홈탭 온보딩
  // ────────────────────────────────────────────────────────────
  app.event("app_home_opened", async ({ event, client, logger }) => {
    // app_home_opened는 messages 탭 진입 시에도 발생 — home 탭에서만 publish
    if ((event as any).tab !== "home") return;

    try {
      await client.views.publish({
        user_id: event.user,
        view: buildHomeView(),
      });
    } catch (error) {
      logger.error("홈탭 publish 중 오류:", error);
    }
  });
}
