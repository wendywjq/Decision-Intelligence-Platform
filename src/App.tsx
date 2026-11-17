import { useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  App as AntApp,
  Avatar,
  Badge,
  Button,
  Drawer,
  Dropdown,
  Input,
  Select,
  Space,
  Switch,
  Tooltip,
} from "antd";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BellOutlined,
  CheckSquareOutlined,
  DownOutlined,
  FileTextOutlined,
  FundOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  QuestionCircleOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { groups, moduleMap } from "./catalog";
import { ModulePage } from "./ModulePage";
import { RuleDetail } from "./RuleDetail";
const icons: Record<string, React.ReactNode> = {
  deploy: <ApartmentOutlined />,
  manage: <FileTextOutlined />,
  risk: <SearchOutlined />,
  permission: <LockOutlined />,
  safe: <SafetyCertificateOutlined />,
  monitor: <FundOutlined />,
  setting: <SettingOutlined />,
  tool: <AppstoreOutlined />,
  change: <CheckSquareOutlined />,
};
export default function App() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [open, setOpen] = useState(["策略部署", "策略管理", "策略变更"]);
  const [collapsed, setCollapsed] = useState(false);
  const [env, setEnv] = useState("Prod");
  const [space, setSpace] = useState("35-内容安全");
  const [assistant, setAssistant] = useState(false);
  const [notice, setNotice] = useState(false);
  const [ai, setAi] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <img className="zeus-brand-image" src="/zeus-logo.png" alt="Zeus" />
          <span>智能决策平台</span>
        </div>
        <Dropdown
          menu={{
            items: ["Prod", "Staging", "Test"].map((key) => ({
              key,
              label: key,
            })),
            onClick: ({ key }) => setEnv(key),
          }}
        >
          <Button className="environment" size="small">
            {env}
            <DownOutlined />
          </Button>
        </Dropdown>
        <Dropdown
          menu={{
            items: ["35-内容安全", "46-示例业务"].map((key) => ({
              key,
              label: key,
            })),
            onClick: ({ key }) => setSpace(key),
          }}
        >
          <button className="top-link space-picker">
            <UserOutlined /> {space} <DownOutlined />
          </button>
        </Dropdown>
        <div className="top-right">
          <span>AI 工作台</span>
          <Switch
            size="small"
            checked={ai}
            onChange={(v) => {
              setAi(v);
              setAssistant(v);
            }}
          />
          <sup className="recommend">推荐</sup>
          <button
            className="top-link"
            aria-label="通知"
            onClick={() => setNotice(true)}
          >
            <Badge dot>
              <BellOutlined />
            </Badge>
          </button>
          <Tooltip title="查看本地复刻范围与操作说明">
            <button className="top-link" onClick={() => navigate("/help")}>
              帮助
            </button>
          </Tooltip>
          <button
            className="top-link"
            onClick={() => message.info("请在仓库 Issues 中提交反馈")}
          >
            反馈
          </button>
          <Dropdown
            menu={{
              items: [
                { key: "profile", label: "demo · 示例管理员" },
                { key: "about", label: "本地演示环境" },
              ],
              onClick: () => message.info("当前使用本地示例用户 demo"),
            }}
          >
            <Avatar size={25} icon={<UserOutlined />} />
          </Dropdown>
        </div>
      </header>
      <aside className={"sidebar " + (collapsed ? "collapsed" : "")}>
        <div className="sidebar-title">{collapsed ? "Z" : "Zeus"}</div>
        <nav aria-label="主导航">
          {groups.map((g) => (
            <section key={g.name}>
              <button
                className="nav-group"
                title={g.name}
                onClick={() =>
                  setOpen((v) =>
                    v.includes(g.name)
                      ? v.filter((x) => x !== g.name)
                      : [...v, g.name],
                  )
                }
              >
                {icons[g.icon]}
                {!collapsed && (
                  <>
                    <span>{g.name}</span>
                    <DownOutlined
                      className={open.includes(g.name) ? "rotate" : ""}
                    />
                  </>
                )}
              </button>
              {!collapsed && open.includes(g.name) && (
                <div className="nav-items">
                  {g.keys.map((key) => (
                    <a
                      href={"#/" + key}
                      key={key}
                      className={pathname === "/" + key ? "selected" : ""}
                    >
                      {moduleMap[key].label}
                    </a>
                  ))}
                </div>
              )}
            </section>
          ))}
        </nav>
        <button
          className="collapse-button"
          aria-label="收起导航"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        </button>
      </aside>
      <main className={collapsed ? "main main-collapsed" : "main"}>
        <Routes>
          <Route path="/" element={<Navigate to="/scene" replace />} />
          <Route
            path="/releaseList"
            element={<Navigate to="/release/list" replace />}
          />
          <Route path="/ruleDetails" element={<RuleDetail />} />
          <Route
            path="/help"
            element={
              <div className="help">
                <h1>智能决策平台 · 使用说明</h1>
                <p>本项目使用示例业务数据，独立运行，不连接 Zeus 生产系统。</p>
                <p>
                  场景：点击名称展开规则配置；可添加规则、修改状态和决策。规则：点击名称进入详情，编辑表达式后添加
                  JSON 测试用例。
                </p>
                <p>
                  分层场景和画布：打开详情进行节点编排并保存。变更管理：按实验、审批、灰度顺序操作本地示例任务。
                </p>
                <p>
                  SQLite 数据由 API
                  服务存储；刷新页面后保留。完整复刻进度与限制见仓库
                  docs/coverage.md。
                </p>
              </div>
            }
          />
          {Object.values(moduleMap).map((m) => (
            <Route
              key={m.key}
              path={"/" + m.key}
              element={<ModulePage key={m.key} module={m} />}
            />
          ))}
          <Route
            path="*"
            element={
              <div className="help">
                <h1>页面不存在</h1>
                <Button onClick={() => navigate("/scene")}>返回场景列表</Button>
              </div>
            }
          />
        </Routes>
      </main>
      <button className="assistant-handle" onClick={() => setAssistant(true)}>
        <RobotOutlined />
        <span>
          智<br />能<br />助<br />手
        </span>
        ‹
      </button>
      <Drawer
        title="智能助手"
        open={assistant}
        onClose={() => setAssistant(false)}
        width={420}
      >
        <p>可查看本地示例功能的使用说明。</p>
        <Select
          style={{ width: "100%", marginBottom: 16 }}
          placeholder="选择操作指引"
          options={["如何新建场景", "如何测试规则", "如何保存画布"].map(
            (value) => ({ value, label: value }),
          )}
          onChange={(v) => {
            setPrompt(v);
            setAnswer(
              v.includes("场景")
                ? "进入场景，点击新建场景，填写名称、负责人和标签后提交。"
                : v.includes("规则")
                  ? "打开规则详情，点击添加测试用例，输入JSON对象并选择期望输出。"
                  : "进入分层场景或画布，打开示例详情，添加并连接节点后点击保存。",
            );
          }}
        />
        <Input.TextArea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
        />
        <Button
          style={{ marginTop: 12 }}
          onClick={() =>
            setAnswer(
              "当前演示环境提供操作指引，尚未接入语言模型。请选择上方操作指引。",
            )
          }
        >
          查看指引
        </Button>
        <p>{answer}</p>
      </Drawer>
      <Drawer title="通知中心" open={notice} onClose={() => setNotice(false)}>
        <p>暂无新通知</p>
        <p className="muted">当前为本地演示环境。</p>
      </Drawer>
    </>
  );
}
