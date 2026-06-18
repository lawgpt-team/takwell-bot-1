import { eq } from "drizzle-orm";
import type { Installation, InstallationQuery, InstallationStore } from "@slack/bolt";
import { db } from "../db/index.js";
import { installations } from "../db/schema.js";
import { sendWelcomeDM } from "../workflows/onboarding.js";

// CLAUDE.md 스키마는 enterprise install을 지원하지 않으므로
// team 단위 설치만 처리한다. 엔터프라이즈 그리드 설치는 별도 작업으로 분리.
export const installationStore: InstallationStore = {
  async storeInstallation(installation) {
    if (installation.isEnterpriseInstall) {
      throw new Error("엔터프라이즈 그리드 설치는 아직 지원하지 않습니다.");
    }

    const teamId = installation.team?.id;
    if (!teamId) {
      throw new Error("팀 ID 없이 설치 정보를 저장할 수 없습니다.");
    }

    const botToken = installation.bot?.token;
    if (!botToken) {
      throw new Error("봇 토큰 없이 설치 정보를 저장할 수 없습니다.");
    }

    await db
      .insert(installations)
      .values({
        teamId,
        teamName: installation.team?.name ?? "Unknown",
        botToken,
        botId: installation.bot?.id ?? null,
        botUserId: installation.bot?.userId ?? null,
        installedBy: installation.user.id,
        installedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: installations.teamId,
        set: {
          teamName: installation.team?.name ?? "Unknown",
          botToken,
          botId: installation.bot?.id ?? null,
          botUserId: installation.bot?.userId ?? null,
          installedBy: installation.user.id,
          installedAt: new Date(),
        },
      });

    // 설치한 사용자에게 환영 DM 발송. 실패해도 설치 자체는 성공으로 처리한다
    // (DM이 차단되어도 봇 자체는 정상 동작해야 하므로).
    try {
      await sendWelcomeDM({ botToken, userId: installation.user.id });
    } catch (error) {
      console.error("설치 환영 DM 발송 실패:", error);
    }
  },

  async fetchInstallation(query: InstallationQuery<boolean>): Promise<Installation> {
    if (query.isEnterpriseInstall) {
      throw new Error("엔터프라이즈 그리드 설치는 아직 지원하지 않습니다.");
    }

    const teamId = query.teamId;
    if (!teamId) {
      throw new Error("팀 ID 없이 설치 정보를 조회할 수 없습니다.");
    }

    const [row] = await db
      .select()
      .from(installations)
      .where(eq(installations.teamId, teamId))
      .limit(1);

    if (!row) {
      throw new Error(`설치 정보를 찾을 수 없습니다: team=${teamId}`);
    }

    // Bolt InstallationStore는 Installation 형태로 복원된 객체를 요구한다.
    // CLAUDE.md 스키마에 저장되지 않은 필드(scopes, appId 등)는 비워두고
    // Bolt가 요청에 필요한 최소 정보만 채운다.
    const installation: Installation<"v2", false> = {
      team: { id: row.teamId, name: row.teamName },
      enterprise: undefined,
      bot: {
        token: row.botToken,
        id: row.botId ?? "",
        userId: row.botUserId ?? "",
        scopes: [],
      },
      user: { id: row.installedBy ?? "", token: undefined, scopes: undefined },
      tokenType: "bot",
      isEnterpriseInstall: false,
      appId: undefined,
      authVersion: "v2",
    };
    return installation;
  },

  async deleteInstallation(query: InstallationQuery<boolean>) {
    const teamId = query.teamId;
    if (!teamId) return;
    await db.delete(installations).where(eq(installations.teamId, teamId));
  },
};
