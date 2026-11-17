import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { ConfigProvider, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#3869e8",
          borderRadius: 4,
          fontSize: 14,
          controlHeight: 32,
          colorText: "#41464d",
          colorBorder: "#dcdfe6",
        },
        components: {
          Table: {
            headerBg: "#f5f5f5",
            headerColor: "#60656d",
            cellPaddingBlock: 14,
            cellPaddingInline: 16,
          },
          Tabs: { horizontalItemGutter: 26 },
        },
      }}
    >
      <AntApp>
        <HashRouter>
          <App />
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
