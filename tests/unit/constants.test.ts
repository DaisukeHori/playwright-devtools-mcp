import { describe, it, expect } from "vitest";
import { CHARACTER_LIMIT, DEFAULT_TIMEOUT, DEFAULT_VIEWPORT, MAX_CONSOLE_LOGS, MAX_NETWORK_REQUESTS, MAX_DOM_DEPTH, SERVER_NAME, SERVER_VERSION } from "../../src/constants.js";

describe("constants", () => {
  it("CHARACTER_LIMIT should be a positive number", () => {
    expect(CHARACTER_LIMIT).toBeGreaterThan(0);
    expect(CHARACTER_LIMIT).toBeTypeOf("number");
  });

  it("DEFAULT_TIMEOUT should be 30 seconds", () => {
    expect(DEFAULT_TIMEOUT).toBe(30000);
  });

  it("DEFAULT_VIEWPORT should have width and height", () => {
    expect(DEFAULT_VIEWPORT).toHaveProperty("width");
    expect(DEFAULT_VIEWPORT).toHaveProperty("height");
    expect(DEFAULT_VIEWPORT.width).toBeGreaterThan(0);
    expect(DEFAULT_VIEWPORT.height).toBeGreaterThan(0);
  });

  it("MAX_CONSOLE_LOGS should be reasonable", () => {
    expect(MAX_CONSOLE_LOGS).toBeGreaterThanOrEqual(100);
    expect(MAX_CONSOLE_LOGS).toBeLessThanOrEqual(10000);
  });

  it("MAX_NETWORK_REQUESTS should be reasonable", () => {
    expect(MAX_NETWORK_REQUESTS).toBeGreaterThanOrEqual(100);
  });

  it("MAX_DOM_DEPTH should be reasonable", () => {
    expect(MAX_DOM_DEPTH).toBeGreaterThanOrEqual(3);
    expect(MAX_DOM_DEPTH).toBeLessThanOrEqual(50);
  });

  it("SERVER_NAME should be playwright-devtools-mcp", () => {
    expect(SERVER_NAME).toBe("playwright-devtools-mcp");
  });

  it("SERVER_VERSION should be semver format", () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
