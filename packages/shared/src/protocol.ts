import type { TaskPayload, TaskResult } from "./schemas.ts";

/** Сообщения по WebSocket между сервером и расширением. */

export type ServerMessage = { type: "task"; id: string; payload: TaskPayload };

export type ExtensionMessage =
  | { type: "hello"; version: string }
  | { type: "ping" }
  | { type: "result"; id: string; result: TaskResult };
