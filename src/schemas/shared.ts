import { z } from "zod";

export const SessionIdSchema = z.object({
  session_id: z.string().describe("Browser session ID returned by browser_launch"),
}).strict();

export const SessionIdWithUrlSchema = z.object({
  session_id: z.string().describe("Browser session ID returned by browser_launch"),
  url: z.string().url().describe("URL to navigate to"),
}).strict();

export function makeSuccess(sessionId: string, data: unknown, startTime?: number): {
  content: Array<{ type: "text"; text: string }>;
} {
  const result = {
    success: true,
    data,
    metadata: {
      timestamp: Date.now(),
      duration: startTime ? Date.now() - startTime : undefined,
      sessionId,
    },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

export function makeError(sessionId: string, code: string, message: string, details?: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const result = {
    success: false,
    data: null,
    metadata: {
      timestamp: Date.now(),
      sessionId,
    },
    error: { code, message, details },
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    isError: true,
  };
}
