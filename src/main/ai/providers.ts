import { AIProviderId } from '@shared/types';
import { AI_PROVIDER_PRESETS } from '@shared/constants';

export interface LLMChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionRequest {
  provider: AIProviderId;
  model: string;
  apiKey: string | null;
  baseUrl?: string;
  systemPrompt: string;
  messages: LLMChatTurn[];
  maxTokens?: number;
}

export interface LLMCompletionResponse {
  text: string;
  provider: AIProviderId;
  model: string;
}

export interface ProviderModelInfo {
  id: string;
  displayName: string;
}

export interface ListModelsRequest {
  provider: AIProviderId;
  apiKey: string | null;
  baseUrl?: string;
}

type FetchFn = typeof fetch;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeGeminiModelId(model: string): string {
  return model.trim().replace(/^models\//i, '');
}

export async function listProviderModels(
  req: ListModelsRequest,
  fetchImpl: FetchFn = fetch
): Promise<ProviderModelInfo[]> {
  const preset = AI_PROVIDER_PRESETS[req.provider];
  const baseUrl = trimSlash((req.baseUrl || preset.defaultBaseUrl).trim());

  if (preset.requiresKey && (!req.apiKey || !req.apiKey.trim())) {
    throw new Error(`Add an API key for ${preset.label} to load available models.`);
  }

  // 1. Anthropic Claude Models API
  if (req.provider === 'claude') {
    const res = await fetchImpl(`${baseUrl}/v1/models?limit=100`, {
      method: 'GET',
      headers: {
        'x-api-key': req.apiKey!.trim(),
        'anthropic-version': '2023-06-01'
      }
    });
    if (!res.ok) {
      throw new Error(`Anthropic Claude models error (${res.status}): ${await parseErrorBody(res)}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ id?: string; display_name?: string }>;
    };
    return (data.data || [])
      .filter((m) => typeof m.id === 'string' && m.id.length > 0)
      .map((m) => ({ id: m.id!, displayName: m.display_name || m.id! }));
  }

  // 2. Google Gemini Models API
  if (req.provider === 'gemini') {
    const res = await fetchImpl(
      `${baseUrl}/v1beta/models?pageSize=100&key=${encodeURIComponent(req.apiKey!.trim())}`,
      { method: 'GET' }
    );
    if (!res.ok) {
      throw new Error(`Google Gemini models error (${res.status}): ${await parseErrorBody(res)}`);
    }
    const data = (await res.json()) as {
      models?: Array<{
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    const filtered = (data.models || [])
      .filter(
        (m) =>
          typeof m.name === 'string' &&
          (m.supportedGenerationMethods || []).includes('generateContent') &&
          !m.name.toLowerCase().includes('embedding') &&
          !m.name.toLowerCase().includes('aqa') &&
          !m.name.toLowerCase().includes('imagen') &&
          !m.name.toLowerCase().includes('veo')
      )
      .map((m) => {
        const id = normalizeGeminiModelId(m.name!);
        return { id, displayName: m.displayName || id };
      });

    // Prefer newest Gemini flash/pro models first
    filtered.sort((a, b) => {
      const score = (id: string) => {
        const lower = id.toLowerCase();
        let s = 0;
        if (lower.startsWith('gemini-')) s += 100;
        if (lower.includes('flash')) s += 20;
        if (lower.includes('pro')) s += 15;
        if (lower.includes('exp') || lower.includes('preview')) s -= 5;
        return s;
      };
      const diff = score(b.id) - score(a.id);
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });
    return filtered;
  }

  // 3. OpenAI & OpenAI-Compatible Models API
  if (req.provider === 'openai') {
    const res = await fetchImpl(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${req.apiKey!.trim()}`
      }
    });
    if (!res.ok) {
      throw new Error(`OpenAI models error (${res.status}): ${await parseErrorBody(res)}`);
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data || [])
      .filter((m) => typeof m.id === 'string' && m.id.length > 0)
      .filter((m) => !/embedding|whisper|tts|dall-e|moderation/i.test(m.id!))
      .map((m) => ({ id: m.id!, displayName: m.id! }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  // 4. Local Ollama Tags API
  const res = await fetchImpl(`${baseUrl}/api/tags`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Ollama models error (${res.status}): ${await parseErrorBody(res)}`);
  }
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return (data.models || [])
    .filter((m) => typeof m.name === 'string' && m.name.length > 0)
    .map((m) => ({ id: m.name!, displayName: m.name! }));
}

async function parseErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      if (typeof json.error === 'string') return json.error;
      if (json.error?.message) return json.error.message;
      if (json.message) return json.message;
    } catch {
      // Fall through to raw text
    }
    return text.slice(0, 300) || res.statusText;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export async function runLLMCompletion(
  req: LLMCompletionRequest,
  fetchImpl: FetchFn = fetch
): Promise<LLMCompletionResponse> {
  const preset = AI_PROVIDER_PRESETS[req.provider];
  const model = (req.model || preset.defaultModel).trim();
  const baseUrl = trimSlash((req.baseUrl || preset.defaultBaseUrl).trim());
  const maxTokens = req.maxTokens ?? 2400;

  if (preset.requiresKey && (!req.apiKey || !req.apiKey.trim())) {
    throw new Error(`Missing API key for ${preset.label}. Add your key in AI Insights or Settings.`);
  }

  // 1. Anthropic Claude Messages API
  if (req.provider === 'claude') {
    const url = `${baseUrl}/v1/messages`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': req.apiKey!.trim(),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: req.systemPrompt,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content }))
      })
    });

    if (!res.ok) {
      throw new Error(`Anthropic Claude error (${res.status}): ${await parseErrorBody(res)}`);
    }

    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (data.content || [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!text) throw new Error('Anthropic Claude returned an empty response.');
    return { text, provider: req.provider, model };
  }

  // 2. Google Gemini API
  if (req.provider === 'gemini') {
    const cleanModel = normalizeGeminiModelId(model);
    const encodedModel = encodeURIComponent(cleanModel);
    const url = `${baseUrl}/v1beta/models/${encodedModel}:generateContent?key=${encodeURIComponent(req.apiKey!.trim())}`;

    const callGemini = (useSystemInstruction: boolean) => {
      const contents = req.messages.map((m, idx) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          {
            text:
              !useSystemInstruction && idx === 0
                ? `${req.systemPrompt}\n\n---\n\n${m.content}`
                : m.content
          }
        ]
      }));
      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.35
        }
      };
      if (useSystemInstruction) {
        body.systemInstruction = { parts: [{ text: req.systemPrompt }] };
      }
      return fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    };

    let res = await callGemini(true);
    if (!res.ok && res.status === 400) {
      const errMsg = await parseErrorBody(res);
      if (/developer instruction|system.?instruction/i.test(errMsg)) {
        res = await callGemini(false);
      } else {
        throw new Error(`Google Gemini error (${res.status}): ${errMsg}`);
      }
    }

    if (!res.ok) {
      throw new Error(`Google Gemini error (${res.status}): ${await parseErrorBody(res)}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('\n')
      .trim();

    if (!text) throw new Error('Google Gemini returned an empty response.');
    return { text, provider: req.provider, model };
  }

  // 3. OpenAI & OpenAI-Compatible API
  if (req.provider === 'openai') {
    const url = `${baseUrl}/v1/chat/completions`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${req.apiKey!.trim()}`
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.35,
        messages: [
          { role: 'system', content: req.systemPrompt },
          ...req.messages.map((m) => ({ role: m.role, content: m.content }))
        ]
      })
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error (${res.status}): ${await parseErrorBody(res)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('OpenAI API returned an empty response.');
    return { text, provider: req.provider, model };
  }

  // 4. Local Ollama API
  const url = `${baseUrl}/api/chat`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...req.messages.map((m) => ({ role: m.role, content: m.content }))
      ]
    })
  });

  if (!res.ok) {
    throw new Error(`Ollama error (${res.status}): ${await parseErrorBody(res)}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const text = (data.message?.content || '').trim();
  if (!text) throw new Error('Ollama returned an empty response.');
  return { text, provider: req.provider, model };
}
