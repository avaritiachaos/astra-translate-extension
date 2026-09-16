# Astra Translate

[中文](README.md) · [日本語](README_JP.md)

<p align="center">
  <img src="public/icons/icon128.png" alt="Astra Translate" width="96" />
</p>

<p align="center">
  <b>A lightweight, elegant, provider-neutral browser translator</b><br/>
  Bring your own LLM API — translate more accurately, more cheaply, your way. No login, no subscription, no ads.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-6.0.2-7C5CFF" alt="version" />
  <img src="https://img.shields.io/badge/Manifest-V3-4F46E5" alt="manifest v3" />
  <img src="https://img.shields.io/badge/TypeScript-React_18-3178C6" alt="tech" />
  <img src="https://img.shields.io/badge/license-MIT-3FB950" alt="license" />
</p>

---

## Why Astra?

Most translation extensions push you to sign in, buy a membership, or limit
your usage — or they bury you in ads. Astra does the opposite: **it doesn't
hold you hostage; it just translates well.**

- 🔑 **Bring your own API** — connect Google Gemini (AI Studio), DeepSeek, and other LLMs; pay per use or utilize free tiers
- 🚫 **No login / no subscription / no ads** — install, paste a key, go
- 💸 **Local cache reuse** — cache hits reuse results without another model call; older entries are evicted as needed
- 🎨 **Adjustable translation style** — make the model translate in the tone you like
- 🔒 **Privacy-first** — your API key stays in local storage; isolated per-provider storage

---

## ✨ Features

### Multiple ways to translate
- **Selection translation** — select text, get a floating ball, click to translate; the popup is draggable
- **Context-menu translation** — right-click selected text to translate
- **Keyboard shortcut** — `Alt+T` translates the current selection
- **Full-page translation** — translate the whole page in one click; interrupt and restore anytime
- **Manual translation** — open the popup and paste any text

### Immersive Manga & Comic AI Translation (v6.0 Flagship Feature)

Brand-new in v6.0, Astra introduces an end-to-end visual AI translation system for manga, comics, and webtoons. Right-click any manga image, press `Alt+M` for freeform selection, or open the immersive manga toolbar on reader sites:

- **Smart Frame Detection & Two-Page Spreads** — Intelligently handles single pages, two-page double spreads, and vertical webtoons, slicing and filtering out external banner ads for a seamless reading experience.
- **Auto Continuous Reading Mode** — As you turn pages or scroll down, Astra automatically detects and translates upcoming or viewport-entering pages in the background without repetitive manual clicking.
- **High-Concurrency Multi-Thread Prefetch Pipeline** — Background prefetching for **1 to 5 pages** ahead (default: 2 pages, adjustable across 1–6 concurrent threads). Translations are ready in advance, giving you instant, zero-wait reading when turning pages.
- **Reader Hub Modal (⚙ Adjust)** — Click "⚙ Adjust" on the toolbar to pop up a dark frosted-glass control card:
  - Header embedded with `[ A- ] [ 100% ] [ A+ ]` fine UI scaling and close buttons;
  - Quick prefetch depth selector `[ 1 Page ] [ 2 Pages (Recommended) ] [ 3 Pages (Fast) ]` with real-time status monitoring;
  - Essential reading actions: `[ 👁 Original Compare ]`, `[ ✂ Selection Alt+M ]`, `[ ↺ Re-translate ]`, `[ ≡ Compare All ]`;
  - `[ ⇋ Dock Toggle ]`: Seamlessly switch between bottom horizontal floating island and side vertical bar to avoid obstructing panels;
  - `[ 💊 Minimize to Edge Capsule ]`: Collapse into a compact edge capsule (`⚡ Auto · 2P`) during focused reading to free up maximum screen real estate.
- **Stepless UI Scaling (0.75x ~ 1.6x)** — Permanent `[ 100% ]` button on the toolbar cycles through `100% → 120% → 140% → 85%`, solving tiny buttons/fonts on 2K/4K high-DPI displays with persistent memory.
- **Adaptive Typesetting & Bubble Collapse** — Automatically adapts between horizontal and vertical text layouts based on balloon shapes; complex backgrounds or long texts generate collapsible cards with hover previews for source vs. multiple translation comparisons.

[Manga Translation Setup Guide (Chinese)](docs/manga-translation.md) · [Architecture Document](docs/manga-translation-architecture.md)

### Live Subtitles HUD (Speech Simultaneous Interpretation)
Switch to the "Simul" tab in the popup to transcribe audio via the Web Speech API and stream real-time bilingual translations.
- **Floating Subtitle HUD** — Translucent draggable subtitle window floating over web pages, ideal for foreign-language streams, raw video watching, or conference talks.
- **Real-Time Streaming** — Speech turns to text as it's spoken, auto-scrolling with dual source/target subtitle views.
- **Export & Copy** — One-click session copying; automatically clears on browser close for privacy.


