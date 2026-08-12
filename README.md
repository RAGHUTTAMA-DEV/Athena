# 🏛️ Athena: Autonomous Multi-Tool AI Agent System

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Google Gemini](https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev/)
[![Langfuse](https://img.shields.io/badge/Langfuse-000000?style=for-the-badge&logo=langfuse&logoColor=white)](https://langfuse.com/)

**Athena** is a state-of-the-art, autonomous, multi-agent AI assistant framework built in TypeScript. Powered by **Google's Gemini 2.5 Flash**, Athena features persistent episodic SQLite memory, dynamic procedural skills, recursive sub-agent delegation, headless browser automation via Playwright, background cron scheduling, and end-to-end telemetry through Langfuse and OpenTelemetry.

---

## 🌟 Key Features & Capabilities

### 🤖 Core Autonomous Agent Loop
* **Multi-Turn Reasoning & Tool Calling**: Continuously plans, calls tools, processes feedback, and executes complex goals autonomously up to a configurable turn cap.
* **Persona & SOUL System**: Dynamically loads agent personality, tone, and core identity from [`SOUL.md`](file:///c:/Users/raghu/Documents/Athena/SOUL.md).
* **Human-in-the-Loop Safety**: Interactive confirmation prompts for high-impact tools (e.g., terminal execution, coding sub-agent tasks).

### 🌿 Sub-Agent Hierarchy & Delegation
* **Generic Task Sub-Agents (`delegate_task`)**: Spawns isolated child agent instances with strict **tool scoping**, task-specific context slicing, and **depth limiting** (strips delegation capability when depth ≥ 3 to prevent infinite recursion).
* **Coding Sub-Agent (`delegateCodingTask`)**: Spawns a dedicated CLI process harness for file modifications, code creation, refactoring, and test verification.
* **Parallel Execution**: Supports parent agents running multiple sub-agent tasks concurrently.

### 💾 Episodic & Procedural Memory
* **Episodic Memory (`state.db`)**: SQLite-backed persistent memory storing multi-session chat histories, session states, and tool outcomes.
* **Procedural Memory (Skills)**: Dynamically loads, reads, and creates reusable skills in the [`skills/`](file:///c:/Users/raghu/Documents/Athena/skills) directory via `skillManage`.
* **Memory Consolidation**: Periodically condenses historical interactions into structured long-term knowledge and user profiles using background LLM consolidation.

### ⏰ Background Scheduler & Cron Engine
* **Scheduled Tasks**: Create, list, execute, and cancel one-shot timers or recurring cron jobs (`cronjob` tool).
* **Background Worker**: Integrates directly with SQLite state to wake up and trigger agent actions automatically.

### 🌐 Headless Web Automation & Search
* **Playwright Browser Automation**: Full web navigation, clicking, typing, page extraction, and screenshot capturing with Chromium.
* **Interactive DOM Inspection**: Live page analysis and multi-turn web interaction via `interactiveBrowser`.
* **DuckDuckGo Web Search**: Fast, live web search retrieval (`searchWeb`).

### 🛠️ Comprehensive Built-in Toolset
| Tool | Description |
| :--- | :--- |
| `delegate_task` | Delegate generic tasks to an isolated sub-agent with scoped tools |
| `delegateCodingTask` | Spawn dedicated coding sub-agent process harness for repository tasks |
| `browser` / `interactiveBrowser` | Headless Chromium web browsing, navigation, and DOM manipulation |
| `searchWeb` | Web search powered by DuckDuckGo |
| `terminal` | Shell command execution in working directory |
| `filesystem` | File and directory operations (ls, mkdir, rm, read, write) |
| `readFile` | Utility tool to view raw file contents |
| `executePython` | Isolated Python code execution sandbox |
| `calculate` | Mathematical expression evaluation powered by Math.js logic |
| `cronjob` | Background timer and cron job manager |
| `skillManage` | Create, list, read, and edit dynamic procedural skill files |
| `semanticMemory` | Search and record long-term episodic and consolidated memory |
| `systemTime` | Query current system date and time |

### 📊 Observability & Telemetry
* **Langfuse & OpenTelemetry Tracing**: Deep observability tracking token usage, latency, tool call traces, and hierarchical parent-child agent spans ([`instrumentation.ts`](file:///c:/Users/raghu/Documents/Athena/src/core/instrumentation.ts)).
* **LLM-as-a-Judge Evaluation**: Built-in eval engine ([`eval.ts`](file:///c:/Users/raghu/Documents/Athena/src/core/eval.ts)) for measuring task accuracy and response quality.

### 💬 Multi-Channel Access Gateways
* **CLI Client**: Feature-rich terminal interface with ANSI colors, multi-session switching (`/session`), command execution history, and live tool confirmation prompts.
* **Telegram Bot Gateway**: Telegraf-based Telegram gateway allowing remote messaging and task delegation directly via Telegram chats.

---

## 🏗️ Architecture & Project Structure

```
Athena/
├── src/
│   ├── index.ts                   # CLI entrypoint & session controller
│   ├── core/
│   │   ├── agent.ts               # Main Agent class & tool execution loop
│   │   ├── memory.ts              # SQLite Episodic Memory store
│   │   ├── consolidation.ts       # Long-term Memory Summarizer & Consolidator
│   │   ├── procedural.ts          # Procedural Memory (Skills loader)
│   │   ├── scheduler.ts           # Background Cron & Timer Scheduler
│   │   ├── eval.ts                # LLM-as-a-judge Evaluation framework
│   │   ├── instrumentation.ts     # Langfuse / OpenTelemetry Tracing
│   │   └── types.ts               # Core TypeScript interface definitions
│   ├── gateway/
│   │   └── telegram.ts            # Telegram Bot Gateway (Telegraf)
│   ├── tools/                     # Agent Tool Registry
│   │   ├── index.ts               # Tools registry export
│   │   ├── delegateTask.ts        # Sub-agent generic task delegator
│   │   ├── delegateCodingTask.ts    # Coding process harness delegator
│   │   ├── browser.ts             # Playwright browser integration
│   │   ├── interactiveBrowser.ts  # DOM interaction & screenshot tool
│   │   ├── executePython.ts       # Python runner
│   │   ├── filesystem.ts          # File system manager
│   │   ├── terminal.ts            # Terminal runner
│   │   ├── cronjob.ts             # Scheduler tool
│   │   ├── skillManage.ts         # Skill management tool
│   │   ├── searchWeb.ts           # Web search tool
│   │   └── ...
│   └── prompts/
│       └── index.ts               # Default system prompt templates
├── skills/                        # Dynamic procedural skills (.md)
├── state.db                       # SQLite Database (Episodic memory & cron)
├── SOUL.md                        # Agent identity & behavioral guidelines
├── hermes-agent-build-plan.md    # Multi-phase system build design document
├── coding-subagent-integration.md # Coding sub-agent specification
└── package.json                   # Build scripts & dependencies
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: `v18.0.0` or higher
* **npm**: `v9.0.0` or higher
* **Python**: Optional (required only for `executePython` tool)
* **Google Gemini API Key**: [Get API Key from Google AI Studio](https://aistudio.google.com/)

### 1. Clone & Install Dependencies
```bash
git clone <repository-url>
cd Athena
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory:

```env
# Gemini API Key (Required)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# System Prompt Override (Optional)
# GEMINI_SYSTEM_PROMPT=...

# Database Storage Path (Optional)
DATABASE_PATH=./state.db

# Telegram Bot Token (Optional - Required for Telegram Gateway)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Langfuse Telemetry (Optional)
LANGFUSE_PUBLIC_KEY=your_langfuse_public_key
LANGFUSE_SECRET_KEY=your_langfuse_secret_key
LANGFUSE_HOST=https://cloud.langfuse.com
```

### 3. Build the Project
```bash
npm run build
```

---

## 💻 Usage & CLI Commands

### Start the CLI Client
Run the agent in interactive terminal mode:
```bash
npm run dev
# or after build:
npm start
```

### In-CLI Commands
| Command | Description |
| :--- | :--- |
| `exit` / `quit` | Exit the CLI session |
| `clear` | Clear conversation history for current session |
| `/session list` | List all stored sessions and activity status |
| `/session switch <id>` | Switch to a specific session ID |
| `/session new` | Create and switch to a newly generated session |
| `/session clear <id>` | Clear memory for a specific session |
| `/session help` | Display session command help |

### Start the Telegram Gateway
To run Athena as a Telegram Bot:
```bash
npm start -- --gateway telegram
```

---

## 🧪 Test Suite & Verification

Athena includes comprehensive test scripts for each core sub-system:

```bash
# Build & run full verification suite
npm run verify

# Test SQLite episodic memory storage & retrieval
npm run test:memory

# Test Sub-Agent delegation, tool scoping, & depth limits
npm run test:delegation

# Test LLM-as-a-judge evaluation harness
npm run test:eval

# Test OpenTelemetry & Langfuse tracing integration
npm run test:observability
```

---

## 🛠️ Advanced Concepts

### 1. Sub-Agent Depth & Safety Caps
Athena enforces strict safety limits when delegating tasks to sub-agents:
* **Tool Scoping**: Parent agents explicitly define `allowedTools` for sub-agents.
* **Depth Tracking**: Sub-agents receive an incremented `depth` counter (`childDepth = parentDepth + 1`).
* **Recursion Guard**: If `childDepth >= 3`, the system strips `delegate_task` from the sub-agent's allowed tool list to guarantee recursion termination.

### 2. Memory Architecture
* **Episodic**: Saved turn-by-turn in SQLite (`state.db`). Allows resuming sessions across application restarts.
* **Procedural**: Loaded dynamically from [`skills/`](file:///c:/Users/raghu/Documents/Athena/skills). Agents can update their own skills using `skillManage`.
* **Consolidation**: Background pipeline synthesizes detailed interaction logs into high-level memory summaries.

---

## 📄 License

Distributed under the ISC License. See `LICENSE` for details.
