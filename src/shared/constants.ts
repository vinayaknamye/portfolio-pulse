export const MCP_ENDPOINTS = {
  indmoney: 'https://mcp.indmoney.com/mcp',
  upstox: 'https://mcp.upstox.com/mcp'
} as const;

export const OAUTH_CALLBACK_PORTS = {
  indmoney: 32135,
  upstox: 24807
} as const;

export const DEFAULT_USER_PROFILE = {
  displayName: 'Investor',
  monthlyIncome: 0,
  emergencyTarget: 500000,
  idleMarginThreshold: 5000,
  drawdownThresholdPct: -15,
  concentrationThresholdPct: 15,
  discrepancyQtyThreshold: 0.05,
  discrepancyValueThreshold: 500,
  dailySyncTime: '21:30',
  enableDailySync: true,
  enableNotifications: true,
  launchAtLogin: false,
  aiSchedule: 'manual' as const,
  aiProvider: 'claude' as const,
  aiModel: 'claude-sonnet-4-20250514',
  aiBaseUrl: '',
  theme: 'dark' as const,
  strategyMarkdown: `# My Portfolio Strategy & Goals

## Financial Objectives
- **Primary Goals:** Long-term wealth compounding, emergency fund stability, and major milestone planning.
- **Risk Appetite:** Moderate-to-High (long equity horizon).

## Cashflow & SIP Rules
- **Emergency Buffer Target:** Keep at least 6 months of fixed expenses in Arbitrage/Liquid MFs + Savings Account.
- **SIP Discipline:** Maintain automated weekly/monthly equity SIPs; step down temporarily only if a major EMI starts.

## Upcoming Milestones & Constraints
- *Add upcoming milestones here (e.g., home loan, tax regime considerations, insurance coverage, debt prepayment plans).*
`
};

export const AI_PROVIDER_PRESETS = {
  claude: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'],
    requiresKey: true,
    defaultBaseUrl: 'https://api.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys'
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-3.8-flash',
    models: ['gemini-3.8-flash', 'gemini-3.8-pro'],
    requiresKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  openai: {
    label: 'OpenAI / Compatible',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini'],
    requiresKey: true,
    defaultBaseUrl: 'https://api.openai.com',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  ollama: {
    label: 'Local Ollama (Offline)',
    defaultModel: 'llama3.1:8b',
    models: ['llama3.1:8b', 'qwen2.5:14b'],
    requiresKey: false,
    defaultBaseUrl: 'http://127.0.0.1:11434',
    keyUrl: ''
  }
} as const;

export const NON_ADVISORY_DISCLAIMER =
  'Portfolio Pulse is a local-first analytics, multi-broker reconciliation, and rule-based audit tool. It is NOT a SEBI-registered Investment Adviser (IA). Deterministic alerts and optional BYOK AI insights are for informational and educational purposes only—always verify decisions independently or consult a SEBI-registered adviser.';
