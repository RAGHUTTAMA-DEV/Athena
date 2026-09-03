# Phase 0 Implementation Learnings

This document summarizes the technical learnings and design decisions gathered while implementing the Phase 0 (Foundation) core agent loop.

## 1. Modern TypeScript & ESM Integration in Node
- **Module Resolution:** Using Node ES Modules (`"type": "module"` in `package.json` and `"module": "NodeNext"` in `tsconfig.json`) is the standard path forward for modern Node projects.
- **Import Paths:** When using ESM, TypeScript requires relative imports to explicitly include the `.js` extension (e.g., `import { Tool } from './types.js'`), even though the source files are `.ts`.
- **runner:** The CLI can be run dynamically using `ts-node-esm` or compiled first using `tsc` and executed via `node`.

## 2. Gemini Gen AI SDK & Tool Calling
- **API Client:** We utilized the modern `@google/genai` SDK, which uses the `GoogleGenAI` class and `ai.models.generateContent` method.
- **Function Declarations:** Tools are declared as schemas inside the `config.tools` array using the `functionDeclarations` parameter:
  ```json
  "tools": [{ "functionDeclarations": [...] }]
  ```
- **Type Guarding:** SDK types for function execution responses are strict. Since `call.name` is typed as optional (`string | undefined`), we added structured checks (`if (!call.name) continue;`) to narrow types and avoid compilation issues.

## 3. Ephemeral Memory Construction
- **Soul/Persona Separation:** Standardizing persona/roleplay configs in a markdown file (`SOUL.md`) rather than hardcoding prompts allows dynamic updates.
- **Context Generation:** The agent's working memory is re-created dynamically at each run by reading `SOUL.md`, prefixing system operational parameters, and combining user messages with the session history.

## 4. Run Loop & Guardrail Enforcement
- **Loop State:** Function calls require sequential messages:
  1. User message requesting action.
  2. Model response containing tool calls (`functionCall` parts).
  3. User message containing tool execution outputs (`functionResponse` parts).
- **Infinite Loop Prevention:** Implementing a max-turn check (`maxTurns` check inside the `while` loop) is critical. If the model loops repeatedly or a tool errors recursively, the execution exits with a warning instead of consuming excessive API tokens.

---

# Phase 1 Implementation Learnings

This document summarizes the technical learnings and design decisions gathered while implementing the Phase 1 (Real Tools & Gateway) architecture.

## 1. Asynchronous Gateway & Webhook/Polling Loops
- **Middleware Non-Blocking Pattern:** Telegraf's polling loop waits for the update middleware chain's promise to resolve before sending the next `/getUpdates` call. If an interactive confirmation blocks the text update handler, the polling loop deadlocks and subsequent callback queries cannot be fetched. We resolved this by launching the agent run flow asynchronously inside a non-blocking helper, freeing the polling loop immediately.
- **Telegraf Keyboard Construction:** Spreading keyboard layouts using `{ ...keyboard }` in Telegraf v4 destroys class getters like `.reply_markup`. You must explicitly pass `reply_markup: keyboard.reply_markup` inside the message extra options.
- **Update Confirmation Routing:** Polling conflicts (e.g. running multiple node processes using the same token) will cause update theft where button callback queries route to the wrong process. Terminating conflicting processes using `Stop-Process -Name node -Force` ensures single-instance routing.

## 2. Dynamic Web Scraping & Parsers
- **Robust Regex for HTML Attribute Ordering:** Scraping pages like DuckDuckGo HTML using strict regexes will fail when the engine randomizes or inserts other attributes (like `rel="nofollow"`) before target attributes (like `class` or `href`). Using general header matches like `/<h2 class="result__title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g` ensures bulletproof parsing.
- **Temporal Anchoring:** Models with cut-off dates cannot evaluate relative terms like "this season" or "previous season" correctly if they lack real-time date context. Dynamically injecting an unambiguous long-form system date (e.g. `Monday, August 3, 2026`) anchors the LLM and enables accurate temporal reasoning.
- **Search Fallback Strategy:** Having a dedicated, lightweight HTML-based scraping search tool (like DuckDuckGo HTML) is much cleaner and more reliable for local agents than forcing them to write ad-hoc curl scripts or python parsers on the fly.

