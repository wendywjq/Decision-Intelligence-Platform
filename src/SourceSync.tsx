import { Button, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
export function SourceSync({
  kind,
  id,
  refresh,
  auto,
}: {
  kind: "rule" | "feature";
  id: number;
  refresh: () => void;
  auto: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const refreshed = useRef(refresh);
  refreshed.current = refresh;
  useEffect(() => {
    if (!auto && !retry) return;
    let active = true;
    setBusy(true);
    setError("");
    api("/source/sync/" + kind + "/" + id, "POST", {})
      .then(() => {
        if (active) refreshed.current();
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [id, kind, auto, retry]);
  return (
    <Space>
      <Button
        size="small"
        loading={busy}
        onClick={() => setRetry((n) => n + 1)}
      >
        {kind === "rule" ? "获取 Zeus 历史版本" : "获取 Zeus 累计配置"}
      </Button>
      {error && <Typography.Text type="secondary">{error}</Typography.Text>}
    </Space>
  );
}
