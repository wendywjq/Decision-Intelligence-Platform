export function formatDate(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value);
  if (/^\d{10,13}$/.test(text)) value = Number(text);
  if (typeof value === "number" || /[TZ]|[+]\d\d:\d\d$/.test(text)) {
    const date = new Date(
      typeof value === "number" && value < 1e12
        ? value * 1000
        : typeof value === "number"
          ? value
          : text,
    );
    if (Number.isFinite(date.getTime()))
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(date);
  }
  return text;
}
