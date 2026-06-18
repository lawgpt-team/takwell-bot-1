import { WebClient, type HomeView, type KnownBlock } from "@slack/web-api";

// 홈탭은 워크스페이스 전체에 표시되는 정적 안내라, 의뢰인 데이터를 담지 않는다.
export function buildHomeView(): HomeView {
  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "⚖️ 법률사무소 탁월 — AI 사건정리 비서",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "안녕하세요. 저는 *탁월(Takwell)* 입니다.\n" +
            "법률 문제를 말씀해 주시면, 변호사님이 5분 안에 사건을 파악할 수 있도록 *구조화된 브리핑*을 만들어 드려요.",
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*사용법*\n" +
            "1. 채널에서 `@탁월`을 멘션하고 상황을 설명해 주세요.\n" +
            "2. 제가 빠진 정보를 *몇 가지 질문*으로 정리해 드립니다.\n" +
            "3. 답변해 주시면 *변호사용 브리핑*이 완성됩니다.\n" +
            "4. 브리핑 완성 후 *연락처*를 남겨주시면 변호사가 답변드립니다.",
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*이런 분들이 사용하세요*\n" +
            "• 계약서 검토가 필요한 분\n" +
            "• 미수금 청구·손해배상 문제\n" +
            "• 근로·노동 관련 문의\n" +
            "• 그 외 일반 민·형사 사건",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              "🔒 의뢰인 정보는 변호사 전달 목적으로만 사용됩니다. " +
              "최종 법률 판단은 반드시 변호사 검토가 필요합니다.",
          },
        ],
      },
    ],
  };
}

// 설치 직후 설치한 사람에게 보내는 환영 DM의 블록.
// "워크스페이스에 추가했으니, 채널에 초대하고 멘션해서 스레드에서 대화하라"는
// 3단계 가이드가 핵심.
function buildWelcomeDMBlocks(): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "👋 탁월 봇 설치 완료" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "안녕하세요! 법률사무소 *탁월*의 AI 사건정리 비서, *탁월(Takwell)* 입니다.\n" +
          "워크스페이스에 추가해 주셔서 감사합니다. 아래 3단계만 따라 하시면 바로 사용하실 수 있어요.",
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*1️⃣ 사용할 채널에 탁월을 초대해 주세요*\n" +
          "해당 채널에서 `/invite @탁월` 을 입력하시거나, 채널 설정에서 멤버로 추가해 주세요.",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*2️⃣ 채널에서 `@탁월`을 멘션하고 법률 문제를 말씀해 주세요*\n" +
          "예: `@탁월 거래처가 3개월째 대금을 지급하지 않고 있습니다`",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*3️⃣ 생성된 스레드에서 후속 질문에 답해 주세요*\n" +
          "몇 가지 질문에 답하시면 *변호사용 사건 브리핑*이 완성됩니다. " +
          "마지막에 연락처를 남겨주시면 변호사가 답변드려요.",
      },
    },
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "💡 앱 홈 탭에서도 사용법을 다시 확인하실 수 있어요.",
        },
      ],
    },
  ];
}

// 설치한 사람에게 환영 DM을 발송한다.
// channel에 userId를 넣으면 Slack이 봇과의 DM 채널을 자동으로 열고 메시지를 보낸다.
// 필요한 스코프: chat:write + im:write (BOT_SCOPES에 이미 포함)
export async function sendWelcomeDM(args: {
  botToken: string;
  userId: string;
}): Promise<void> {
  const client = new WebClient(args.botToken);
  await client.chat.postMessage({
    channel: args.userId,
    text: "탁월 봇 설치를 환영합니다. 사용법을 안내해 드릴게요.",
    blocks: buildWelcomeDMBlocks(),
  });
}
