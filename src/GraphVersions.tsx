import { useState } from "react";
import {
  Alert,
  App,
  Button,
  Drawer,
  Input,
  Modal,
  Space,
  Table,
  Tag,
} from "antd";
import { Link } from "react-router-dom";
import { api } from "./api";
import { useRemote } from "./components";
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
    [open, setOpen] = useState(false);
  const { message } = App.useApp();
  const local = useRemote<any>("/settings/graph-drafts-" + kind + "-" + id);
  const drafts = local.data?.items || [];
  async function copy(r: any) {
    try {
      const graph = await api("/source/graph/" + id + "/version/" + r.version);
      const next = {
        version: "本地草稿-" + (drafts.length + 1),
        sourceVersion: r.version,
        status: -1,
        modifier: "local",
        modtime: Date.now(),
        upgradeDesc: "从 V" + r.version + " 复制",
        graph,
      };
      await api("/settings/graph-drafts-" + kind + "-" + id, "PUT", {
        items: [next, ...drafts],
      });
      local.reload();
      message.success("草稿已保存，可查看和比较");
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
        dataSource={rows}
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
                  ? "生效"
                  : r.status === -1
                    ? "编辑中"
                    : "历史版本"}
              </Tag>
            ),
          },
          { title: "升级说明", dataIndex: "upgradeDesc" },
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
                  <RawData value={r.graph} title="查看草稿" />
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
                    <Button type="link" onClick={() => copy(r)}>
                      复制为草稿
                    </Button>
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
