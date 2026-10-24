import type { ProbePayload, ProbeResult, TaskPayload, TaskResult } from "./schemas.ts";

/** Сообщения по WebSocket между сервером и расширением. */

export type ServerMessage =
  | { type: "task"; id: string; payload: TaskPayload }
  | { type: "probe"; id: string; payload: ProbePayload };

export type ExtensionMessage =
  | { type: "hello"; version: string }
  | { type: "ping" }
  | { type: "result"; id: string; result: TaskResult }
  | { type: "probe_result"; id: string; result: ProbeResult };
