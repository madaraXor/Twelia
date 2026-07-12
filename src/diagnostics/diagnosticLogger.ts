import type { DiagnosticContext, DiagnosticEvent, LogLevel } from "./diagnosticTypes";
import { anonymousReference, redactSensitiveData } from "./redaction";
import { createId } from "../core/id";

type Listener = (events: DiagnosticEvent[]) => void;
const appSessionId = createId();

class DiagnosticLogger {
  private events: DiagnosticEvent[] = [];
  private listeners = new Set<Listener>();

  private write(
    level: LogLevel,
    module: string,
    message: string,
    context: Partial<DiagnosticContext> = {},
  ): void {
    const event: DiagnosticEvent = {
      id: createId(),
      timestamp: new Date().toISOString(),
      level,
      module,
      message: redactSensitiveData(message),
      context: {
        appSessionId,
        ...(context.gameSessionId ? { gameSessionId: context.gameSessionId } : {}),
        ...(context.accountId ? { accountId: anonymousReference(context.accountId) } : {}),
        ...(context.tabId ? { tabId: context.tabId } : {}),
      },
    };
    this.events = [...this.events.slice(-499), event];
    this.listeners.forEach((listener) => listener(this.events));
  }

  trace(module: string, message: string, context?: Partial<DiagnosticContext>): void {
    this.write("TRACE", module, message, context);
  }
  debug(module: string, message: string, context?: Partial<DiagnosticContext>): void {
    this.write("DEBUG", module, message, context);
  }
  info(module: string, message: string, context?: Partial<DiagnosticContext>): void {
    this.write("INFO", module, message, context);
  }
  warn(module: string, message: string, context?: Partial<DiagnosticContext>): void {
    this.write("WARN", module, message, context);
  }
  error(module: string, message: string, context?: Partial<DiagnosticContext>): void {
    this.write("ERROR", module, message, context);
  }
  clear(): void {
    this.events = [];
    this.listeners.forEach((listener) => listener(this.events));
  }
  getEvents(): DiagnosticEvent[] {
    return this.events;
  }
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.events);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const diagnosticLogger = new DiagnosticLogger();
