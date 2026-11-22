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

export const AI_KEY_GUIDELINES: Record<
  'claude' | 'gemini' | 'openai' | 'ollama',
  { title: string; steps: string[]; tip: string }
> = {
  gemini: {
    title: 'How to get a Google Gemini API Key (Free Tier Available)',
    steps: [
      'Open Google AI Studio (aistudio.google.com/apikey) and sign in with your Google account.',
      'Click "Create API key" and select or create a Google Cloud project.',
      'Copy the key starting with "AIza..." and paste it into the API Key box above.'
    ],
    tip: 'Tip: On the free tier, choose a fast Flash model (e.g. gemini-3.8-flash or gemini-2.5-flash) rather than Pro models which often have 0 free-tier quota.'
  },
  claude: {
    title: 'How to get an Anthropic Claude API Key',
    steps: [
      'Sign in at console.anthropic.com/settings/keys (separate from a claude.ai web subscription).',
      'Add a small API credit balance under Billing (e.g. $5 lasts hundreds of portfolio reviews).',
      'Click "Create Key", copy the key starting with "sk-ant-...", and paste it above.'
    ],
    tip: 'Tip: Claude Sonnet models give the best balance of financial reasoning depth and low cost per review.'
  },
  openai: {
    title: 'How to get an OpenAI (or OpenRouter / Groq) API Key',
    steps: [
      'Sign in at platform.openai.com/api-keys and add API credits under Billing.',
      'Click "Create new secret key", copy the "sk-..." key, and paste it above.',
      'For OpenRouter, Groq, or LM Studio, enter their Base URL in the optional Base URL field below.'
    ],
    tip: 'Tip: gpt-4o-mini is very inexpensive for frequent Q&A chat; gpt-4o is great for comprehensive reviews.'
  },
  ollama: {
    title: 'How to run Local Ollama (100% Offline & Free)',
    steps: [
      'Install Ollama from ollama.com on your Mac or Windows PC.',
      'Run "ollama pull llama3.1:8b" (or "qwen2.5:14b") in Terminal.',
      'Keep Ollama running in the background and click Refresh to detect your local models.'
    ],
    tip: 'Tip: Zero API cost and zero portfolio data ever leaves your computer.'
  }
};

export const STRATEGY_TEMPLATES: Array<{
  id: string;
  name: string;
  summary: string;
  markdown: string;
}> = [
  {
    id: 'salaried-sip',
    name: 'Salaried Growth & SIP Accumulator',
    summary: 'Automated monthly/weekly SIPs, 6-month emergency cushion, milestone EMI planning',
    markdown: `# My Portfolio Strategy & Goals

## Investor Profile & Cashflow
- **Horizon:** 10+ years (long-term wealth compounding)
- **Risk Appetite:** Moderate-to-High
- **Tax Regime:** New Tax Regime

## Liquidity & Protection Rules
- **Emergency Cushion:** Maintain 6+ months of mandatory expenses in Arbitrage / Liquid MFs + Savings Account.
- **Insurance Guardrail:** Term life cover >= 10–15x annual income + comprehensive family floater health insurance.

## Equity & SIP Discipline
- **Core Equity:** Diversified Flexi Cap + Large/Index funds + select high-conviction direct equities.
- **Satellite Alpha:** Mid-cap & Small-cap SIPs kept within 25–35% of equity exposure.
- **Hedge:** Maintain 5–10% in Gold (Physical / SGBs / Gold ETF).

## Upcoming Milestones (Next 1–3 Years)
- *Example: Home down payment or EMI start — adjust monthly SIPs down rather than liquidating core compounding equity.*
`
  },
  {
    id: 'lumpsum-direct',
    name: 'Direct Equity, SGB & Lump-Sum Investor',
    summary: 'Direct stocks + Sovereign Gold Bonds + tactical rebalancing without mandatory SIPs',
    markdown: `# Direct Equity & SGB Portfolio Strategy

## Investment Style
- **Deployment Style:** Opportunistic lump-sum investments in direct Indian stocks, ETFs, and SGBs (no fixed SIP obligation).
- **Risk Appetite:** High (comfortable with 15–20% drawdowns in quality businesses).

## Position Sizing & Rebalancing Rules
- **Single-Stock Cap:** Trim or review any single equity exceeding 12–15% of total equity value.
- **Drawdown Review:** Re-evaluate thesis when a stock drops >20% below average cost (check earnings quality vs. temporary sector cycle).
- **SGB & Bond Ladder:** Hold Sovereign Gold Bonds until 8-year tax-free maturity; use NCDs/debt only from AA+/AAA issuers.
- **Tax-Loss Harvesting:** Offset realized short-term/long-term gains before March 31 by exiting broken-thesis laggards.

## Goals & Watchlist
- *List target sectors to add or legacy positions you plan to consolidate.*
`
  },
  {
    id: 'conservative-family',
    name: 'Family Protection & Capital Stability',
    summary: 'Balanced 50:50 equity-debt allocation, strong insurance coverage, low volatility',
    markdown: `# Family Protection & Balanced Wealth Strategy

## Core Objectives
- **Priority 1:** Capital preservation and predictable cashflow for family milestones (education, healthcare, retirement).
- **Target Asset Mix:** ~50% Equity (Large-Cap / Index / Flexi Cap) · ~40% Debt (PPF, EPF, SGBs, Debt/Arbitrage MFs) · ~10% Gold & Cash.

## Risk Guardrails
- Avoid speculative micro-caps, leverage/F&O, and illiquid lock-in products (avoid high-commission ULIPs / low-IRR endowments unless justified).
- Keep 12 months of household expenses liquid in Arbitrage/Liquid funds or Sweep FDs.
- Review health & term insurance coverage annually.

## Upcoming Family Milestones
- *Add target dates and required amounts (e.g., child education, home upgrade, parents' medical buffer).*
`
  },
  {
    id: 'goal-fire',
    name: 'Goal-Based / Early Retirement (FIRE)',
    summary: 'Corpus multiplier target, asset glide path, withdrawal & tax efficiency',
    markdown: `# Goal-Based Financial Independence Strategy

## Target Corpus & Timeline
- **Target FI Corpus:** *e.g., 30x annual expenses (₹X Cr)*
- **Target Horizon:** *e.g., 8–12 years*
- **Current Savings Rate:** *e.g., 45% of post-tax income*

## Asset Allocation Glide Path
- **Accumulation Phase:** 70–75% Equity (India + 10–15% International ETFs/Global Funds), 15–20% Debt/PPF/Bonds, 5–10% Gold/SGB.
- **Pre-FI Buffer (3 years before target):** Gradually build a 3-year living expense bucket in Arbitrage/Debt funds to avoid sequence-of-returns risk.

## Portfolio Hygiene Rules
- Consolidate overlapping mutual funds (keep <= 6–8 core funds).
- Prefer Direct plans over Regular plans to save 0.5%–1.0% annual expense ratio drag.
`
  }
];
