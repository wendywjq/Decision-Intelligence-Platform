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
      response = await fetch("/api" + path, {
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
    if (!response.ok) throw Error(data.error || "请求失败");
    return data;
  }
}
export const entityPath = (module: string, id?: number) =>
  "/entities/" +
  encodeURIComponent(module) +
  (id === undefined ? "" : "/" + id);
