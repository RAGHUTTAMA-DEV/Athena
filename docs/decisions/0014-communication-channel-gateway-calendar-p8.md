# ADR-0014: Communication Subsystem — Channel Gateway, Multi-Channel Adapters, Privilege Separation Guard, and Calendar Engine (P8)

- Status: Accepted
- Date: 2026-10-09
- Phase: V2 P8 (Communication — spec sections 26, 27, 28, 58)

## Context

In Athena V1, communication was handled largely through the CLI terminal with a separate monolithic Telegram bot implementation (`TelegramGateway`). This presented fundamental limitations for autonomous operations across multiple channels:
1. **Unified Core Principle (Spec Section 26)**: In an autonomous persistent agent, channels are *interfaces*, not separate agents. All interactions across CLI, Telegram, Email, Discord, Slack, and WhatsApp must route into the **single persistent Athena core**, preserving shared identity, workspace state, goals, and scoped memories.
2. **Channel Normalization**: Each platform has unique transport mechanics, character limits, formatting idioms, and capabilities. A normalized abstraction layer (`Channel`, `Conversation`, `Participant`, `InboundMessage`, `OutboundMessage`, `ChannelAdapter`) is necessary so core reasoning is completely decoupled from platform-specific SDKs.
3. **Sender Authorization & Privilege Separation Guard (Spec Section 26, 27, 58, 66)**: Channels expose Athena to interactions from external third parties and untrusted strangers. All incoming content is untrusted data and must pass through `PromptDefense`. Crucially, **strangers must never be permitted to trigger privileged or destructive system actions** (`cmd:exec`, `terminalExec`, `writeFile`, `deleteFile`, `computerAction`).
4. **Outbound Messaging Policy & Secret Redaction (Spec Section 27)**: Outbound communication requires strict policy enforcement:
   - Secret redaction via `CredentialManager` to prevent credentials (API keys, bot tokens, passwords) from leaking outbound.
   - Approval gate for external broadcasts and public communication.
5. **Calendar Integration, Deadlines, & Reminders (Spec Section 28)**: Autonomous persistence requires understanding deadlines and commitments. Natural language expressions ("tomorrow morning", "in 2 hours") must be translated into durable scheduled actions linked to goals/tasks that emit proactive reminder alerts to wake Athena before deadlines expire.

## Decision

1. **Schema Migration 10 (`v2_p8_communication`)**:
   - `channels`: `id`, `type`, `name`, `status`, `config`, `created_at`, `updated_at`. Indexed by `type`.
   - `conversations`: `id`, `channel_id`, `external_thread_id`, `title`, `active_session_id`, `active_goal_id`, `metadata`, `created_at`, `updated_at`. Indexed by `channel_id` and `external_thread_id`.
   - `participants`: `id`, `conversation_id`, `external_user_id`, `display_name`, `role` (`owner`, `collaborator`, `stranger`), `permissions`, `metadata`, `created_at`. Indexed by `conversation_id` and `external_user_id`.
   - `channel_messages`: `id`, `channel_id`, `conversation_id`, `direction` (`inbound`, `outbound`), `sender_id`, `recipient_id`, `content`, `attachments`, `status` (`received`, `sent`, `failed`, `blocked_policy`), `reply_to_id`, `metadata`, `timestamp`. Indexed by `conversation_id`, `timestamp`, and `status`.
   - `calendar_events`: `id`, `title`, `description`, `start_time`, `end_time`, `location`, `attendees`, `reminders`, `status`, `goal_id`, `task_id`, `scheduled_job_id`, `metadata`, `created_at`, `updated_at`. Indexed by `start_time` and `goal_id`.

2. **Storage Layer**:
   - Interfaces in `src/storage/stores/types.ts`: `CommunicationStore`, `CalendarStore`.
   - SQLite implementations: `SqliteCommunicationStore`, `SqliteCalendarStore`.
   - Registered in `SqliteStores` and exposed through `EpisodicMemory` facade getters.

3. **Normalized Channel Adapters (`src/gateway/adapters/`)**:
   - `CliChannelAdapter`: CLI terminal bridge.
   - `TelegramChannelAdapter`: Telegram bot adapter supporting Telegraf, markdown chunking (>4096 chars), and interactive confirmations.
   - `EmailChannelAdapter`: RFC822 format, subject line threading, and recipient resolution.
   - `DiscordChannelAdapter`: Discord formatting, embeds, and channel routing.
   - `SlackChannelAdapter`: Slack message blocks, user mentions, and thread routing.
   - `WhatsAppChannelAdapter`: WhatsApp Business Platform Cloud API adapter, marked `experimental` in the capability registry per build plan note.

4. **Channel Gateway Manager (`src/gateway/channelGatewayManager.ts`)**:
   - Central orchestration gateway routing all inbound messages into the single Athena Agent core.
   - Participant role resolution: identifies `owner` vs `stranger` based on configured owner IDs/emails.
   - Untrusted boundary: all inbound text analyzed and sanitized by `PromptDefense`.
   - Privilege separation guard: strangers attempting privileged execution are blocked with `blocked_policy` status and an explicit security warning.
   - Outbound secret protection: all outbound agent messages pass through `CredentialManager.redactString()`.

5. **Calendar Engine & Tools (`src/communication/calendarEngine.ts`, `src/tools/communicationTools.ts`)**:
   - `parseRelativeDeadline()`: resolves relative time expressions ("tomorrow morning" at 09:00, "in 30 minutes", "in 2 hours", "next Monday") into epoch timestamps.
   - `CalendarEngine`: manages events and queries upcoming reminders; `checkAndTriggerDueReminders()` emits `calendar:deadline_approaching` on `EventBus` and `EventPipeline`.
   - Tools: `sendMessage`, `calendarManage`, `reminderSet` registered with manifests in `SearchableToolRegistry`.

6. **Capability Registry (`src/tools/capabilityRegistry.ts`)**:
   - Seeded 8 P8 capabilities:
     - `communication.gateway`: `real`
     - `communication.telegram`: `real`
     - `communication.email`: `real`
     - `communication.discord`: `real`
     - `communication.slack`: `real`
     - `communication.whatsapp`: `experimental` (requires official WhatsApp Business Account Cloud API)
     - `communication.policy_guard`: `real`
     - `communication.calendar`: `real`

## Consequences

- **Single Unified Identity**: Athena operates as one persistent agent across all channels. Switching between CLI, Telegram, or Discord maintains continuous memory and goals.
- **Strong Threat Defense**: Third-party channel participants cannot trick Athena into running commands, deleting files, or dumping credentials.
- **Privacy & Safety**: Outbound messages cannot accidentally leak sensitive API keys or credentials.
- **Proactive Time Horizon**: Athena tracks deadlines and scheduled events, waking proactively ahead of critical obligations.
