import { describe, it, expect } from "vitest";
import { makeSuccess, makeError } from "../../src/schemas/shared.js";

describe("schemas/shared", () => {
  describe("makeSuccess", () => {
    it("should create a success response with data", () => {
      const result = makeSuccess("session-1", { foo: "bar" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toEqual({ foo: "bar" });
      expect(parsed.metadata.sessionId).toBe("session-1");
      expect(parsed.metadata.timestamp).toBeTypeOf("number");
    });

    it("should include duration when startTime provided", () => {
      const start = Date.now() - 100;
      const result = makeSuccess("s1", {}, start);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.duration).toBeGreaterThanOrEqual(99);
    });

    it("should omit duration when startTime not provided", () => {
      const result = makeSuccess("s1", {});
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.duration).toBeUndefined();
    });

    it("should handle null data", () => {
      const result = makeSuccess("s1", null);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toBeNull();
    });

    it("should handle array data", () => {
      const result = makeSuccess("s1", [1, 2, 3]);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toEqual([1, 2, 3]);
    });

    it("should handle nested object data", () => {
      const nested = { a: { b: { c: [1, { d: true }] } } };
      const result = makeSuccess("s1", nested);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data).toEqual(nested);
    });

    it("should handle empty string session id", () => {
      const result = makeSuccess("", { ok: true });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.sessionId).toBe("");
    });

    it("should handle very large data objects", () => {
      const data = { items: Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `item-${i}` })) };
      const result = makeSuccess("s1", data);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.items).toHaveLength(1000);
    });

    it("should handle special characters in data", () => {
      const result = makeSuccess("s1", { text: "日本語テスト\n\t\"quotes\"" });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.data.text).toBe("日本語テスト\n\t\"quotes\"");
    });

    it("should always set timestamp close to now", () => {
      const before = Date.now();
      const result = makeSuccess("s1", {});
      const after = Date.now();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.timestamp).toBeGreaterThanOrEqual(before);
      expect(parsed.metadata.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("makeError", () => {
    it("should create an error response", () => {
      const result = makeError("s1", "ERR_CODE", "Something failed");
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.data).toBeNull();
      expect(parsed.error.code).toBe("ERR_CODE");
      expect(parsed.error.message).toBe("Something failed");
    });

    it("should include details when provided", () => {
      const result = makeError("s1", "ERR", "msg", { url: "http://test.com", timeout: 5000 });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.details).toEqual({ url: "http://test.com", timeout: 5000 });
    });

    it("should omit details when not provided", () => {
      const result = makeError("s1", "ERR", "msg");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.details).toBeUndefined();
    });

    it("should set sessionId in metadata", () => {
      const result = makeError("session-xyz", "ERR", "msg");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.sessionId).toBe("session-xyz");
    });

    it("should set timestamp in metadata", () => {
      const before = Date.now();
      const result = makeError("s1", "ERR", "msg");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.timestamp).toBeGreaterThanOrEqual(before);
    });

    it("should handle empty error message", () => {
      const result = makeError("s1", "ERR", "");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.message).toBe("");
    });

    it("should handle unicode in error message", () => {
      const result = makeError("s1", "ERR", "エラーが発生しました");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.message).toBe("エラーが発生しました");
    });

    it("should not include duration", () => {
      const result = makeError("s1", "ERR", "msg");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.duration).toBeUndefined();
    });
  });
});
