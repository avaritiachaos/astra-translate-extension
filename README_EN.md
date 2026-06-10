# Astra Translate

> A lightweight, provider-neutral browser translator for selection, manual, and full-page translation.

<p align="center">
  <img src="public/icons/icon128.png" alt="Astra Translate" width="96" />
</p>

## Features

- **Selection translation**: select text and translate it from the inline icon, context menu, or `Alt+T`.
- **Manual translation popup**: translate typed or pasted text from the extension popup.
- **Full-page translation**: translate visible page text and keep translating lazy-loaded content while staying on the same page.
- **Persistent translation cache**: repeated source text can be served locally without another API request when provider, model, prompt, and target language match.
- **Smarter page progress**: page translation reports real completed item counts with smaller batches for visible progress.
- **SPA navigation safety**: page translation stops when a single-page app navigates to a different route.
- **Floating ball**: quick page translation entry point with drag, size, opacity, and auto-recovery after page navigation.
- **Provider-neutral API support**: works with OpenAI-compatible providers such as DeepSeek and custom endpoints.
- **Dictionary mode**: short words and phrases can return concise dictionary-style explanations.
- **Privacy-first local settings**: API keys and translation cache are stored in `chrome.storage.local`.

## Quick Start

Install dependencies and build the extension:

```bash
npm install
npm run build
```

Load it in Chrome:

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist` folder.

## Configuration

1. Open the extension settings page.
2. Choose a provider preset, or configure a custom OpenAI-compatible endpoint.
3. Enter your API key.
4. Click **Test Connection**. A successful test saves the settings automatically.

## Usage

| Action | Result |
| --- | --- |
| Select text | Shows a translation icon near the selection |
| Right-click selected text | Opens the Astra context-menu translation action |
| `Alt+T` | Translates the current selection |
| Extension icon | Opens the manual translation popup |
| Floating ball | Starts full-page translation |
| Page translation restore | Restores original page text where tracked |

## Translation Cache

Astra uses a local exact-match cache before calling the provider. The cache key includes:

- translation mode
- provider, model, base URL, and endpoint
- target language
- resolved system prompt
- normalized source text
- dictionary context, when dictionary mode is used

This avoids stale or incorrect reuse when you change model, provider, prompt, target language, or dictionary context.

## Development

```bash
npm install
npm run build
```

Project layout:

```text
src/
  background/   Service worker, provider calls, translation cache
  content/      Selection bubble, floating ball, page translation
  options/      Settings UI
  popup/        Manual translation popup
  shared/       Types, prompts, storage, utilities, i18n
public/
  manifest.json Chrome extension manifest
```

## Release Build

Build the extension and package the `dist` folder as a zip file for upload to GitHub Releases or browser extension stores.

```bash
npm run build
```

## Privacy

- Text is sent only to the API provider you configure.
- API keys are stored in `chrome.storage.local`.
- Translation cache entries are stored locally in the browser profile.
- Password inputs, code blocks, scripts, and other unsafe page regions are skipped by the page translator.

## License

MIT License
