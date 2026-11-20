import { useState } from "react";
import { Alert, Button, Descriptions, Empty, Input, Table } from "antd";
import { RawData } from "./SourceExamples";
import { Section } from "./components";
import { Link } from "./navigation";
function percent(v: any) {
  return v === undefined || v === null || Number(v) < 0
    ? "—"
    : (Number(v) * 100).toFixed(2) + "%";
}
function Metric({ value }: { value: any }) {
  if (value === null || value === undefined) return <>—</>;
  if (typeof value !== "object") return <>{String(value)}</>;
  if ("hitCount" in value || "hitRate" in value)
    return (
      <>
        {value.hitCount ?? "—"} / {percent(value.hitRate)}
      </>
    );
  if ("recallRate" in value) return <>{percent(value.recallRate)}</>;
  return <RawData value={value} title="查看指标" />;
}
export function CompareTable({
  data,
  sample,
  gray,
}: {
  data: any;
  sample?: boolean;
  gray?: boolean;
}) {
  const rows = data?.items?.length
    ? data.items
    : data?.sceneCompareDatas || data?.list || [];
  const columns: any[] = [
    {
      title: "场景",
      render: (_: any, r: any) =>
        `${r.sceneId ?? r.id ?? ""}-${r.sceneName || r.name || ""}`,
    },
  ];
  const keys = sample
    ? [
        ["blockRecallData", "必防样本-召回率"],
        ["regressionRecallData", "回归样本-召回率"],
        ["regressionFalsePositiveData", "回归样本-误伤率"],
      ]
    : gray
      ? [
          ["grayHitData", "灰度命中"],
          ["onlineHitData", "线上命中"],
        ]
      : [
          ["labHitData", "实验命中"],
          ["labIndependentHitData", "实验独立命中"],
          ["onlineHitData", "线上命中"],
          ["onlineIndependentHitData", "线上独立命中"],
        ];
  for (const [key, title] of keys)
    columns.push({
      title,
      dataIndex: key,
      render: (v: any, r: any) => (
        <Metric
          value={
            v ??
            r[key.replace("HitData", "Data")] ??
            r[key.replace("Data", "Rate")]
          }
        />
      ),
    });
  columns.push({
    title: "详细数据",
    render: (_: any, r: any) => <RawData value={r} />,
  });
  return (
    <>
      <>
        {data?.sourceCountMismatch && (
          <Alert
            type="warning"
            message={`源平台报告 ${data.total} 条，分页实际返回 ${data.capturedCount} 条；已保留所有返回数据。`}
          />
        )}
      </>
      <Table<any>
        rowKey={(r, i) => String(r.sceneId ?? r.id ?? i)}
        dataSource={rows}
        columns={columns}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showTotal: (n) => `共 ${n} 条`,
        }}
      />
    </>
  );
}
export function RequestIds({ data }: { data: any }) {
  const items = data?.items || data?.requestIds || [];
  const [q, setQ] = useState("");
  function download() {
    const ids = items
      .map((x: any) =>
        typeof x === "string" ? x : x.requestId || JSON.stringify(x),
      )
      .filter((v: string) => !q || v.includes(q));
    const csv =
      "requestId\r\n" +
      ids.map((v: string) => '"' + v.replaceAll('"', '""') + '"').join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "release-request-ids.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Section title={`数据明细（共 ${data?.total ?? items.length} 条）`}>
      <Input.Search
        style={{ maxWidth: 500, marginBottom: 16 }}
        placeholder="搜索已导入的请求ID"
        allowClear
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Button
        onClick={download}
        disabled={!items.length}
        style={{ marginLeft: 12, marginBottom: 16 }}
      >
        下载数据明细
      </Button>
      {data?.sourceCountMismatch && (
        <Alert
          type="warning"
          message={`来源报告 ${data.total} 条，实际归档 ${data.capturedCount} 条；下载包含已归档的数据。`}
        />
      )}
      <Table<any>
        rowKey={(r: any) => r.requestId}
        dataSource={items
          .map((x: any, i: number) => ({
            id: i + 1,
            requestId:
              typeof x === "string" ? x : x.requestId || JSON.stringify(x),
          }))
          .filter((r: any) => !q || r.requestId.includes(q))}
        columns={[
          { title: "ID", dataIndex: "id", width: 80 },
          {
            title: "请求ID",
            dataIndex: "requestId",
            render: (v: string) => (
              <Link
                target="_blank"
                to={"/strategyCheckLog?requestId=" + encodeURIComponent(v)}
              >
                {v}
              </Link>
            ),
          },
        ]}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
      />
    </Section>
  );
}
export function SummaryStatistics({ data }: { data: any }) {
  const names: Record<string, string> = {
    labData: "实验数据",
    onlineData: "线上数据",
    grayData: "灰度数据",
    blockRecallData: "必防样本召回",
    regressionRecallData: "回归样本召回",
    regressionFalsePositiveData: "回归样本误伤",
    labRecallData: "实验召回",
    labPrecisionData: "实验精确率",
  };
  if (!data) return <Empty description="该任务没有此类实验数据" />;
  return (
    <>
      <Descriptions
        bordered
        column={3}
        items={Object.entries(names)
          .filter(([key]) => data[key])
          .map(([key, label]) => ({
            key,
            label,
            children: (
              <>
                <Metric value={data[key]} />
                <div className="muted">
                  请求量 {data[key].requestCount ?? "—"}
                </div>
              </>
            ),
          }))}
      />
      <div style={{ marginTop: 12 }}>
        <RawData value={data} title="查看完整指标、时序与SQL" />
      </div>
    </>
  );
}
