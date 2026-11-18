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
