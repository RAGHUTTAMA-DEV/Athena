/**
 * Safe template engine for Athena Workflows.
 *
 * Provides dot/bracket path resolution, {{ }} string/object interpolation,
 * and a secure micro-evaluator for condition expressions (no eval() or new Function()).
 */

export interface TemplateContext {
  inputs?: Record<string, any>;
  nodes?: Record<string, { output?: any; status?: string; error?: string }>;
  blackboard?: Record<string, any>;
  item?: any;
  [key: string]: any;
}

/**
 * Resolves a dot/bracket path against a context object.
 * Examples: "inputs.topic", "nodes.plan.output[0].query", "item", "blackboard.diff"
 */
export function evalPath(pathStr: string, ctx: any): any {
  if (!pathStr || typeof pathStr !== 'string') return undefined;
  const trimmed = pathStr.trim();
  if (trimmed === '') return undefined;

  // Split path supporting dot and bracket notation: e.g. "nodes.search.output[0].id"
  // Normalize brackets: "nodes.search.output[0].id" -> "nodes.search.output.0.id"
  const normalized = trimmed.replace(/\[(\w+)\]/g, '.$1').replace(/^\./, '');
  const segments = normalized.split('.');

  let curr = ctx;
  for (const seg of segments) {
    if (curr === null || curr === undefined) {
      return undefined;
    }
    // Handle array or object indexing
    curr = curr[seg];
  }
  return curr;
}

/**
 * Interpolates {{ path }} expressions within a string.
 */
export function render(template: string, ctx: TemplateContext): string {
  if (typeof template !== 'string') return String(template ?? '');

  // Exact match replacement if the whole template is just "{{ path }}"
  const exactMatch = template.trim().match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (exactMatch) {
    const val = evalPath(exactMatch[1], ctx);
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') {
      return JSON.stringify(val);
    }
    return String(val);
  }

  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path) => {
    const val = evalPath(path, ctx);
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') {
      return JSON.stringify(val);
    }
    return String(val);
  });
}

/**
 * Recursively renders {{ }} inside objects, arrays, and primitive fields.
 * If a string field matches exactly "{{ path }}" and evaluates to a non-string object/number/array,
 * the raw typed value is preserved.
 */
export function deepRender(value: any, ctx: TemplateContext): any {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    const exactMatch = value.trim().match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (exactMatch) {
      const resolved = evalPath(exactMatch[1], ctx);
      return resolved !== undefined ? resolved : '';
    }
    return render(value, ctx);
  }

  if (Array.isArray(value)) {
    return value.map(item => deepRender(item, ctx));
  }

  if (typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = deepRender(v, ctx);
    }
    return result;
  }

  return value;
}

// ── Safe Condition Evaluator (No eval / No Function) ────────────────

type TokenType =
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'NULL'
  | 'OPERATOR'
  | 'LPAREN'
  | 'RPAREN';

interface Token {
  type: TokenType;
  value: any;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    // Two/three char operators
    const next3 = expr.slice(i, i + 3);
    const next2 = expr.slice(i, i + 2);

    if (next3 === '===' || next3 === '!==') {
      tokens.push({ type: 'OPERATOR', value: next3 });
      i += 3;
      continue;
    }

    if (['==', '!=', '<=', '>=', '&&', '||'].includes(next2)) {
      tokens.push({ type: 'OPERATOR', value: next2 });
      i += 2;
      continue;
    }

    if (['<', '>', '!'].includes(ch)) {
      tokens.push({ type: 'OPERATOR', value: ch });
      i++;
      continue;
    }

    // String literals: 'str' or "str"
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let strVal = '';
      i++;
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) {
          strVal += expr[i + 1];
          i += 2;
        } else {
          strVal += expr[i];
          i++;
        }
      }
      i++; // skip closing quote
      tokens.push({ type: 'STRING', value: strVal });
      continue;
    }

    // Numbers: 123, 45.67
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(expr[i + 1] || ''))) {
      let numStr = ch;
      i++;
      while (i < expr.length && /[0-9\.]/.test(expr[i])) {
        numStr += expr[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
      continue;
    }

    // Identifiers or paths: e.g. nodes.x.output, inputs.minScore, true, false, null
    if (/[a-zA-Z_$]/.test(ch)) {
      let idStr = ch;
      i++;
      while (i < expr.length && /[a-zA-Z0-9_$.\[\]]/.test(expr[i])) {
        idStr += expr[i];
        i++;
      }

      if (idStr === 'true') {
        tokens.push({ type: 'BOOLEAN', value: true });
      } else if (idStr === 'false') {
        tokens.push({ type: 'BOOLEAN', value: false });
      } else if (idStr === 'null' || idStr === 'undefined') {
        tokens.push({ type: 'NULL', value: null });
      } else {
        // Strip {{ }} if user passed wrapped path e.g. "{{ nodes.x.output }}"
        const cleanId = idStr.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
        tokens.push({ type: 'IDENTIFIER', value: cleanId });
      }
      continue;
    }

    // Unknown char, skip
    i++;
  }

  return tokens;
}

class ExpressionParser {
  private pos = 0;
  constructor(private tokens: Token[], private ctx: TemplateContext) {}

  parse(): boolean {
    if (this.tokens.length === 0) return true;
    const result = this.parseOr();
    return Boolean(result);
  }

  private parseOr(): any {
    let left = this.parseAnd();
    while (this.match('OPERATOR', '||')) {
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  private parseAnd(): any {
    let left = this.parseComparison();
    while (this.match('OPERATOR', '&&')) {
      const right = this.parseComparison();
      left = left && right;
    }
    return left;
  }

  private parseComparison(): any {
    const left = this.parseUnary();
    const token = this.peek();

    if (token && token.type === 'OPERATOR' && ['==', '===', '!=', '!==', '<', '<=', '>', '>='].includes(token.value)) {
      this.pos++;
      const op = token.value;
      const right = this.parseUnary();

      switch (op) {
        case '==':
        case '===':
          return left === right;
        case '!=':
        case '!==':
          return left !== right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '>':
          return left > right;
        case '>=':
          return left >= right;
      }
    }
    return left;
  }

  private parseUnary(): any {
    if (this.match('OPERATOR', '!')) {
      return !this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): any {
    const token = this.peek();
    if (!token) return undefined;

    if (token.type === 'LPAREN') {
      this.pos++;
      const val = this.parseOr();
      this.match('RPAREN');
      return val;
    }

    if (token.type === 'NUMBER' || token.type === 'STRING' || token.type === 'BOOLEAN' || token.type === 'NULL') {
      this.pos++;
      return token.value;
    }

    if (token.type === 'IDENTIFIER') {
      this.pos++;
      return evalPath(token.value, this.ctx);
    }

    this.pos++;
    return undefined;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.peek();
    if (!token || token.type !== type) return false;
    if (value !== undefined && token.value !== value) return false;
    this.pos++;
    return true;
  }
}

/**
 * Safely evaluates a boolean condition string against a context object.
 * Supports: >, <, >=, <=, ===, ==, !==, !=, &&, ||, !
 * Examples:
 *   evalCondition("nodes.plan.output.length > 0", ctx)
 *   evalCondition("nodes.check.output.valid === true && inputs.threshold >= 0.5", ctx)
 */
export function evalCondition(expr: string, ctx: TemplateContext): boolean {
  if (!expr || expr.trim() === '') return true;
  const cleanExpr = expr.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');
  try {
    const tokens = tokenize(cleanExpr);
    const parser = new ExpressionParser(tokens, ctx);
    return parser.parse();
  } catch {
    return false;
  }
}
