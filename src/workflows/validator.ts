import { Workflow, WfNode } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a workflow definition completely before persistence and execution.
 */
export function validateWorkflow(wf: Workflow): ValidationResult {
  const errors: string[] = [];

  if (!wf) {
    return { valid: false, errors: ['Workflow definition is null or undefined'] };
  }

  if (!wf.id || typeof wf.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(wf.id)) {
    errors.push(`Invalid workflow id '${wf.id}': must be non-empty alphanumeric with hyphens or underscores`);
  }

  if (!wf.name || typeof wf.name !== 'string' || wf.name.trim().length === 0) {
    errors.push('Workflow name is required');
  }

  if (typeof wf.version !== 'number' || wf.version < 1) {
    errors.push('Workflow version must be a positive integer');
  }

  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) {
    errors.push('Workflow must contain at least one node');
    return { valid: false, errors };
  }

  // Check unique node IDs
  const nodeMap = new Map<string, WfNode>();
  for (const n of wf.nodes) {
    if (!n.id || typeof n.id !== 'string') {
      errors.push('Every node must have a valid string id');
      continue;
    }
    if (nodeMap.has(n.id)) {
      errors.push(`Duplicate node id detected: '${n.id}'`);
    } else {
      nodeMap.set(n.id, n);
    }
  }

  // Validate nodes individually
  for (const n of wf.nodes) {
    validateNode(n, nodeMap, errors);
  }

  // Validate edges
  const edges = Array.isArray(wf.edges) ? wf.edges : [];
  const adjacency = new Map<string, string[]>();
  for (const [from, to] of edges) {
    if (!nodeMap.has(from)) {
      errors.push(`Edge references non-existent source node '${from}'`);
    }
    if (!nodeMap.has(to)) {
      errors.push(`Edge references non-existent target node '${to}'`);
    }
    if (from === to) {
      errors.push(`Self-cycle detected on node '${from}'`);
    }
    if (!adjacency.has(from)) {
      adjacency.set(from, []);
    }
    adjacency.get(from)!.push(to);
  }

  // Cycle detection via DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const neighbors = adjacency.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const nodeId of nodeMap.keys()) {
    if (!visited.has(nodeId)) {
      if (hasCycle(nodeId)) {
        errors.push('Cycle detected in workflow edges graph');
        break;
      }
    }
  }

  // Validate declared inputs vs referenced inputs
  const declaredInputs = new Set(Object.keys(wf.inputs || {}));
  const rawJson = JSON.stringify(wf.nodes);
  const inputMatches = rawJson.matchAll(/\{\{\s*inputs\.([a-zA-Z0-9_$]+)/g);
  for (const match of inputMatches) {
    const inputKey = match[1];
    if (!declaredInputs.has(inputKey)) {
      errors.push(`Template references undeclared input 'inputs.${inputKey}'`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function validateNode(n: WfNode, nodeMap: Map<string, WfNode>, errors: string[]): void {
  switch (n.type) {
    case 'agent':
      if (!n.prompt || typeof n.prompt !== 'string' || n.prompt.trim().length === 0) {
        errors.push(`Agent node '${n.id}' requires a non-empty prompt`);
      }
      if (!Array.isArray(n.tools)) {
        errors.push(`Agent node '${n.id}' requires a tools array`);
      }
      break;

    case 'tool':
      if (!n.tool || typeof n.tool !== 'string' || n.tool.trim().length === 0) {
        errors.push(`Tool node '${n.id}' requires a tool name`);
      }
      if (!n.args || typeof n.args !== 'object') {
        errors.push(`Tool node '${n.id}' requires an args object`);
      }
      break;

    case 'condition':
      if (!n.expr || typeof n.expr !== 'string' || n.expr.trim().length === 0) {
        errors.push(`Condition node '${n.id}' requires a non-empty expr`);
      }
      if (!n.trueBranch || !nodeMap.has(n.trueBranch)) {
        errors.push(`Condition node '${n.id}' trueBranch '${n.trueBranch}' does not exist in nodes`);
      }
      if (!n.falseBranch || !nodeMap.has(n.falseBranch)) {
        errors.push(`Condition node '${n.id}' falseBranch '${n.falseBranch}' does not exist in nodes`);
      }
      break;

    case 'map':
      if (!n.over || typeof n.over !== 'string' || n.over.trim().length === 0) {
        errors.push(`Map node '${n.id}' requires an 'over' expression`);
      }
      if (!n.node || typeof n.node !== 'object') {
        errors.push(`Map node '${n.id}' requires a template node`);
      }
      break;

    case 'orchestrator':
      if (!n.systemPrompt || typeof n.systemPrompt !== 'string' || n.systemPrompt.trim().length === 0) {
        errors.push(`Orchestrator node '${n.id}' requires a non-empty systemPrompt`);
      }
      if (!Array.isArray(n.specialists) || n.specialists.length === 0) {
        errors.push(`Orchestrator node '${n.id}' requires at least one specialist in specialists[]`);
      } else {
        const specNames = new Set<string>();
        for (const s of n.specialists) {
          if (!s.name || specNames.has(s.name)) {
            errors.push(`Specialist in orchestrator '${n.id}' has duplicate or invalid name '${s.name}'`);
          }
          specNames.add(s.name);
          if (!s.systemPrompt || s.systemPrompt.trim().length === 0) {
            errors.push(`Specialist '${s.name}' in orchestrator '${n.id}' requires a systemPrompt`);
          }
        }
      }
      break;

    case 'collector':
      if (!['structured_merge', 'consensus_voting', 'debate_refine', 'synthesis_agent'].includes(n.strategy)) {
        errors.push(`Collector node '${n.id}' has unknown strategy '${n.strategy}'`);
      }
      if (!Array.isArray(n.sources) || n.sources.length === 0) {
        errors.push(`Collector node '${n.id}' requires at least one source node in sources[]`);
      } else {
        for (const src of n.sources) {
          if (!nodeMap.has(src)) {
            errors.push(`Collector node '${n.id}' references non-existent source node '${src}'`);
          }
        }
        if (n.strategy === 'debate_refine' && n.sources.length < 2) {
          errors.push(`Collector node '${n.id}' with debate_refine strategy requires at least 2 sources`);
        }
      }
      break;

    case 'approval':
      if (!n.message || typeof n.message !== 'string' || n.message.trim().length === 0) {
        errors.push(`Approval node '${n.id}' requires a message`);
      }
      break;

    case 'subWorkflow':
      if (!n.workflowId || typeof n.workflowId !== 'string' || n.workflowId.trim().length === 0) {
        errors.push(`SubWorkflow node '${n.id}' requires a workflowId`);
      }
      break;

    case 'trigger':
      if (!['manual', 'cron', 'webhook', 'chat'].includes(n.triggerType)) {
        errors.push(`Trigger node '${n.id}' has invalid triggerType '${n.triggerType}'`);
      }
      if (n.triggerType === 'cron' && (!n.schedule || n.schedule.trim().length === 0)) {
        errors.push(`Cron trigger node '${n.id}' requires a schedule cron expression`);
      }
      break;

    default:
      errors.push(`Node '${(n as any).id}' has unknown type '${(n as any).type}'`);
  }
}