### Smart & automatic (on by default)
- **Smart target language** — English selection → Chinese, Chinese selection → English; no manual direction switching
- **Same-language purity check** — automatically avoids pointless "same-language" translations and wasted tokens
- **Soft / hard content protection** — URLs, emails, paths, code, and hashes are detected and skipped; usernames / IDs are kept intact; password fields and code blocks are never translated
- **Persistent cache** — built-in SHA-256 dedup cache (5000 entries and a 4 MiB budget, LRU); cache hits need no additional model call
- **Real-time incremental translation** — full-page mode keeps up with dynamically loaded and lazy-loaded content

### Dictionary mode
Selecting a word or short phrase returns not just a translation but its **part
of speech, common meanings, context-specific explanation, examples, and
pronunciation** — and it recognizes names / IDs and leaves them unchanged.
Great for looking up words and reading foreign articles.

### In-page AI chat & instant model switching
Select text and click 💬, or right-click the floating ball and pick "Ask AI about this page" — the chat panel opens **inside the web page**, so you never get pulled away from what you were reading. Drag it, resize it, `Esc` to close.

- **Instant foreground model switcher** — click the model capsule in the chat action bar to switch active provider and model (Gemini 3.7 Flash, DeepSeek V4, etc.) without leaving your conversation
- **Native reasoning effort** — supports provider-specific thinking levels (Gemini: `off / low / medium / high`, DeepSeek: `off / high / max`)
- **Reads the page for you** — opening chat extracts the article automatically (scored by content density, skipping nav / header / footer / sidebar) and shows it as a removable context chip. Click ✕ to drop it, or turn the whole behaviour off in Settings
- **Regenerate** — didn't like the answer? Hit ↻ instead of retyping the question
- **Web supplement** — optional: search first, answer from the results, cite the sources
- **Isolated conversations** — the popup keeps a private conversation; each page document has its own history, so a website does not receive chat from other pages or the popup
- **Session and image storage** — text history lives in the browser session. Images use a bounded local cache; clearing chat removes its images, and startup cleanup removes expired or unreferenced files

### Highly customizable
- **Three independent target languages** — set separate languages for full-page, selection, and default translation
- **Custom prompts (style)** — both selection and page prompts are editable for any tone: formal, idiomatic, playful, academic
- **Tune the UI** — floating ball size / opacity, popup scale, concurrency, batch size, timeout, and temperature

### Provider-neutral with isolated storage
Built-in official presets for **Google Gemini (AI Studio)** (with `gemini-3.7-flash` free tier support) and **DeepSeek**, as well as any **OpenAI-compatible** API (OpenAI, Groq, local models, etc.). Configuration and API keys are **completely isolated per provider**.

### Experience details
- **iOS 18 Liquid Glass design** — frosted glassmorphism with high-saturation refraction (`backdrop-filter: blur(28px)`), specular highlight reflections, iOS segmented tab controls, and Dynamic Island top floating notification capsules
- **Trilingual UI** — 简体中文 / English / 日本語
- **Automatic dark mode** — follows the system theme
- **Auto-save settings** — changes persist immediately; a successful connection test saves automatically
- **20 target languages** — Chinese, English, Japanese, Korean, French, German, Spanish, Russian, Arabic, and more

---

## 📸 Preview

<p align="center">
  <img src="docs/screenshots/demo.gif" width="96%" alt="Astra Translate Live Demo" />
</p>

<p align="center">
  <img src="docs/screenshots/popup_chat.png" width="48%" alt="iOS 18 Liquid Glass Popup & Gemini 3.7 Chat" />
  <img src="docs/screenshots/inpage_chat.png" width="48%" alt="In-Page AI Companion Chat & Context Extraction" />
</p>

<p align="center">
  <img src="docs/screenshots/selection_dict.png" width="80%" alt="Selection Translation & Dictionary Mode" />
</p>

---

## 🚀 Quick Start

### Option 1: Use the packaged build (recommended for most users)

