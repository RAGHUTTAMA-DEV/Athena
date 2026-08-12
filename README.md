# 🏛️ Athena: Autonomous Multi-Tool AI Agent System

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue?style=for-the-badge&logo=probot)](https://modelcontextprotocol.io/)
[![Langfuse](https://img.shields.io/badge/Langfuse-000000?style=for-the-badge&logo=langfuse&logoColor=white)](https://langfuse.com/)

**Athena** is a state-of-the-art, autonomous, multi-agent AI assistant framework built in TypeScript. Athena is a **local-first AI agent** with direct access to your local machine (terminal, filesystem, browser, Python execution), persistent SQLite episodic memory, dynamic procedural skill learning ("grows with you"), recursive sub-agent delegation, headless browser automation via Playwright, background cron scheduling, and end-to-end telemetry through Langfuse and OpenTelemetry.

---

## 💡 Core Philosophy

### 💻 1. Local Machine Access & Native Integration
Athena operates directly on your local system, giving it hands-on execution capabilities:
* **Local Terminal Execution**: Runs shell commands, scripts, git workflows, and system commands via the `terminal` tool.
* **Direct Filesystem Management**: Inspects, reads, writes, and refactors workspace directories and files locally via `filesystem`, `readFile`, and `delegateCodingTask`.
* **Local Python Sandbox**: Runs Python code locally for data processing, calculations, and automation (`executePython`).
* **Local Browser Automation**: Controls a local headless Chromium browser using Playwright to inspect websites, extract dynamic DOM elements, and capture screenshots (`browser`, `interactiveBrowser`).

### 🌱 2. Self-Evolving Intelligence ("Grows With You")
Athena isn't stateless—it learns your environment, adapts to your workflows, and gets smarter over time:
* **Procedural Skill Learning (`skills/`)**: When Athena discovers a new workflow or solution, it creates and stores reusable skill guides using `skillManage`. Future runs automatically load and build upon these learned skills.
* **Episodic & Long-Term Memory**: All interactions, past decisions, tool results, and session contexts are stored persistently in SQLite (`state.db`).
* **Continuous Memory Consolidation**: A background LLM consolidation pipeline periodically analyzes past sessions to extract long-term user preferences, project insights, and coding style, allowing Athena to grow into a personalized AI assistant tailored specifically to you.

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

### 💾 Episodic & Procedural Memory ("Self-Learning")
* **Episodic Memory (`state.db`)**: SQLite-backed persistent memory storing multi-session chat histories, session states, and tool outcomes.
* **Procedural Memory (Skills)**: Dynamically loads, reads, and creates reusable skills in the [`skills/`](file:///c:/Users/raghu/Documents/Athena/skills) directory via `skillManage`.
* **Memory Consolidation**: Periodically condenses historical interactions into structured long-term knowledge and user profiles using background LLM consolidation.

### ⏰ Background Scheduler & Cron Engine
* **Scheduled Tasks**: Create, list, execute, and cancel one-shot timers or recurring cron jobs (`cronjob` tool).
* **Background Worker**: Integrates directly with SQLite state to wake up and trigger agent actions automatically.

### 🔌 Model Context Protocol (MCP) Integration
* **Plug-and-Play MCP Servers**: Dynamically initializes and connects to external MCP tool servers via `stdio`, `sse`, `http`, or `streamable-http` transports.
* **Automatic Dynamic Tool Registration**: Discovers exposed tools from configured MCP servers (`client.listTools()`) and registers them dynamically with server namespacing (e.g. `[MCP: filesystem]`).
* **Gemini Schema Sanitization**: Built-in schema cleaner (`cleanGeminiSchema`) converts complex JSON schemas into 100% Gemini-compliant function declarations.

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

### 📐 System Architecture

![Athena Architecture Diagram](assets/athena_architecture.png)

### 📂 Directory & File Structure

```
Athena/
├── src/
│   ├── index.ts                   # CLI entrypoint, session controller & MCP loader
│   ├── core/
│   │   ├── agent.ts               # Main Agent class & tool execution loop
│   │   ├── mcpManager.ts          # MCP client transport & Gemini schema bridge
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
├── mcp_servers.json               # MCP server declarations (stdio, SSE, HTTP)
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

## 🔌 Model Context Protocol (MCP) Setup & Configuration

Athena includes full native support for Anthropic's **Model Context Protocol (MCP)**, enabling you to seamlessly connect external tool servers (e.g. Filesystem, Gmail, Notion, Slack, GitHub, PostgreSQL, Brave Search) into Athena's autonomous tool loop without writing custom code.

### 1. Configuration File (`mcp_servers.json`)
Athena automatically scans for [`mcp_servers.json`](file:///c:/Users/raghu/Documents/Athena/mcp_servers.json) in the root directory upon startup. If present, it initializes connections to all declared servers.

Create or update `mcp_servers.json` in your project root:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:\\Users\\yourname\\Documents"
      ]
    },
    "gmail": {
      "command": "npx",
      "args": [
        "-y",
        "@gongrzhe/server-gmail-autoauth-mcp"
      ]
    },
    "notion": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.notion.com/sse"
      ]
    }
  }
}
```

### 2. Supported Transport Modes

Athena's [`MCPManager`](file:///c:/Users/raghu/Documents/Athena/src/core/mcpManager.ts) supports four transport modes:

| Transport Type | Trigger / Field | Description |
| :--- | :--- | :--- |
| **`stdio`** *(Default)* | `"command": "..."` | Launches a local subprocess (`npx`, `node`, `python`, `uvx`, etc.) and communicates over standard input/output streams. |
| **`sse`** | `"type": "sse"` or `"url": "..."` | Connects to remote HTTP Server-Sent Events (SSE) server endpoints. |
| **`streamable-http`** | `"type": "streamable-http"` | Connects via streaming HTTP transport. |
| **`http`** | `"type": "http"` | Standard HTTP request/response transport. |

### 3. Server Configuration Options

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `command` | `string` | For `stdio` | The command or binary to run (e.g., `npx`, `node`, `python`, `uvx`). |
| `args` | `string[]` | Optional | Array of CLI arguments passed to the binary. |
| `url` | `string` | For `sse`/`http` | Target endpoint URL for HTTP or SSE servers. |
| `env` | `Record<string, string>` | Optional | Custom environment variables passed to the `stdio` child process. |
| `headers` | `Record<string, string>` | Optional | Custom HTTP headers passed during HTTP / SSE handshakes. |
| `type` | `string` | Optional | Explicit transport override: `'stdio'`, `'sse'`, `'http'`, or `'streamable-http'`. |

### 4. How MCP Integration Works Under the Hood
1. **Startup Handshake**: On CLI/Gateway boot, `MCPManager` reads `mcp_servers.json` and connects to all active servers.
2. **Tool Discovery**: Queries connected servers via `client.listTools()`.
3. **Gemini Schema Sanitization (`cleanGeminiSchema`)**: Converts JSON schemas into 100% Gemini-compliant function declarations, stripping non-standard fields.
4. **Dynamic Registration**: Registers tools into Athena's active tool registry with namespaces (e.g., `[MCP: filesystem] read_file`).
5. **Graceful Teardown**: Intercepts `SIGINT` / `SIGTERM` process signals to safely terminate sub-processes and disconnect clients (`mcpManager.closeAll()`).

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
