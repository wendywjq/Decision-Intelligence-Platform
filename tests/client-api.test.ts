import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/api.ts";
test("catalog reads recover when the development API is still starting, without retrying writes", async () => {
  let calls = 0;
  const fetchMock = mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1
      ? new Response("proxy unavailable", { status: 502 })
      : Response.json({ ready: true });
  });
  try {
    assert.deepEqual(await api("/entities/rulePage"), { ready: true });
    assert.equal(calls, 2);
    fetchMock.mock.mockImplementation(async () => {
      calls++;
      return Response.json({ error: "unavailable" }, { status: 503 });
    });
    const before = calls;
    await assert.rejects(
      api("/entities/rulePage", "POST", { name: "once" }),
      /unavailable/,
    );
    assert.equal(calls, before + 1);
  } finally {
    fetchMock.mock.restore();
  }
});

test("only a committed publish or rollback refreshes other open scene tabs", async () => {
  const writes: string[] = [],
    events: string[] = [];
  const mockWindow = Object.assign(new EventTarget(), {
    location: { hash: "#/release/gray-detail?id=1" },
  });
  mockWindow.addEventListener("zeus-change-environment", (e) =>
    events.push(e.type),
  );
  const descriptors = ["window", "localStorage", "sessionStorage"].map(
    (k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const,
  );
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: mockWindow },
    localStorage: {
      configurable: true,
      value: { setItem: (key: string) => writes.push(key) },
    },
    sessionStorage: { configurable: true, value: { getItem: () => null } },
  });
  let status = "灰度中";
  const f = mock.method(globalThis, "fetch", async () =>
    Response.json({ status }),
  );
  try {
    for (status of ["灰度中", "已完成", "已回滚"])
      await api("/releases/1/workflow/action", "POST", {});
    assert.equal(events.length, 2);
    assert.deepEqual(writes, [
      "zeus-policy-publication",
      "zeus-policy-publication",
    ]);
    f.mock.mockImplementation(async () =>
      Response.json({ error: "conflict" }, { status: 409 }),
    );
    await assert.rejects(api("/releases/1/workflow/action", "POST", {}));
    assert.equal(writes.length, 2);
  } finally {
    f.mock.restore();
    for (const [key, d] of descriptors) {
      if (d) Object.defineProperty(globalThis, key, d);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
