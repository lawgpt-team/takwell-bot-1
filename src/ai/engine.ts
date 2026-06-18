import Anthropic from "@anthropic-ai/sdk";
import {
  SYSTEM_PROMPT,
  INTAKE_STEP1_PROMPT,
  INTAKE_STEP2_PROMPT,
  CONTRACT_REVIEW_PROMPT,
  QUICK_QUESTION_PROMPT,
} from "./prompts.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
}

const client = new Anthropic({ apiKey });

export type IntakeStep = "step1" | "step2" | "contract_review" | "quick_question";

export type Message = {
  role: "user" | "assistant";
  content: string;
};

export type IntakeResult = {
  text: string;
  isBriefingComplete: boolean;
};

// 의뢰인 메시지가 시스템 프롬프트 경계를 깨지 못하도록 태그 탈출 시도를 제거한다.
const CLIENT_TAG_PATTERN = /<\/?client_message>/gi;

function wrapClientMessage(content: string): string {
  const sanitized = content.replace(CLIENT_TAG_PATTERN, "");
  return `<client_message>\n${sanitized}\n</client_message>`;
}

const BRIEFING_HEADERS = ["사건 브리핑", "계약서 검토 브리핑"];
const BRIEFING_SECTIONS = [
  "사건 개요",
  "핵심 쟁점",
  "확보된 정보",
  "관련 법령",
  "검토 포인트",
  "긴급도 판단",
  "계약 개요",
  "리스크 분석",
  "수정 권고",
  "빠진 조항",
  "종합 의견",
];

export function isBriefingComplete(text: string): boolean {
  const hasHeader = BRIEFING_HEADERS.some((header) => text.includes(header));
  if (!hasHeader) return false;

  const sectionHits = BRIEFING_SECTIONS.filter((section) => text.includes(section)).length;
  return sectionHits >= 2;
}

// 간단한 질문 패턴 — 사건 접수 플로우를 거치지 않고 빠른 답변이 가능한 경우
const QUICK_QUESTION_PATTERNS = [
  "몇일",
  "며칠",
  "기간이",
  "가능한가요",
  "되나요",
  "할 수 있나요",
  "뜻이",
  "의미가",
  "차이가",
];

export function classifyMessage(text: string): IntakeStep {
  const lower = text.toLowerCase();

  if (text.includes("계약서") && (text.includes("검토") || text.includes("리뷰"))) {
    return "contract_review";
  }

  if (text.length < 50 && QUICK_QUESTION_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return "quick_question";
  }

  return "step1";
}

function selectStepPrompt(step: IntakeStep): string {
  switch (step) {
    case "step1":
      return INTAKE_STEP1_PROMPT;
    case "step2":
      return INTAKE_STEP2_PROMPT;
    case "contract_review":
      return CONTRACT_REVIEW_PROMPT;
    case "quick_question":
      return QUICK_QUESTION_PROMPT;
  }
}

// 의뢰인 입력만 격리 태그로 감싸고, 모델 응답은 그대로 둔다.
function buildAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.role === "user" ? wrapClientMessage(message.content) : message.content,
  }));
}

export async function runIntake(step: IntakeStep, messages: Message[]): Promise<IntakeResult> {
  // 시스템 프롬프트 + 스텝별 지침을 두 개의 텍스트 블록으로 분리해 캐시 효과를 노린다.
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: selectStepPrompt(step) },
    ],
    messages: buildAnthropicMessages(messages),
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return {
    text,
    isBriefingComplete: isBriefingComplete(text),
  };
}
