import { PostgresMigration } from './postgresDatabase.js';

export const POSTGRES_MIGRATIONS: PostgresMigration[] = [
  {
    version: 1,
    name: 'v1_baseline',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS episodic_memory (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pg_episodic_session ON episodic_memory(session_id);

        CREATE TABLE IF NOT EXISTS semantic_memory (
          id BIGSERIAL PRIMARY KEY,
          fact TEXT NOT NULL,
          embedding TEXT NOT NULL,
          tags TEXT,
          timestamp BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pg_semantic_timestamp ON semantic_memory(timestamp);

        CREATE TABLE IF NOT EXISTS scheduled_jobs (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          schedule TEXT NOT NULL,
          session_id TEXT NOT NULL,
          last_run BIGINT,
          next_run BIGINT NOT NULL,
          active INT DEFAULT 1,
          timezone TEXT DEFAULT 'UTC',
          locked_by TEXT,
          locked_at BIGINT,
          lease_timeout_ms INT DEFAULT 60000,
          priority TEXT DEFAULT 'normal'
        );

        CREATE TABLE IF NOT EXISTS event_log (
          id TEXT PRIMARY KEY,
          topic TEXT NOT NULL,
          idempotency_key TEXT,
          payload TEXT,
          timestamp BIGINT NOT NULL,
          published INT DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS run_state (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          current_turn INT DEFAULT 0,
          max_turns INT NOT NULL,
          session_id TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          checkpoint TEXT,
          plan_state TEXT,
          budget_state TEXT,
          failure_history TEXT,
          termination_reason TEXT,
          error TEXT
        );

        CREATE TABLE IF NOT EXISTS tool_metrics (
          tool_name TEXT PRIMARY KEY,
          total_calls INT DEFAULT 0,
          success_calls INT DEFAULT 0,
          failed_calls INT DEFAULT 0,
          total_duration_ms BIGINT DEFAULT 0,
          last_called_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS error_recovery (
          error_signature TEXT PRIMARY KEY,
          error_category TEXT NOT NULL,
          recovery_strategy TEXT NOT NULL,
          success_count INT DEFAULT 0,
          failure_count INT DEFAULT 0,
          last_attempted_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS evaluations (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          category TEXT NOT NULL,
          score DOUBLE PRECISION NOT NULL,
          passed INT NOT NULL,
          reasoning TEXT,
          details TEXT,
          timestamp BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skill_discovery (
          name TEXT PRIMARY KEY,
          description TEXT,
          success_count INT DEFAULT 0,
          failure_count INT DEFAULT 0,
          last_used BIGINT
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          metadata TEXT
        );
      `);
    }
  },
  {
    version: 2,
    name: 'v2_p1_agent_foundation',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          root_path TEXT NOT NULL,
          description TEXT,
          settings TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS projects (
          id BIGSERIAL PRIMARY KEY,
          workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          settings TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          UNIQUE(workspace_id, name)
        );

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE,
          roles TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          system_prompt TEXT NOT NULL,
          soul_text TEXT,
          model_tier TEXT NOT NULL DEFAULT 'standard',
          active_workspace_id BIGINT REFERENCES workspaces(id) ON DELETE SET NULL,
          tools_allowed TEXT,
          permissions TEXT,
          current_version INT NOT NULL DEFAULT 1,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_profile_versions (
          id BIGSERIAL PRIMARY KEY,
          profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
          version INT NOT NULL,
          snapshot TEXT NOT NULL,
          changed_by TEXT,
          created_at BIGINT NOT NULL,
          UNIQUE(profile_id, version)
        );

        CREATE TABLE IF NOT EXISTS scoped_memory (
          id BIGSERIAL PRIMARY KEY,
          scope TEXT NOT NULL,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding TEXT,
          tags TEXT,
          confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
          lifecycle TEXT NOT NULL DEFAULT 'active',
          provenance TEXT,
          session_id TEXT,
          workspace_id BIGINT REFERENCES workspaces(id) ON DELETE CASCADE,
          project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
          agent_id TEXT REFERENCES agent_profiles(id) ON DELETE CASCADE,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pg_scoped_mem_scope ON scoped_memory(scope);
        CREATE INDEX IF NOT EXISTS idx_pg_scoped_mem_lifecycle ON scoped_memory(lifecycle);
      `);
    }
  },
  {
    version: 3,
    name: 'v2_p2_persistent_autonomy',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS goals (
          id TEXT PRIMARY KEY,
          intent TEXT NOT NULL,
          status TEXT NOT NULL,
          workspace_id BIGINT REFERENCES workspaces(id) ON DELETE SET NULL,
          parent_goal_id TEXT,
          budget TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          completed_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          dependencies TEXT,
          assigned_agent_id TEXT,
          result TEXT,
          error TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS run_waits (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          wait_condition TEXT NOT NULL,
          status TEXT NOT NULL,
          timeout_at BIGINT,
          created_at BIGINT NOT NULL,
          resumed_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS session_search (
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          content_text TEXT NOT NULL,
          session_id TEXT,
          run_id TEXT,
          goal_id TEXT,
          task_id TEXT,
          workspace_id BIGINT,
          project_id BIGINT,
          agent_id TEXT,
          metadata TEXT,
          timestamp BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pg_session_search_cat ON session_search(category);
      `);
    }
  },
  {
    version: 4,
    name: 'v2_p4b_research_rag_documents',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS research_documents (
          id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL,
          source_uri TEXT NOT NULL,
          title TEXT,
          format TEXT,
          content_hash TEXT NOT NULL,
          chunk_count INT NOT NULL,
          char_count INT NOT NULL,
          workspace_id BIGINT,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vector_embeddings (
          id TEXT PRIMARY KEY,
          namespace TEXT NOT NULL,
          ref_id TEXT,
          text TEXT NOT NULL,
          embedding TEXT NOT NULL,
          dims INT NOT NULL,
          model TEXT NOT NULL,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pg_vec_namespace ON vector_embeddings(namespace);
        CREATE INDEX IF NOT EXISTS idx_pg_vec_ref ON vector_embeddings(ref_id);
      `);
    }
  },
  {
    version: 5,
    name: 'v2_p4c_browser_profiles',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS browser_profiles (
          id TEXT PRIMARY KEY,
          agent_id TEXT,
          task_id TEXT,
          name TEXT NOT NULL UNIQUE,
          user_data_dir TEXT NOT NULL,
          cookies_count INT DEFAULT 0,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
      `);
    }
  },
  {
    version: 6,
    name: 'v2_p5_learning',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS routines (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          trigger_type TEXT NOT NULL,
          trigger_config TEXT NOT NULL,
          workflow TEXT NOT NULL,
          conditions TEXT,
          permissions TEXT,
          enabled INT NOT NULL DEFAULT 1,
          success_rate DOUBLE PRECISION DEFAULT 0.0,
          invocations INT DEFAULT 0,
          last_run_at BIGINT,
          history TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS learned_workflows (
          id TEXT PRIMARY KEY,
          intent TEXT NOT NULL,
          steps TEXT NOT NULL,
          dependencies TEXT,
          conditions TEXT,
          required_permissions TEXT,
          expected_outcome TEXT,
          failure_handling TEXT,
          source_run_id TEXT,
          status TEXT NOT NULL,
          review_notes TEXT,
          reviewed_by TEXT,
          reviewed_at BIGINT,
          success_rate DOUBLE PRECISION DEFAULT 0.0,
          invocations INT DEFAULT 0,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          version TEXT NOT NULL,
          description TEXT,
          tags TEXT,
          dependencies TEXT,
          permissions TEXT,
          triggers TEXT,
          content_path TEXT,
          status TEXT NOT NULL,
          invocations INT DEFAULT 0,
          success_count INT DEFAULT 0,
          failure_count INT DEFAULT 0,
          success_rate DOUBLE PRECISION DEFAULT 0.0,
          last_used_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
      `);
    }
  },
  {
    version: 7,
    name: 'v2_p6_multi_agent',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_messages (
          id TEXT PRIMARY KEY,
          sender_id TEXT NOT NULL,
          recipient_id TEXT NOT NULL,
          message_type TEXT NOT NULL,
          goal_id TEXT,
          task_id TEXT,
          run_id TEXT,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          reply_to_id TEXT,
          created_at BIGINT NOT NULL,
          processed_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS agent_teams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          justification TEXT NOT NULL,
          lead_agent_id TEXT NOT NULL,
          member_agent_ids TEXT NOT NULL,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
      `);
    }
  },
  {
    version: 8,
    name: 'v2_p7_proactive_agent',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS durable_agent_events (
          id TEXT PRIMARY KEY,
          topic TEXT NOT NULL,
          trace_id TEXT,
          agent_id TEXT,
          goal_id TEXT,
          task_id TEXT,
          run_id TEXT,
          idempotency_key TEXT,
          payload TEXT NOT NULL,
          priority TEXT NOT NULL,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          retry_count INT DEFAULT 0,
          max_retries INT DEFAULT 3,
          error_message TEXT,
          timestamp BIGINT NOT NULL,
          processed_at BIGINT
        );

        CREATE TABLE IF NOT EXISTS webhook_endpoints (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          secret TEXT NOT NULL,
          allowed_topics TEXT,
          is_active INT NOT NULL DEFAULT 1,
          require_signature INT NOT NULL DEFAULT 1,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS webhook_receipts (
          id TEXT PRIMARY KEY,
          endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
          idempotency_key TEXT,
          signature TEXT,
          timestamp BIGINT NOT NULL,
          status TEXT NOT NULL,
          source_ip TEXT,
          payload_hash TEXT,
          created_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS heartbeat_logs (
          id TEXT PRIMARY KEY,
          agent_id TEXT,
          woke_agent INT NOT NULL DEFAULT 0,
          reason TEXT,
          cost_usd DOUBLE PRECISION DEFAULT 0.0,
          tokens_used INT DEFAULT 0,
          active_goals_count INT DEFAULT 0,
          timestamp BIGINT NOT NULL
        );
      `);
    }
  },
  {
    version: 9,
    name: 'v2_p8_communication',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS communication_channels (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          config TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL REFERENCES communication_channels(id) ON DELETE CASCADE,
          external_thread_id TEXT NOT NULL,
          title TEXT,
          active_session_id TEXT,
          active_goal_id TEXT,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          UNIQUE(channel_id, external_thread_id)
        );

        CREATE TABLE IF NOT EXISTS conversation_participants (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          external_user_id TEXT NOT NULL,
          display_name TEXT,
          role TEXT NOT NULL,
          permissions TEXT,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          UNIQUE(conversation_id, external_user_id)
        );

        CREATE TABLE IF NOT EXISTS channel_messages (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL REFERENCES communication_channels(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          direction TEXT NOT NULL,
          sender_id TEXT,
          recipient_id TEXT,
          content TEXT NOT NULL,
          attachments TEXT,
          status TEXT NOT NULL,
          reply_to_id TEXT,
          metadata TEXT,
          timestamp BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS calendar_events (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          start_time BIGINT NOT NULL,
          end_time BIGINT NOT NULL,
          location TEXT,
          attendees TEXT,
          reminders TEXT,
          status TEXT NOT NULL,
          goal_id TEXT,
          task_id TEXT,
          scheduled_job_id TEXT,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );
      `);
    }
  },
  {
    version: 10,
    name: 'v2_p9_multimodal_voice',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS multimodal_artifacts (
          id TEXT PRIMARY KEY,
          media_type TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_path TEXT NOT NULL,
          source TEXT,
          transcription TEXT,
          caption TEXT,
          metadata TEXT,
          created_at BIGINT NOT NULL
        );
      `);
    }
  },
  {
    version: 11,
    name: 'v2_p10_intelligence',
    up: async (_client) => {
      // Intelligence router, cache, and credential pool are memory/config-driven
    }
  },
  {
    version: 12,
    name: 'v2_p11_reliability',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          risk_level TEXT NOT NULL,
          explanation TEXT NOT NULL,
          proposed_action TEXT NOT NULL,
          status TEXT NOT NULL,
          channel_id TEXT,
          run_id TEXT,
          goal_id TEXT,
          task_id TEXT,
          expires_at BIGINT,
          created_at BIGINT NOT NULL,
          resolved_at BIGINT,
          resolution_reason TEXT
        );

        CREATE TABLE IF NOT EXISTS artifacts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          current_version INT NOT NULL,
          content_hash TEXT NOT NULL,
          file_path TEXT,
          content_text TEXT,
          agent_id TEXT,
          run_id TEXT,
          goal_id TEXT,
          task_id TEXT,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS artifact_versions (
          id TEXT PRIMARY KEY,
          artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
          version INT NOT NULL,
          content_hash TEXT NOT NULL,
          file_path TEXT,
          content_text TEXT,
          metadata TEXT,
          created_at BIGINT NOT NULL,
          UNIQUE(artifact_id, version)
        );

        CREATE TABLE IF NOT EXISTS replay_logs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_index INT NOT NULL,
          model_input TEXT,
          model_output TEXT,
          tool_calls TEXT,
          tool_outputs TEXT,
          state_diff TEXT,
          timestamp BIGINT NOT NULL
        );
      `);
    }
  }
];
