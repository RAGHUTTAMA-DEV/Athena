export interface StarterWorkflowTemplate {
  id: string;
  name: string;
  version: number;
  description: string;
  inputs: Record<string, any>;
  settings: Record<string, any>;
  agentProfile?: {
    publishAsAgent: boolean;
    name?: string;
    description?: string;
    toolName?: string;
  };
  nodes: any[];
  edges: [string, string][];
}

export const STARTER_TEMPLATES: StarterWorkflowTemplate[] = [
  {
    id: 'pr-reviewer',
    name: 'PR Review Agent & Multi-Specialist Auditor',
    version: 1,
    description: 'Autonomous multi-agent pull request reviewer inspecting security vulnerabilities, algorithmic correctness, and code style in parallel with consensus voting and automated GitHub publishing.',
    inputs: {
      repo: {
        type: 'string',
        required: true,
        default: 'RAGHUTTAMA-DEV/search-agent',
        description: 'GitHub repository (owner/repo or full URL)'
      },
      pr: {
        type: 'string',
        required: true,
        default: '8',
        description: 'Pull Request number'
      }
    },
    settings: {
      maxTurns: 15,
      model: 'gemini-2.5-flash'
    },
    agentProfile: {
      publishAsAgent: true,
      name: 'PR Review Bot',
      description: 'Coordinates specialist agents to audit PRs and post consensus reviews',
      toolName: 'runPrReviewerBot'
    },
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        triggerType: 'manual'
      },
      {
        id: 'fetch_diff',
        type: 'tool',
        tool: 'fetch_pr_diff',
        args: {
          pr: '{{inputs.pr}}',
          repo: '{{inputs.repo}}'
        }
      },
      {
        id: 'security_agent',
        type: 'agent',
        prompt: 'You are a Principal Application Security Auditor. Audit this PR for security vulnerabilities:\nRepository: {{nodes.fetch_diff.output.repo}} (PR #{{nodes.fetch_diff.output.pr}})\nTitle: {{nodes.fetch_diff.output.title}}\nDiff:\n{{nodes.fetch_diff.output.diff}}\n\nPerform a thorough security audit checking for:\n1. OWASP Top 10 risks: Injection, broken access control, SSRF, XSS, insecure deserialization.\n2. Leaked credentials, hardcoded secrets, API keys, or private tokens in code/config.\n3. Unsafe dependencies, prototype pollution, or regex denial of service (ReDoS).\n\nReturn strictly valid JSON:\n{\n  "verdict": "approve" | "request_changes",\n  "score": 0-100,\n  "findings": ["<list of security findings or None identified>"],\n  "notes": "<detailed, specific security review analysis>"\n}',
        tools: ['searchWeb', 'grepSearch'],
        output: 'json'
      },
      {
        id: 'logic_agent',
        type: 'agent',
        prompt: 'You are a Principal Systems Architect & Logic Specialist. Audit the algorithmic correctness and system logic of this PR:\nRepository: {{nodes.fetch_diff.output.repo}} (PR #{{nodes.fetch_diff.output.pr}})\nTitle: {{nodes.fetch_diff.output.title}}\nDiff:\n{{nodes.fetch_diff.output.diff}}\n\nAnalyze:\n1. Algorithmic correctness and edge case handling (null/undefined inputs, empty collections, boundary values).\n2. Concurrency hazards, race conditions, async/await error propagation, and unhandled promise rejections.\n3. State mutations, idempotency, and potential resource leaks or infinite loops.\n\nReturn strictly valid JSON:\n{\n  "verdict": "approve" | "request_changes",\n  "score": 0-100,\n  "findings": ["<list of logic findings or None identified>"],\n  "notes": "<detailed, specific logic review analysis>"\n}',
        tools: ['searchWeb', 'calculate'],
        output: 'json'
      },
      {
        id: 'style_agent',
        type: 'agent',
        prompt: 'You are a Staff Code Quality & Maintainability Specialist. Review the code quality and maintainability of this PR:\nRepository: {{nodes.fetch_diff.output.repo}} (PR #{{nodes.fetch_diff.output.pr}})\nTitle: {{nodes.fetch_diff.output.title}}\nDiff:\n{{nodes.fetch_diff.output.diff}}\n\nReview:\n1. Clean Architecture: SOLID principles, separation of concerns, meaningful identifiers.\n2. TypeScript strictness: strict types, avoiding unsafe any, proper return contracts.\n3. Maintainability, self-documenting code, and clean refactoring standards.\n\nReturn strictly valid JSON:\n{\n  "verdict": "approve" | "request_changes",\n  "score": 0-100,\n  "findings": ["<list of style/quality findings or None identified>"],\n  "notes": "<detailed, specific code quality analysis>"\n}',
        tools: ['grepSearch'],
        output: 'json'
      },
      {
        id: 'vote_collector',
        type: 'collector',
        strategy: 'consensus_voting',
        votingField: 'verdict',
        votingPolicy: 'majority',
        sources: ['security_agent', 'logic_agent', 'style_agent']
      },
      {
        id: 'human_gate',
        type: 'approval',
        message: 'Review consensus reached: {{nodes.vote_collector.output.decision}}. Approve publishing review to GitHub?'
      },
      {
        id: 'post_review',
        type: 'tool',
        tool: 'post_pr_review',
        args: {
          pr: '{{inputs.pr}}',
          repo: '{{inputs.repo}}',
          decision: '{{nodes.vote_collector.output.decision}}',
          details: '{{nodes.vote_collector.output}}'
        }
      }
    ],
    edges: [
      ['trigger', 'fetch_diff'],
      ['fetch_diff', 'security_agent'],
      ['fetch_diff', 'logic_agent'],
      ['fetch_diff', 'style_agent'],
      ['security_agent', 'vote_collector'],
      ['logic_agent', 'vote_collector'],
      ['style_agent', 'vote_collector'],
      ['vote_collector', 'human_gate'],
      ['human_gate', 'post_review']
    ]
  },
  {
    id: 'coding-assistant',
    name: 'Autonomous Coding Assistant & Self-Repair Agent',
    version: 1,
    description: 'Multi-agent coding pipeline: software architect inspects repo, implementer writes code & test assertions, runner executes tests, and self-repair agent patches regressions before PR generation.',
    inputs: {
      task: {
        type: 'string',
        required: true,
        default: 'Implement a robust token bucket rate limiter with sliding window burst capacity in TypeScript',
        description: 'Feature requirement, algorithm, or bug fix description'
      },
      file: {
        type: 'string',
        required: false,
        default: 'scratch/rate_limiter.ts',
        description: 'Target file path in workspace'
      }
    },
    settings: {
      maxTurns: 20,
      model: 'gemini-2.5-flash'
    },
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        triggerType: 'manual'
      },
      {
        id: 'repo_architect',
        type: 'agent',
        prompt: 'You are a Principal Software Architect. Analyze this engineering task:\nTask: {{inputs.task}}\nTarget File: {{inputs.file}}\n\n1. Inspect existing workspace structure and code conventions using readFile and listFiles.\n2. Formulate a rigorous design with class/interface signatures, algorithmic complexity, error conditions, and concurrency considerations.\n3. Specify exact test requirements that must be verified.\n\nOutput a comprehensive implementation and testing blueprint.',
        tools: ['readFile', 'listFiles', 'grepSearch', 'searchWeb']
      },
      {
        id: 'code_implementer',
        type: 'agent',
        prompt: "You are an Expert Software Engineer. Execute the architect's blueprint:\nBlueprint:\n{{nodes.repo_architect.output}}\nTarget File: {{inputs.file}}\n\n1. Use writeFile to write the complete, clean, production-grade implementation into '{{inputs.file}}'. Ensure strict TypeScript types and clear docstrings.\n2. Use writeFile to write an automated test verification script at 'scratch/verify_solution.js' using Node.js assert. Include at least 3 distinct test cases (happy path, burst limit boundary, and invalid input validation).\n3. Return a summary of the code and tests written.",
        tools: ['readFile', 'writeFile', 'editFile', 'calculate']
      },
      {
        id: 'run_tests',
        type: 'tool',
        tool: 'run_tests',
        args: {
          command: 'node scratch/verify_solution.js'
        }
      },
      {
        id: 'eval_tests',
        type: 'condition',
        expr: 'nodes.run_tests.output.passed === true',
        trueBranch: 'create_pr',
        falseBranch: 'self_repair_agent'
      },
      {
        id: 'self_repair_agent',
        type: 'agent',
        prompt: 'The automated test suite failed with the following error output:\nError: {{nodes.run_tests.output.error}}\nStdout: {{nodes.run_tests.output.stdout}}\nCommand: {{nodes.run_tests.output.command}}\n\n1. Use readFile to inspect {{inputs.file}} and scratch/verify_solution.js.\n2. Diagnose the root cause of the regression or assertion failure.\n3. Use editFile or writeFile to patch the bug in {{inputs.file}} or fix the test.\n4. Output an explanation of the diagnosis and patch applied.',
        tools: ['readFile', 'writeFile', 'editFile']
      },
      {
        id: 'create_pr',
        type: 'tool',
        tool: 'create_pr',
        args: {
          title: 'feat: {{inputs.task}}',
          branch: 'feat/autonomous-code-implementation'
        }
      }
    ],
    edges: [
      ['trigger', 'repo_architect'],
      ['repo_architect', 'code_implementer'],
      ['code_implementer', 'run_tests'],
      ['run_tests', 'eval_tests'],
      ['eval_tests', 'create_pr'],
      ['eval_tests', 'self_repair_agent'],
      ['self_repair_agent', 'create_pr']
    ]
  },
  {
    id: 'research-agent',
    name: 'Deep Research & Executive Synthesis Agent',
    version: 1,
    description: 'Multi-agent research system: planner decomposes topics, parallel web investigators and adversarial fact-checkers scour primary sources, collector merges findings, and an executive writer synthesizes a publication-ready whitepaper.',
    inputs: {
      topic: {
        type: 'string',
        required: true,
        default: 'Multi-Agent System architectures and Model Context Protocol (MCP) production adoption in 2026',
        description: 'Research subject or technical domain to investigate'
      },
      depth: {
        type: 'string',
        required: false,
        default: 'deep',
        description: "Investigation depth: 'deep' (primary sources & benchmarks) or 'quick' (summary overview)"
      }
    },
    settings: {
      maxTurns: 15,
      model: 'gemini-2.5-flash'
    },
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        triggerType: 'manual'
      },
      {
        id: 'research_planner',
        type: 'agent',
        prompt: 'You are a Chief Research Officer. Decompose this research topic into an investigative blueprint:\nTopic: {{inputs.topic}}\nDepth: {{inputs.depth}}\n\n1. Formulate 3 distinct investigative dimensions:\n   - Dimension A: Core technical architecture, protocols, and architectural trade-offs.\n   - Dimension B: Real-world engineering benchmarks, enterprise adoption, and ecosystem tools.\n   - Dimension C: Failure modes, security boundaries, and unresolved challenges.\n2. Output the search strategy and key questions that each specialist must answer.',
        tools: ['searchWeb']
      },
      {
        id: 'web_investigator',
        type: 'agent',
        prompt: 'You are an Elite Technical Intelligence Specialist. Investigate the blueprint for:\nTopic: {{inputs.topic}}\nBlueprint:\n{{nodes.research_planner.output}}\n\n1. Use searchWeb to find technical documentation, engineering blogs, GitHub repositories, and quantitative benchmarks.\n2. Extract concrete facts, architectural patterns, throughput/latency numbers, and real-world implementation case studies.\n3. Return a detailed, cited intelligence briefing.',
        tools: ['searchWeb', 'readFile']
      },
      {
        id: 'adversarial_fact_checker',
        type: 'agent',
        prompt: 'You are an Adversarial Fact Checker & Systems Auditor. Scrutinize the technical domain:\nTopic: {{inputs.topic}}\nBlueprint:\n{{nodes.research_planner.output}}\n\n1. Use searchWeb to actively search for counter-arguments, critical vulnerabilities, performance pitfalls, and criticisms.\n2. Validate whether industry claims are backed by reproducible engineering data or marketing hype.\n3. Identify edge cases, security implications, and deployment bottlenecks.\n4. Return an adversarial audit report.',
        tools: ['searchWeb', 'calculate']
      },
      {
        id: 'dossier_collector',
        type: 'collector',
        strategy: 'structured_merge',
        sources: ['web_investigator', 'adversarial_fact_checker']
      },
      {
        id: 'executive_report_writer',
        type: 'agent',
        prompt: "You are an Executive Technology Analyst. Synthesize the collected research intelligence into an authoritative whitepaper:\nTopic: {{inputs.topic}}\nCollected Data:\n{{nodes.dossier_collector.output}}\n\nStructure the whitepaper with:\n# Executive Intelligence Whitepaper: {{inputs.topic}}\n## 1. Executive Summary & Strategic Takeaways\n## 2. Core Architecture & Protocol Specifications\n## 3. Empirical Benchmarks & Performance Analysis\n## 4. Adversarial Audit, Security & Known Pitfalls\n## 5. Strategic Recommendations & Production Roadmap\n\nUse writeFile to save this complete report as 'scratch/research_dossier.md'. Return the full formatted Markdown whitepaper.",
        tools: ['writeFile']
      },
      {
        id: 'review_gate',
        type: 'approval',
        message: "Executive whitepaper generated and saved to scratch/research_dossier.md for '{{inputs.topic}}'. Approve final dossier?"
      }
    ],
    edges: [
      ['trigger', 'research_planner'],
      ['research_planner', 'web_investigator'],
      ['research_planner', 'adversarial_fact_checker'],
      ['web_investigator', 'dossier_collector'],
      ['adversarial_fact_checker', 'dossier_collector'],
      ['dossier_collector', 'executive_report_writer'],
      ['executive_report_writer', 'review_gate']
    ]
  },
  {
    id: 'calendar-intelligence',
    name: 'Executive Calendar & Web Intelligence',
    version: 1,
    description: 'Fetches daily meetings from Calendar MCP, runs parallel web searches on attendees and companies, detects schedule conflicts, and generates an executive intelligence briefing.',
    inputs: {
      date: {
        type: 'string',
        required: false,
        default: 'today',
        description: 'Date or time range to inspect (e.g. today)'
      },
      channel: {
        type: 'string',
        required: false,
        default: 'telegram',
        description: 'Delivery channel for the executive briefing'
      }
    },
    settings: {
      maxTurns: 15,
      model: 'gemini-2.5-flash'
    },
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        triggerType: 'manual'
      },
      {
        id: 'fetch_calendar',
        type: 'tool',
        tool: 'calendar_list_events',
        args: {
          timeMin: '{{inputs.date}}',
          singleEvents: true
        }
      },
      {
        id: 'attendee_researcher',
        type: 'agent',
        prompt: "Inspect today's calendar events fetched via Calendar MCP:\n{{nodes.fetch_calendar.output}}\n\nIdentify all meeting participants, client companies, and agenda topics. Use searchWeb to research:\n1. Recent company news and product launches for the organizations involved.\n2. Professional backgrounds and key projects for external attendees.\n3. 3 strategic talking points for each meeting.\nReturn a structured attendee intelligence briefing.",
        tools: ['searchWeb']
      },
      {
        id: 'conflict_auditor',
        type: 'agent',
        prompt: "Audit today's calendar events:\n{{nodes.fetch_calendar.output}}\n\nPerform a schedule health check:\n1. Detect overlapping or double-booked meetings.\n2. Flag back-to-back blocks without at least 15 minutes of recovery/prep time.\n3. Score today's schedule intensity from 1 to 10 and recommend optimal focus blocks.\nReturn a schedule audit report.",
        tools: ['calculate']
      },
      {
        id: 'dossier_collector',
        type: 'collector',
        strategy: 'structured_merge',
        sources: ['attendee_researcher', 'conflict_auditor']
      },
      {
        id: 'briefing_synthesizer',
        type: 'agent',
        prompt: "Synthesize a Morning Executive Briefing Dossier combining calendar schedule, attendee intelligence, and conflict warnings:\n{{nodes.dossier_collector.output}}\n\nCreate a publication-ready briefing:\n# 🌅 Executive Morning Intelligence Dossier\n## 📅 Chronological Agenda & Priority Tiers\n## 👥 Meeting Intelligence & Attendee Talking Points\n## ⚠️ Schedule Health Warnings & Action Items\n\nUse writeFile to save this briefing to 'scratch/executive_briefing.md'. Return the full formatted Markdown briefing.",
        tools: ['writeFile']
      },
      {
        id: 'approval_gate',
        type: 'approval',
        message: 'Executive briefing synthesized for {{inputs.date}}. Approve dispatching to {{inputs.channel}}?'
      },
      {
        id: 'send_briefing',
        type: 'tool',
        tool: 'send_telegram',
        args: {
          channel: '{{inputs.channel}}',
          message: '{{nodes.briefing_synthesizer.output}}'
        }
      }
    ],
    edges: [
      ['trigger', 'fetch_calendar'],
      ['fetch_calendar', 'attendee_researcher'],
      ['fetch_calendar', 'conflict_auditor'],
      ['attendee_researcher', 'dossier_collector'],
      ['conflict_auditor', 'dossier_collector'],
      ['dossier_collector', 'briefing_synthesizer'],
      ['briefing_synthesizer', 'approval_gate'],
      ['approval_gate', 'send_briefing']
    ]
  }
];
