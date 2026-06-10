# Astra Translate

[English](README_EN.md) · [日本語](README_JP.md)

> 轻量、优雅、模型服务商中立的浏览器翻译扩展。

<p align="center">
  <img src="public/icons/icon128.png" alt="Astra Translate" width="96" />
</p>

## ✨ 特性

- **极简设计** — 无冗余 UI，专注翻译本身
- **划词翻译** — 选中文字即可翻译，悬浮球 + 可拖拽弹窗
- **右键翻译** — 右键菜单一键翻译选中文本
- **全页翻译** — 一键翻译整个页面，支持实时增量翻译，随时可中断
- **服务商中立** — 支持任何 OpenAI-compatible API（DeepSeek、OpenAI、Groq 等）
- **暗色模式** — 自动跟随系统主题
- **多语言界面** — 支持中文 / English / 日本語
- **隐私优先** — API Key 本地存储，不收集任何数据

## 🚀 快速开始

### 安装

```bash
npm install
npm run build
```

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `dist` 文件夹

### 配置

1. 点击扩展图标 → 设置
2. 选择服务商预设（如 DeepSeek）或自定义
3. 填入 API Key
4. 点击「测试连接」— 成功后自动保存

## 📖 使用

| 操作 | 说明 |
|------|------|
| 选中文字 | 出现翻译图标，点击翻译 |
| 右键菜单 | 选中 → 「Translate selection with Astra」 |
| `Alt+T` | 快捷键翻译选中文本 |
| 扩展图标 | 打开弹窗手动输入翻译 |
| 全页翻译 | 弹窗底部 → 「翻译当前页面」 |

## 🛠 技术栈

- **TypeScript** + **React 18**（Popup / Options）
- **Vanilla DOM**（Content Script，零依赖）
- **Vite 5** 构建
- **Chrome Manifest V3**

## 📁 项目结构

```
src/
├── background/     # Service Worker（消息路由、API 调用）
├── content/        # Content Script（划词、弹窗、全页翻译）
├── popup/          # 弹窗 UI（React）
├── options/        # 设置页 UI（React）
├── shared/         # 共享模块（类型、工具、i18n）
└── styles/         # 主题变量
```

## 🔒 隐私

- 翻译文本仅发送到你配置的 API 服务商
- 扩展不收集、存储或传输任何用户数据
- API Key 存储在 `chrome.storage.local`，不会发送给第三方
- 密码输入框和代码块不参与翻译

## 📄 许可证

MIT License
