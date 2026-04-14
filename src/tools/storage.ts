import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser-manager.js";
import { makeSuccess, makeError } from "../schemas/shared.js";

export function registerStorageTools(server: McpServer): void {
  // ─── storage_get_local_storage ─────────────────────────────────
  server.registerTool(
    "storage_get_local_storage",
    {
      title: "Get localStorage",
      description: `Get all localStorage data with key, value, and size analysis.

Args:
  - session_id (string): Browser session ID
  - key_filter (string, optional): Filter keys containing this substring (case-insensitive)

Returns:
  { entries: [{ key, value, size }], totalSize: number, count: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        key_filter: z.string().optional().describe("Filter keys by substring"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const data = await session.page.evaluate((filter?: string) => {
          const entries: Array<{ key: string; value: string; size: number }> = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (filter && !key.toLowerCase().includes(filter.toLowerCase())) continue;
            const value = localStorage.getItem(key) ?? "";
            entries.push({ key, value: value.slice(0, 2000), size: key.length + value.length });
          }
          return entries;
        }, params.key_filter);

        const totalSize = data.reduce((sum, e) => sum + e.size, 0);
        return makeSuccess(params.session_id, { entries: data, totalSize, count: data.length }, start);
      } catch (err) {
        return makeError(params.session_id, "STORAGE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── storage_get_session_storage ───────────────────────────────
  server.registerTool(
    "storage_get_session_storage",
    {
      title: "Get sessionStorage",
      description: `Get all sessionStorage data with key, value, and size analysis.

Args:
  - session_id (string): Browser session ID
  - key_filter (string, optional): Filter keys containing this substring

Returns:
  { entries: [{ key, value, size }], totalSize: number, count: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        key_filter: z.string().optional().describe("Filter keys by substring"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const data = await session.page.evaluate((filter?: string) => {
          const entries: Array<{ key: string; value: string; size: number }> = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (!key) continue;
            if (filter && !key.toLowerCase().includes(filter.toLowerCase())) continue;
            const value = sessionStorage.getItem(key) ?? "";
            entries.push({ key, value: value.slice(0, 2000), size: key.length + value.length });
          }
          return entries;
        }, params.key_filter);

        const totalSize = data.reduce((sum, e) => sum + e.size, 0);
        return makeSuccess(params.session_id, { entries: data, totalSize, count: data.length }, start);
      } catch (err) {
        return makeError(params.session_id, "STORAGE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── storage_get_cookies ───────────────────────────────────────
  server.registerTool(
    "storage_get_cookies",
    {
      title: "Get Cookies",
      description: `Get all cookies for the current page including security attributes (httpOnly, secure, sameSite, expiry).

Args:
  - session_id (string): Browser session ID
  - domain_filter (string, optional): Filter by domain substring

Returns:
  { cookies: [{ name, value, domain, path, expires, httpOnly, secure, sameSite }], count: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        domain_filter: z.string().optional().describe("Filter by domain"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let cookies = await session.context.cookies();

        if (params.domain_filter) {
          const needle = params.domain_filter.toLowerCase();
          cookies = cookies.filter((c) => c.domain.toLowerCase().includes(needle));
        }

        const mapped = cookies.map((c) => ({
          name: c.name,
          value: c.value.slice(0, 500),
          domain: c.domain,
          path: c.path,
          expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : "session",
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite,
        }));

        return makeSuccess(params.session_id, { cookies: mapped, count: mapped.length }, start);
      } catch (err) {
        return makeError(params.session_id, "STORAGE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── storage_get_indexeddb_info ─────────────────────────────────
  server.registerTool(
    "storage_get_indexeddb_info",
    {
      title: "Get IndexedDB Info",
      description: `List IndexedDB databases and their object stores for the current origin.

Args:
  - session_id (string): Browser session ID

Returns:
  { databases: [{ name, version, objectStores: [{ name, keyPath, autoIncrement, count }] }] }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const databases = await session.page.evaluate(async () => {
          if (!indexedDB.databases) return [];
          const dbs = await indexedDB.databases();
          const results: Array<{
            name: string;
            version: number;
            objectStores: Array<{
              name: string;
              keyPath: string | string[] | null;
              autoIncrement: boolean;
              count: number;
            }>;
          }> = [];

          for (const dbInfo of dbs) {
            if (!dbInfo.name) continue;
            try {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(dbInfo.name!, dbInfo.version);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });

              const stores: Array<{
                name: string;
                keyPath: string | string[] | null;
                autoIncrement: boolean;
                count: number;
              }> = [];

              for (const storeName of Array.from(db.objectStoreNames)) {
                try {
                  const tx = db.transaction(storeName, "readonly");
                  const store = tx.objectStore(storeName);
                  const count = await new Promise<number>((resolve, reject) => {
                    const req = store.count();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                  });
                  stores.push({
                    name: storeName,
                    keyPath: store.keyPath as string | string[] | null,
                    autoIncrement: store.autoIncrement,
                    count,
                  });
                } catch {
                  stores.push({ name: storeName, keyPath: null, autoIncrement: false, count: -1 });
                }
              }

              results.push({ name: dbInfo.name, version: dbInfo.version ?? 0, objectStores: stores });
              db.close();
            } catch {
              results.push({ name: dbInfo.name!, version: dbInfo.version ?? 0, objectStores: [] });
            }
          }
          return results;
        });

        return makeSuccess(params.session_id, { databases, count: databases.length }, start);
      } catch (err) {
        return makeError(params.session_id, "STORAGE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── storage_clear_data ────────────────────────────────────────
  server.registerTool(
    "storage_clear_data",
    {
      title: "Clear Storage Data",
      description: `Selectively clear storage data by type.

Args:
  - session_id (string): Browser session ID
  - types (array): Storage types to clear: "localStorage", "sessionStorage", "cookies"

Returns:
  { cleared: string[] }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        types: z.array(z.enum(["localStorage", "sessionStorage", "cookies"])).min(1).describe("Storage types to clear"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const cleared: string[] = [];

        for (const type of params.types) {
          switch (type) {
            case "localStorage":
              await session.page.evaluate(() => localStorage.clear());
              cleared.push("localStorage");
              break;
            case "sessionStorage":
              await session.page.evaluate(() => sessionStorage.clear());
              cleared.push("sessionStorage");
              break;
            case "cookies":
              await session.context.clearCookies();
              cleared.push("cookies");
              break;
          }
        }

        return makeSuccess(params.session_id, { cleared }, start);
      } catch (err) {
        return makeError(params.session_id, "STORAGE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
