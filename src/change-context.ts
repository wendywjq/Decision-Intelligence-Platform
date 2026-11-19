import { useEffect, useState } from "react";
const KEY = "zeus-change-task";
export const CHANGE_EVENT = "zeus-change-environment";
export function changeTaskId() {
  if (typeof window === "undefined") return 0;
  const q = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const explicit = q.get("changeTaskId");
  if (explicit) {
    const id = Number(explicit);
    if (id > 0) {
      sessionStorage.setItem(KEY, String(id));
      return id;
    }
  }
  return Number(sessionStorage.getItem(KEY)) || 0;
}
export function withChangeTask(path: string, id = changeTaskId()) {
  if (!id || /^(https?:|mailto:)/.test(path)) return path;
  const [base, query = ""] = path.split("?");
  const q = new URLSearchParams(query);
  if (!q.has("changeTaskId")) q.set("changeTaskId", String(id));
  return base + "?" + q;
}
export function enterChangeEnvironment(id: number, path?: string) {
  sessionStorage.setItem(KEY, String(id));
  const current = path || window.location.hash.slice(1) || "/scene";
  window.location.hash = withChangeTask(current, id);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function leaveChangeEnvironment(path?: string) {
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem("zeus-edit-policy");
  sessionStorage.removeItem("zeus-edit-rule");
  const current = path || window.location.hash.slice(1) || "/scene";
  const [base, query = ""] = current.split("?");
  const q = new URLSearchParams(query);
  q.delete("changeTaskId");
  window.location.hash = base + (q.size ? "?" + q : "");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function useChangeTaskId() {
  const [id, setId] = useState(changeTaskId);
  useEffect(() => {
    const sync = () => setId(changeTaskId());
    window.addEventListener("hashchange", sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);
  return id;
}
export function requestChangeEnvironment(detail: any = {}) {
  window.dispatchEvent(new CustomEvent("zeus-open-change", { detail }));
}
