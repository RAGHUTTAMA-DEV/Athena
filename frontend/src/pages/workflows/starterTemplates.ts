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
    name: 'PR Review Agent',
    version: 1,
    description: 'Autonomous multi-agent pull request reviewer inspecting security vulnerabilities, logic bugs, and code style in parallel with consensus voting.',
    inputs: {
      pr: {
        type: 'string',
        required: true,
        description: 'Pull Request URL or Number'
      },
      repo: {
        type: 'string',
        required: false,
        description: 'GitHub repository (owner/repo)'
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
        prompt: 'Audit PR #{{inputs.pr}} on repo {{inputs.repo}}:\nPR Diff:\n{{nodes.fetch_diff.output.diff}}\n\nInspect for security vulnerabilities, OWASP injection risks, leaked credentials, and unsafe dependencies. Return strictly valid JSON: { "verdict": "approve" | "request_changes", "score": 0-100, "notes": "concise explanation" }',
        tools: [],
        output: 'json'
      },
      {
        id: 'logic_agent',
        type: 'agent',
        prompt: 'Audit PR #{{inputs.pr}} on repo {{inputs.repo}}:\nPR Diff:\n{{nodes.fetch_diff.output.diff}}\n\nInspect for algorithmic correctness, race conditions, edge cases, and performance regressions. Return strictly valid JSON: { "verdict": "approve" | "request_changes", "score": 0-100, "notes": "concise explanation" }',
        tools: [],
        output: 'json'
      },
      {
        id: 'style_agent',
        type: 'agent',
        prompt: 'Audit PR #{{inputs.pr}} on repo {{inputs.repo}}:\nPR Diff:\n{{nodes.fetch_diff.output.diff}}\n\nInspect for clean code, strict TypeScript typing, architectural design, and test coverage. Return strictly valid JSON: { "verdict": "approve" | "request_changes", "score": 0-100, "notes": "concise explanation" }',
        tools: [],
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
    id: 'research-agent',
    name: 'Deep Research Agent',
    version: 1,
    description: 'Breaks down a research topic into queries, executes parallel web searches, synthesizes an executive briefing, and confirms via approval gate.',
    inputs: {
      topic: {
        type: 'string',
        required: true,
        description: 'Topic to thoroughly investigate'
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
        id: 'plan',
        type: 'agent',
        prompt: 'Break "{{inputs.topic}}" into 3 targeted, high-value search queries. Return a JSON array of strings.',
        tools: [],
        output: 'json'
      },
      {
        id: 'search',
        type: 'map',
        over: 'nodes.plan.output',
        maxConcurrency: 3,
        node: {
          type: 'agent',
          prompt: 'Research this query thoroughly: {{item}}',
          tools: ['searchWeb']
        }
      },
      {
        id: 'write',
        type: 'agent',
        prompt: 'Synthesize a comprehensive, executive report from these findings:\n{{nodes.search.output}}\nHighlight core insights, trade-offs, and citations.',
        tools: ['writeFile']
      },
      {
        id: 'review',
        type: 'approval',
        message: 'Research report generated for topic "{{inputs.topic}}". Confirm publishing?'
      }
    ],
    edges: [
      ['trigger', 'plan'],
      ['plan', 'search'],
      ['search', 'write'],
      ['write', 'review']
    ]
  },
  {
    id: 'daily-briefing',
    name: 'Daily Morning Briefing',
    version: 1,
    description: 'Scheduled morning routine that aggregates calendar meetings, pull requests, and unread priority emails into an executive daily briefing.',
    inputs: {
      recipient: {
        type: 'string',
        required: false,
        default: 'me',
        description: 'Recipient handle or email'
      }
    },
    settings: {
      maxTurns: 10,
      model: 'gemini-2.5-flash'
    },
    nodes: [
      {
        id: 'schedule_trigger',
        type: 'trigger',
        triggerType: 'cron',
        schedule: '0 9 * * *'
      },
      {
        id: 'fetch_calendar',
        type: 'tool',
        tool: 'noop',
        args: {
          action: 'list_events',
          timeMin: 'today'
        }
      },
      {
        id: 'fetch_github_prs',
        type: 'tool',
        tool: 'noop',
        args: {
          action: 'list_assigned_prs'
        }
      },
      {
        id: 'briefing_agent',
        type: 'agent',
        prompt: 'Compose a concise, high-priority morning briefing based on today\'s schedule and assigned PRs:\nCalendar: {{nodes.fetch_calendar.output}}\nPull Requests: {{nodes.fetch_github_prs.output}}\nHighlight immediate action items, conflicting meetings, and urgent reviews.',
        tools: []
      },
      {
        id: 'deliver_briefing',
        type: 'tool',
        tool: 'noop',
        args: {
          channel: 'slack',
          message: '{{nodes.briefing_agent.output}}'
        }
      }
    ],
    edges: [
      ['schedule_trigger', 'fetch_calendar'],
      ['schedule_trigger', 'fetch_github_prs'],
      ['fetch_calendar', 'briefing_agent'],
      ['fetch_github_prs', 'briefing_agent'],
      ['briefing_agent', 'deliver_briefing']
    ]
  },
  {
    id: 'coding-assistant',
    name: 'Autonomous Coding Assistant',
    version: 1,
    description: 'Generates code implementation, runs automated unit tests, and conditionally branches to self-repair or pull request creation.',
    inputs: {
      task: {
        type: 'string',
        required: true,
        description: 'Feature requirement or bug fix description'
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
        id: 'code_gen',
        type: 'agent',
        prompt: 'Implement the following task:\n{{inputs.task}}\nInspect workspace files, write clean implementation and tests.',
        tools: []
      },
      {
        id: 'run_tests',
        type: 'tool',
        tool: 'noop',
        args: {
          command: 'npm test'
        }
      },
      {
        id: 'eval_tests',
        type: 'condition',
        expr: 'nodes.run_tests.output.passed === true',
        trueBranch: 'create_pr',
        falseBranch: 'repair_agent'
      },
      {
        id: 'create_pr',
        type: 'tool',
        tool: 'noop',
        args: {
          title: 'feat: {{inputs.task}}'
        }
      },
      {
        id: 'repair_agent',
        type: 'agent',
        prompt: 'The test run failed:\n{{nodes.run_tests.output.error}}\nAnalyze stack trace, patch broken files, and verify fix.',
        tools: []
      }
    ],
    edges: [
      ['trigger', 'code_gen'],
      ['code_gen', 'run_tests'],
      ['run_tests', 'eval_tests'],
      ['eval_tests', 'create_pr'],
      ['eval_tests', 'repair_agent']
    ]
  }
];
