# Astra Translate

> A lightweight, elegant, provider-neutral browser translator.

<p align="center">
  <img src="public/icons/icon128.png" alt="Astra Translate" width="96" />
</p>

## ✨ Features

- **Minimalist Design** — No clutter, focused on translation
- **Selection Translation** — Select text to translate with a floating icon + draggable popup
- **Context Menu** — Right-click to translate selected text
- **Full Page Translation** — Translate entire pages with real-time incremental updates
- **Provider Neutral** — Works with any OpenAI-compatible API (DeepSeek, OpenAI, Groq, etc.)
- **Dark Mode** — Follows system theme automatically
- **Multi-language UI** — Chinese / English

## 🚀 Quick Start

### Install

1. Download or clone this repository
2. Install dependencies and build:

```bash
npm install
npm run build
```

3. Open Chrome and go to `chrome://extensions/`
4. Enable "Developer mode"
5. Click "Load unpacked" and select the `dist` folder

### Configure

1. Click the extension icon → Open Settings
2. Choose a provider preset (e.g. DeepSeek) or customize
3. Enter your API Key
4. Click "Test Connection" — settings auto-save on success

## 📖 Usage

| Action | Description |
|--------|-------------|
| Select text | A translation icon appears — click to translate |
| Right-click menu | Select text → "Translate selection with Astra" |
| `Alt+T` | Keyboard shortcut to translate selection |
| Extension icon | Open popup for manual translation |
| Full page | Popup footer → "Translate Current Page" |

## 🛠 Tech Stack

- **TypeScript** + **React 18** (Popup / Options)
- **Vanilla DOM** (Content Script, zero dependencies)
- **Vite 5** build
- **Chrome Manifest V3**

## 📁 Project Structure

```
src/
├── background/     # Service Worker (message routing, API calls)
├── content/        # Content Script (selection, popup, page translation)
├── popup/          # Popup UI (React)
├── options/        # Settings UI (React)
├── shared/         # Shared modules (types, utils, i18n)
└── styles/         # Theme variables
```

## 📄 License

MIT License