1. Download the provided package and **unzip** it (you'll get an extension folder containing `manifest.json`)
2. Open the extensions page: `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the unzipped extension folder

> ⚠️ Browsers cannot load a `.zip` directly — always unzip first, then load the folder.

### Option 2: Build from source (developers)

```bash
npm install
npm run build
```

The build output is in `dist/`. Load the `dist` folder following steps 2–4 above.

### Configuration

1. Click the extension icon → **Open Settings** ⚙️
2. Choose **Google Gemini (AI Studio)**, **DeepSeek**, or a custom OpenAI-compatible endpoint
3. Enter your **API Key**:
   - Google Gemini: Get one for free at <https://aistudio.google.com/apikey>
   - DeepSeek: Create one at <https://platform.deepseek.com>
4. Click **Test Connection** — saves automatically on success with isolated storage per provider

---

## 📖 Usage

| Action | Result |
|--------|--------|
| Select text | A floating ball appears — click to translate |
| Right-click selection | "Translate selection with Astra" |
| `Alt+T` | Translate the current selection |
| Extension icon | Open the popup to type / paste and translate |
| Switch model | Click the model pill in popup/in-page chat bar anytime |
| Full-page translation | Popup → "Translate Current Page"; "Restore" brings back the original |
| Look up a word | Select a word; the popup shows part of speech / meanings / examples / pronunciation |
| Manga translation | Right-click image to translate, or `Alt+M` for free selection |
| Manga auto prefetch | Turn on "Auto Continuous" on the toolbar for zero-wait page turning |
| Reader Hub & Capsule | Click "⚙ Adjust" for the full control hub; "💊" to collapse to an edge capsule |
| Manga Scale & Orientation | Click "100%" to cycle UI scaling; click "⇋" to switch horizontal/vertical dock |
| Live Subtitles | Popup → "Simul" tab to launch the floating bilingual subtitle HUD |

---

## ⚙️ Settings Reference

| Group | Setting | Default | Notes |
|-------|---------|---------|-------|
| Provider | Preset / Base URL / Endpoint / Model / API Key | DeepSeek · `deepseek-v4-flash` / Gemini · `gemini-3.7-flash` | Isolated per preset |
| Provider | Disable thinking | On | Speeds up / saves cost on thinking-capable models |
| Search | Serper API Key | Empty | Web search supplement with connection test & visibility toggle |
| Translation | Default / Page / Selection target language | Simplified Chinese | Three independent settings |
| Translation | Temperature | 0.2 | Lower is more stable |
| Translation | Smart target language | On | Auto-detects direction |
| Translation | Secondary target / smart max chars | English / 40 | Reverse translation for short text |
| Translation | Same-language → secondary / min purity | On / 0.82 | Avoids same-language translation |
| Translation | Dictionary mode | On | Shows POS / meanings / examples for short words |
| Translation | Timeout / batch size / concurrency | 30s / 4000 / 2 | Full-page performance tuning |
| Translation | Real-time translation | On | Keeps up with dynamic / lazy content |
| Manga | Vision Model / Target Language | Custom / Simplified Chinese | Independent vision model configuration |
| Manga | Default Auto Continuous Reading | On | Automatically triggers translation on page turn or scroll |
| Manga | Default Prefetch Pages | On | Pre-translates upcoming pages in background before turning |
| Manga | Prefetch Depth | 2 pages | Number of pages to pre-fetch (adjustable 1–5 pages) |
| Manga | Concurrency Threads | 2 | Pipeline concurrent threads (adjustable 1–6 threads) |
| Manga | Toolbar Orientation / UI Scale | Horizontal / 100% | Supports side vertical bar & persistent 0.75x–1.6x scale |
| Floating ball | Enable / size / opacity | On / 48px / 80% | |
| Floating ball | Popup scale | 100% | 80%–180% |
| Prompts | Selection / page prompt | Built-in defaults | Customize style; supports the `{{targetLang}}` placeholder |

> The translation cache is a built-in capability, on by default (~5000 entries, LRU). No configuration needed.

---

## 🔒 Privacy

- Text is sent only to the API provider **you** configure
- The extension collects, stores, and transmits no user data
- API keys are stored in `chrome.storage.local` and never sent to third parties
- Password inputs and code blocks are never translated

---

## 🛠 Tech Stack

- **TypeScript** + **React 18** (popup / options)
- **Vanilla DOM** content script (zero runtime deps — small and fast to inject)
- **Vite 5** build
- **Chrome Manifest V3**

---

## 📁 Project Structure

```
src/
├── background/     # Service worker (message routing, API calls, translation cache)
├── content/        # Content script (selection bubble, floating ball, popup, page translation)
├── popup/          # Popup UI (React)
├── options/        # Settings UI (React)
├── shared/         # Shared modules (types, i18n, prompts, language detection, storage)
└── styles/         # Theme variables
```

---

## 🗺 Roadmap

- [x] Google Gemini (AI Studio) preset & native reasoning efforts
- [x] Translation history & recovery
- [x] iOS 18 Liquid Glass design language
- [x] Manga image translation (Auto Continuous reading, multi-thread prefetch pipeline, Reader Hub modal, horizontal/vertical docks, and 2K/4K UI scaling)
- [x] Live subtitles & in-page floating subtitle HUD
- [ ] More provider presets
- [ ] Translation favorites

---

## 📄 License

[MIT](LICENSE) License — free to use, modify, and distribute; just keep the copyright notice.
