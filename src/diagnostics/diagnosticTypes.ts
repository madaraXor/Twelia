import type { GameSessionStatus } from "../game/gameTypes";

export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

export type DiagnosticContext = {
  appSessionId: string;
  gameSessionId?: string;
  accountId?: string;
  tabId?: string;
};

export type DiagnosticEvent = {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context: DiagnosticContext;
};

export type SanitizedSessionDiagnostic = {
  id: string;
  accountReference: string;
  status: GameSessionStatus;
  updatedAt: string;
};

export type DiagnosticReport = {
  generatedAt: string;
  tweliaVersion: string;
  platform: string;
  architecture: string;
  webviewVersion?: string;
  installedClientVersion?: string;
  sessions: SanitizedSessionDiagnostic[];
  recentErrors: Array<{ code: string; message: string; timestamp: string }>;
  configuration: Record<string, unknown>;
};
