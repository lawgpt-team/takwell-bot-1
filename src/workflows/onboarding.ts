import type { HomeView } from "@slack/web-api";

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
