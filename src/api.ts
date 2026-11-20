import {
  withChangeTask,
  requestChangeEnvironment,
  changeTaskId,
  CHANGE_EVENT,
} from "./change-context";
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  // A first launch imports the snapshot before the API starts listening.
  // Only reads may retry; writes must never be submitted twice.
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch("/api" + withChangeTask(path), {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (method === "GET" && error instanceof TypeError && attempt < 4) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * 2 ** attempt),
        );
        continue;
      }
      throw error;
    }
    if (
      method === "GET" &&
      [502, 503, 504].includes(response.status) &&
      attempt < 4
    ) {
      await response.text();
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    const data = await response.json().catch(() => {
      throw Error("请求失败（HTTP " + response.status + "）");
    });
    if (!response.ok) {
      if (
        typeof window !== "undefined" &&
        ["CHANGE_REQUIRED", "GROUP_RULE_IN_USE"].includes(data.code)
      )
        requestChangeEnvironment({ path, method, body });
      const error: any = new Error(data.error || "请求失败");
      error.code = data.code;
      error.details = data;
      throw error;
    }
    if (
      typeof window !== "undefined" &&
      method !== "GET" &&
      changeTaskId() &&
      !path.startsWith("/rule-drafts/test")
    )
      window.dispatchEvent(new Event(CHANGE_EVENT));
    if (
      typeof window !== "undefined" &&
      method === "POST" &&
      /^\/releases\/\d+\/(?:workflow\/action|advance)$/.test(path) &&
      ["已完成", "已回滚"].includes(data?.status)
    ) {
      // A scene may be open in the publishing tab or in another tab.
      window.dispatchEvent(new Event(CHANGE_EVENT));
      try {
        localStorage.setItem(
          "zeus-policy-publication",
          Date.now() + ":" + Math.random(),
        );
      } catch {
        // Storage may be disabled. The committed action and same-tab refresh still succeed.
      }
    }
    return data;
  }
}
export const entityPath = (module: string, id?: number) =>
  "/entities/" +
  encodeURIComponent(module) +
  (id === undefined ? "" : "/" + id);
