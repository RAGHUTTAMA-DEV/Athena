import { Tool } from '../core/types.js';

export const calculateTool: Tool = {
  definition: {
    name: 'calculate',
    description: 'Evaluate a basic mathematical expression (addition, subtraction, multiplication, division, parentheses).',
    parameters: {
      type: 'OBJECT',
      properties: {
        expression: {
          type: 'STRING',
          description: 'The math expression to evaluate, e.g. "(45 * 2) + 15". Only digits, spaces, and operators +, -, *, /, (, ) are allowed.'
        }
      },
      required: ['expression']
    }
  },
  execute: async (args: { expression: string }) => {
    const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
    try {
      // Safe evaluation of mathematical arithmetic
      const result = new Function(`return (${sanitized})`)();
      return { success: true, result };
    } catch (err: any) {
      return { success: false, error: `Failed to evaluate expression: ${err.message}` };
    }
  }
};
