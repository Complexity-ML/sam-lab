const agentActivityTerms = /\b(agent|autonomous|player|proposal|review|controller|iteration|graph|catalog|monitor|checkpoint|atomic|incident|gpt|chatgpt|claude|kimi|model)\b/i

/**
 * The Actions panel is intentionally narrower than the complete Live log, but
 * it must retain every lifecycle message that can replace a scheduled step.
 * Otherwise a completed "Graph is current" turn appears permanently stuck on
 * the older "iteration scheduled" entry.
 */
export function isAgentActionActivity(message: string) {
  return agentActivityTerms.test(message)
}
