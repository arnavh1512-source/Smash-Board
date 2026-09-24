import { afterEach, describe, expect, it, vi } from "vitest";
import { clientId } from "@/lib/clientId";

/**
 * The device id the sign-in and create throttles key on. It must survive a
 * reload, and a browser that refuses storage must still be able to use the app.
 */

const KEY = "smashboard.client";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clientId", () => {
  it("has no id on the server", () => {
    expect(clientId()).toBeUndefined();
  });

  it("returns the id this device already has", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage({ [KEY]: "abc123" }) });
    expect(clientId()).toBe("abc123");
  });

  it("mints a 128-bit hex id on first visit and keeps it", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const first = clientId();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(storage.data.get(KEY)).toBe(first);
    expect(clientId()).toBe(first);
  });

  it("gives up quietly when storage is blocked", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {},
      },
    });
    expect(clientId()).toBeUndefined();
  });
});
