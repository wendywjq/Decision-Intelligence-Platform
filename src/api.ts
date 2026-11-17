export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "请求失败");
  return data;
}
export const entityPath = (module: string, id?: number) =>
  "/entities/" +
  encodeURIComponent(module) +
  (id === undefined ? "" : "/" + id);
