export interface ClarificationQuestion {
  id: string;
  question: string;
  options?: string[];
  contextKey: string;
  isAmbiguous: boolean;
}

export class ClarificationManager {
  /**
   * Assesses if prompt has critical ambiguity that requires clarification.
   * If yes, formulates exactly ONE useful question.
   */
  assessAmbiguity(prompt: string): ClarificationQuestion | null {
    const trimmed = prompt.trim();
    const lower = trimmed.toLowerCase();

    // 1. Deploy ambiguity (environment unknown)
    if (/\b(deploy|release|push to server)\b/i.test(lower) && !/\b(staging|production|prod|dev|testing)\b/i.test(lower)) {
      return {
        id: `clarify_${Date.now()}`,
        question: 'Which target environment would you like to deploy to?',
        options: ['staging', 'production', 'development'],
        contextKey: 'target_environment',
        isAmbiguous: true
      };
    }

    // 2. Ambiguous target deletion
    if (/\b(delete|cleanup|remove)\s+(the\s+)?(database|logs|files|repo)\b/i.test(lower) && !/\b(old|test|dev|scratch|specific|\.log)\b/i.test(lower)) {
      return {
        id: `clarify_${Date.now()}`,
        question: 'Which specific directory or database should be targeted for deletion?',
        options: ['scratch directory only', 'test artifacts only', 'cancel operation'],
        contextKey: 'delete_target',
        isAmbiguous: true
      };
    }

    // 3. Ambiguous model selection
    if (/\b(switch model|change provider)\b/i.test(lower) && !/\b(gemini|ollama|nvidia)\b/i.test(lower)) {
      return {
        id: `clarify_${Date.now()}`,
        question: 'Which model provider do you want to switch to?',
        options: ['gemini', 'ollama (local)', 'nvidia'],
        contextKey: 'selected_provider',
        isAmbiguous: true
      };
    }

    return null;
  }

  /**
   * Integrates the single clarification answer into the prompt context so execution can proceed autonomously.
   */
  integrateAnswer(originalPrompt: string, clarification: ClarificationQuestion, answer: string): string {
    return `${originalPrompt.trim()} [Clarification: ${clarification.contextKey}="${answer.trim()}"]`;
  }
}
