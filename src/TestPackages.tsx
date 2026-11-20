import { testPackageExamples } from "./rule-test-examples";
import { useState } from "react";
import { Alert, App, Button, Form, Input, Modal, Radio, Space } from "antd";
import { api } from "./api";
export function TestPackages() {
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<"bag" | "picture">("bag"),
    [id, setId] = useState(""),
    [entries, setEntries] = useState(""),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  const path = "/rule-test-packages/" + kind + "/" + id;
  async function load(nextId = id) {
    try {
      setBusy(true);
      const r = await api("/rule-test-packages/" + kind + "/" + nextId);
      setEntries((r.entries || []).join("\n"));
      setLoaded(true);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    try {
      setBusy(true);
      const r = await api(path, "PUT", {
        entries: entries.split(/\r?\n/).filter(Boolean),
      });
      message.success("已保存 " + r.count + " 条测试数据");
      setOpen(false);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>本地测试包</Button>
      <Modal
        title="本地测试包"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText="保存"
        confirmLoading={busy}
        okButtonProps={{ disabled: !loaded }}
      >
        <Form layout="vertical">
          <Radio.Group
            disabled={busy}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setLoaded(false);
            }}
            options={[
              { label: "词包", value: "bag" },
              { label: "图包", value: "picture" },
            ]}
          />
          <Form.Item>
            <Space>
              <Button
                type="link"
                disabled={busy}
                onClick={() => {
                  const next = testPackageExamples[kind].id;
                  setId(next);
                  load(next);
                }}
              >
                打开{testPackageExamples[kind].label}
              </Button>
              {kind === "picture" && (
                <a
                  href={testPackageExamples.picture.entries[0]}
                  download="测试图.png"
                >
                  下载示例图片
                </a>
              )}
            </Space>
          </Form.Item>
          <Form.Item label="包 ID">
            <Space.Compact>
              <Input
                disabled={busy}
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setLoaded(false);
                }}
              />
              <Button
                disabled={!/^\d{1,16}$/.test(id)}
                loading={busy}
                onClick={() => load()}
              >
                读取
              </Button>
            </Space.Compact>
          </Form.Item>
          {loaded && (
            <>
              <Form.Item
                label={
                  kind === "bag"
                    ? "词条（每行一个）"
                    : "图片标识（每行一个 URL 或 SHA-256）"
                }
              >
                <Input.TextArea
                  rows={7}
                  value={entries}
                  onChange={(e) => setEntries(e.target.value)}
                />
              </Form.Item>
              {kind === "picture" && (
                <label>
                  从图片生成 SHA-256{" "}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={async (e) => {
                      try {
                        const files = Array.from(e.target.files || []);
                        const hashes = await Promise.all(
                          files.map(
                            async (f) =>
                              "sha256:" +
                              Array.from(
                                new Uint8Array(
                                  await crypto.subtle.digest(
                                    "SHA-256",
                                    await f.arrayBuffer(),
                                  ),
                                ),
                                (b) => b.toString(16).padStart(2, "0"),
                              ).join(""),
                          ),
                        );
                        setEntries((old) =>
                          [old, ...hashes].filter(Boolean).join("\n"),
                        );
                      } catch {
                        message.error("读取图片失败");
                      }
                    }}
                  />
                </label>
              )}
            </>
          )}
          <Alert
            type="info"
            message={
              kind === "bag"
                ? "按文本是否包含任一词条计算。条目保存在本地数据库。"
                : "按相同图片内容摘要或完整图片标识匹配。测试输入支持 SHA-256、图片 data URL 和已登记 URL。"
            }
          />
        </Form>
      </Modal>
    </>
  );
}
