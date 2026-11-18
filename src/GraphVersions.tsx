import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
} from "antd";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useRemote } from "./components";
import { SourceGraphView } from "./SourceGraph";
import { RawData } from "./SourceExamples";
import { formatDate } from "./date";
export function GraphVersions({
  id,
  versions,
  current,
  kind = "graph",
}: {
  id: number;
  versions: any[];
  current: number;
  kind?: string;
}) {
  const [q, setQ] = useState(""),
    [compare, setCompare] = useState<any>(),
    [open, setOpen] = useState(false),
    [preview, setPreview] = useState<any>(),
    [editing, setEditing] = useState<any>(),
    [reason, setReason] = useState("");
  const { message } = App.useApp();
  const local = useRemote<any>("/settings/graph-drafts-" + kind + "-" + id);
  const drafts = local.data?.items || [];
  const activated = useRemote<any>("/settings/graph-active-" + kind + "-" + id);
  async function copy(r: any, upgradeDesc?: string) {
    try {
      const graph =
        r.graph ||
        r.sourceGraph ||
        (await api("/source/graph/" + id + "/version/" + r.version));
      const next = {
        version: "本地草稿-" + Date.now(),
        sourceVersion: r.version,
        status: -1,
        modifier: "local",
        modtime: Date.now(),
        upgradeDesc: upgradeDesc || "从 V" + r.version + " 复制",
        graph,
      };
      await api("/settings/graph-drafts-" + kind + "-" + id, "PUT", {
        items: [next, ...drafts],
      });
      local.reload();
      message.success("草稿已保存，可查看画布和比较");
      setEditing(undefined);
    } catch (e: any) {
      message.error(e.message);
    }
  }
  async function activate(r: any) {
    try {
      const graph =
        r.graph || (await api("/source/graph/" + id + "/version/" + r.version));
      await api("/settings/graph-active-" + kind + "-" + id, "PUT", {
        version: r.version,
        graph,
        activatedAt: Date.now(),
      });
      activated.reload();
      message.success("本地版本已上线，重新打开场景即可查看");
    } catch (e: any) {
      message.error(e.message);
    }
  }
  async function diff(r: any) {
    try {
      const left = await api("/source/graph/" + id + "/version/" + current),
        right =
          r.graph ||
          (await api("/source/graph/" + id + "/version/" + r.version));
      const nodes = (g: any) => {
        const items: any[] = [];
        const walk = (ns: any[], prefix = "") => {
          for (const n of ns || []) {
            items.push({
              path: prefix + n.id,
              name: n.data?.name,
              type: n.componentType,
              config: n,
            });
            if (n.data?.template)
              walk(n.data.template.nodes, prefix + n.id + "-");
          }
        };
        walk(g.nodes);
        items.push({
          path: "连线",
          name: "连线配置",
          type: "edges",
          config: g.edges || [],
        });
        return items;
      };
      const a = nodes(left),
        b = nodes(right);
      const paths = new Set([...a, ...b].map((n) => n.path));
      setCompare({
        label: `V${current} → ${r.version}`,
        items: [...paths].map((path) => {
          const before = a.find((n) => n.path === path),
            after = b.find((n) => n.path === path);
          return {
            path,
            before,
            after,
            state: !before
              ? "新增"
              : !after
                ? "删除"
                : JSON.stringify(before) === JSON.stringify(after)
                  ? "未变更"
                  : "修改",
          };
        }),
      });
      setOpen(true);
    } catch (e: any) {
      message.error(e.message);
    }
  }
  const rows = [...drafts, ...versions].filter(
    (r) =>
      !q || `${r.version} ${r.modifier} ${r.upgradeDesc || ""}`.includes(q),
  );
  return (
    <>
      <div className="source-table-filters">
        <Input.Search
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="版本 / 修改人 / 升级说明"
        />
      </div>
      <Table<any>
        rowKey="version"
        dataSource={rows.map((r) => ({
          ...r,
          status:
            activated.data?.version != null
              ? String(r.version) === String(activated.data.version)
                ? 64
                : r.graph
                  ? -1
                  : 0
              : r.status,
        }))}
        pagination={{ pageSize: 15, showTotal: (n) => `共 ${n} 个版本` }}
        columns={[
          {
            title: "版本",
            render: (_, r) => (
              <b>
                {typeof r.version === "number" ? "V" : ""}
                {r.version}
              </b>
            ),
          },
          {
            title: "状态",
            render: (_, r) => (
              <Tag
                color={
                  r.status === 64
                    ? "green"
                    : r.status === -1
                      ? "orange"
                      : "default"
                }
              >
                {r.status === 64
                  ? "使用中"
                  : r.status === -1
                    ? "编辑中"
                    : "未使用"}
              </Tag>
            ),
          },
          {
            title: "原版本",
            render: (_, r) =>
              r.sourceVersion ?? r.baseVersion ?? r.originVersion ?? "—",
          },
          { title: "升级原因", dataIndex: "upgradeDesc" },
          { title: "创建人", dataIndex: "creator" },
          { title: "修改人", dataIndex: "modifier" },
          {
            title: "修改时间",
            render: (_, r) => formatDate(r.modtime || r.modTime),
          },
          {
            title: "操作",
            render: (_, r) => (
              <Space>
                {r.graph ? (
                  <Button type="link" onClick={() => setPreview(r)}>
                    查看草稿
                  </Button>
                ) : (
                  <Link
                    target="_blank"
                    to={
                      (kind === "template"
                        ? "/layerScene/template/detail"
                        : "/layerScene/detail") +
                      "?id=" +
                      id +
                      "&version=" +
                      r.version
                    }
                  >
                    查看
                  </Link>
                )}
                {kind === "graph" && (
                  <>
                    <Button
                      type="link"
                      onClick={() => {
                        setEditing({
                          ...r,
                          graph: undefined,
                          sourceGraph: r.graph,
                        });
                        setReason("从 " + r.version + " 升级");
                      }}
                    >
                      升级为草稿
                    </Button>
                    <Popconfirm
                      title="将此版本设为本地使用中版本？"
                      onConfirm={() => activate(r)}
                    >
                      <Button type="link" disabled={r.status === 64}>
                        上线
                      </Button>
                    </Popconfirm>
                    {r.graph && (
                      <Button
                        type="link"
                        onClick={() => {
                          setEditing(r);
                          setReason(r.upgradeDesc || "");
                        }}
                      >
                        修改升级原因
                      </Button>
                    )}
                    {r.graph && r.status !== 64 && (
                      <Popconfirm
                        title="删除此本地草稿？原始版本仍保留。"
                        onConfirm={async () => {
                          await api(
                            "/settings/graph-drafts-" + kind + "-" + id,
                            "PUT",
                            {
                              items: drafts.filter(
                                (d: any) => d.version !== r.version,
                              ),
                            },
                          );
                          local.reload();
                        }}
                      >
                        <Button type="link" danger>
                          删除草稿
                        </Button>
                      </Popconfirm>
                    )}
                    <Button type="link" onClick={() => diff(r)}>
                      版本比较
                    </Button>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing?.graph ? "修改升级原因" : "升级为本地草稿"}
        open={!!editing}
        onCancel={() => setEditing(undefined)}
        onOk={async () => {
          if (!reason.trim()) return message.warning("请输入升级原因");
          if (!editing.graph) return copy(editing, reason);
          try {
            await api("/settings/graph-drafts-" + kind + "-" + id, "PUT", {
              items: drafts.map((d: any) =>
                d.version === editing.version
                  ? { ...d, upgradeDesc: reason, modtime: Date.now() }
                  : d,
              ),
            });
            local.reload();
            setEditing(undefined);
            message.success("升级原因已保存");
          } catch (e: any) {
            message.error(e.message);
          }
        }}
      >
        <Input.TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="升级原因"
          maxLength={500}
        />
      </Modal>
      <Drawer
        open={!!preview}
        onClose={() => setPreview(undefined)}
        width="95vw"
        title={preview?.version}
        destroyOnHidden
      >
        {preview && (
          <SourceGraphView
            key={preview.version}
            id={id}
            archive={{
              graph: preview.graph,
              decisionTree: preview.graph.decisionTreeArchive,
            }}
            kind={kind}
            historical
          />
        )}
      </Drawer>
      <Modal
        width="90vw"
        title={"版本比较 " + (compare?.label || "")}
        open={open}
        footer={null}
        onCancel={() => setOpen(false)}
      >
        <Table<any>
          rowKey="path"
          dataSource={compare?.items || []}
          columns={[
            { title: "节点", dataIndex: "path" },
            { title: "变更类型", dataIndex: "state" },
            { title: "原节点", render: (_, r) => r.before?.name || "—" },
            { title: "新节点", render: (_, r) => r.after?.name || "—" },
            {
              title: "变更前",
              render: (_, r) =>
                r.before && (
                  <RawData value={r.before.config} title="查看前配置" />
                ),
            },
            {
              title: "变更后",
              render: (_, r) =>
                r.after && (
                  <RawData value={r.after.config} title="查看后配置" />
                ),
            },
          ]}
        />
      </Modal>
    </>
  );
}
export function GraphVersionDrawer({
  id,
  kind = "graph",
  open,
  onClose,
}: {
  id: number;
  kind?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data } = useRemote<any>("/source/archive/" + kind + "/" + id);
  return (
    <Drawer
      width="min(1400px,95vw)"
      open={open}
      onClose={onClose}
      title={"版本管理 " + id + " - " + (data?.graph?.name || "")}
    >
      {data && (
        <GraphVersions
          id={id}
          kind={kind}
          versions={data.versions || []}
          current={data.graph.version}
        />
      )}
    </Drawer>
  );
}
