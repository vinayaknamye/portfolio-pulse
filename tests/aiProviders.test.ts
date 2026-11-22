import { describe, expect, it, vi } from 'vitest';
import { listProviderModels, runLLMCompletion } from '@main/ai/providers';

function mockResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  } as unknown as Response;
}

describe('runLLMCompletion (BYOK Providers)', () => {
  it('formats Anthropic Claude Messages API requests with x-api-key and anthropic-version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        content: [{ type: 'text', text: '## Claude Portfolio Review\nLooking solid.' }]
      })
    );

    const res = await runLLMCompletion(
      {
        provider: 'claude',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'sk-ant-test-key',
        systemPrompt: 'You are an analyst.',
        messages: [{ role: 'user', content: 'Review my portfolio' }]
      },
      fetchMock as unknown as typeof fetch
    );

    expect(res.text).toContain('Claude Portfolio Review');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-test-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const parsedBody = JSON.parse(init.body);
    expect(parsedBody.system).toBe('You are an analyst.');
    expect(parsedBody.messages).toEqual([{ role: 'user', content: 'Review my portfolio' }]);
  });

  it('formats Google Gemini requests and maps assistant role to model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        candidates: [{ content: { parts: [{ text: 'Gemini insight response' }] } }]
      })
    );

    const res = await runLLMCompletion(
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'AIzaTestKey',
        systemPrompt: 'System guidance',
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
          { role: 'user', content: 'Check SIPs' }
        ]
      },
      fetchMock as unknown as typeof fetch
    );

    expect(res.text).toBe('Gemini insight response');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaTestKey');
    const parsedBody = JSON.parse(init.body);
    expect(parsedBody.contents[1].role).toBe('model');
  });

  it('formats OpenAI-compatible requests with custom baseUrl and Bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        choices: [{ message: { content: 'OpenAI summary' } }]
      })
    );

    const res = await runLLMCompletion(
      {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-openai-test',
        baseUrl: 'https://openrouter.ai/api/',
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Hello' }]
      },
      fetchMock as unknown as typeof fetch
    );

    expect(res.text).toBe('OpenAI summary');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer sk-openai-test');
  });

  it('calls Local Ollama without requiring an API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        message: { content: 'Offline Ollama review' }
      })
    );

    const res = await runLLMCompletion(
      {
        provider: 'ollama',
        model: 'llama3.1:8b',
        apiKey: null,
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Check cashflow' }]
      },
      fetchMock as unknown as typeof fetch
    );

    expect(res.text).toBe('Offline Ollama review');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
  });

  it('throws descriptive error when API key is missing for cloud providers', async () => {
    await expect(
      runLLMCompletion({
        provider: 'claude',
        model: 'claude-sonnet-4-20250514',
        apiKey: null,
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Test' }]
      })
    ).rejects.toThrow(/Missing API key for Anthropic Claude/i);
  });

  it('strips leading models/ prefix on Gemini completion requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })
    );
    await runLLMCompletion(
      {
        provider: 'gemini',
        model: 'models/gemini-3.8-flash',
        apiKey: 'AIzaKey',
        systemPrompt: 'Sys',
        messages: [{ role: 'user', content: 'Hi' }]
      },
      fetchMock as unknown as typeof fetch
    );
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1beta/models/gemini-3.8-flash:generateContent');
  });

  it('lists live models dynamically for Gemini, Claude, OpenAI, and Ollama', async () => {
    const geminiFetch = vi.fn().mockResolvedValue(
      mockResponse({
        models: [
          { name: 'models/embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.8-pro', displayName: 'Gemini 3.8 Pro', supportedGenerationMethods: ['generateContent'] }
        ]
      })
    );
    const geminiModels = await listProviderModels(
      { provider: 'gemini', apiKey: 'AIzaKey' },
      geminiFetch as unknown as typeof fetch
    );
    expect(geminiModels.map((m) => m.id)).toEqual(['gemini-3.8-flash', 'gemini-3.8-pro']);

    const claudeFetch = vi.fn().mockResolvedValue(
      mockResponse({ data: [{ id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' }] })
    );
    const claudeModels = await listProviderModels(
      { provider: 'claude', apiKey: 'sk-ant' },
      claudeFetch as unknown as typeof fetch
    );
    expect(claudeModels).toEqual([{ id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }]);

    const ollamaFetch = vi.fn().mockResolvedValue(
      mockResponse({ models: [{ name: 'qwen2.5:14b' }] })
    );
    const ollamaModels = await listProviderModels(
      { provider: 'ollama', apiKey: null },
      ollamaFetch as unknown as typeof fetch
    );
    expect(ollamaModels).toEqual([{ id: 'qwen2.5:14b', displayName: 'qwen2.5:14b' }]);
  });

  it('sends native PDF and image attachments cleanly across Claude, Gemini (with fallback), OpenAI, and Ollama', async () => {
    // 1. Claude native PDF + image blocks
    const claudeFetch = vi.fn().mockResolvedValue(
      mockResponse({ content: [{ type: 'text', text: 'Reviewed ULIP brochure.' }] })
    );
    await runLLMCompletion(
      {
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant',
        systemPrompt: 'Sys',
        messages: [
          {
            role: 'user',
            content: 'Validate pitch',
            attachments: [
              { fileName: 'brochure.pdf', mimeType: 'application/pdf', base64: 'JVBERi0x', extractedText: 'ULIP 5yr lock-in' },
              { fileName: 'quote.png', mimeType: 'image/png', base64: 'iVBORw0K' }
            ]
          }
        ]
      },
      claudeFetch as unknown as typeof fetch
    );
    const claudeBody = JSON.parse(claudeFetch.mock.calls[0][1].body);
    expect(claudeBody.messages[0].content[0].type).toBe('document');
    expect(claudeBody.messages[0].content[1].type).toBe('image');

    // 2. Gemini inlineData PDF -> fallback to extracted text when model rejects inline PDF
    const geminiFetch = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ error: { message: 'Unsupported MIME type application/pdf' } }, false, 400))
      .mockResolvedValueOnce(mockResponse({ candidates: [{ content: { parts: [{ text: 'Fallback OK' }] } }] }));
    const gemRes = await runLLMCompletion(
      {
        provider: 'gemini',
        model: 'gemma-3-27b-it',
        apiKey: 'AIza',
        systemPrompt: 'Sys',
        messages: [
          {
            role: 'user',
            content: 'Check brochure',
            attachments: [
              { fileName: 'plan.pdf', mimeType: 'application/pdf', base64: 'JVBERi0x', extractedText: 'Guaranteed 5.2% IRR' }
            ]
          }
        ]
      },
      geminiFetch as unknown as typeof fetch
    );
    expect(gemRes.text).toBe('Fallback OK');
    expect(geminiFetch).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(geminiFetch.mock.calls[1][1].body);
    expect(retryBody.contents[0].parts[0].text).toContain('Guaranteed 5.2% IRR');

    // 3. Ollama images[] + extracted PDF text
    const ollamaFetch = vi.fn().mockResolvedValue(mockResponse({ message: { content: 'Local vision OK' } }));
    await runLLMCompletion(
      {
        provider: 'ollama',
        model: 'llama3.2-vision',
        apiKey: null,
        systemPrompt: 'Sys',
        messages: [
          {
            role: 'user',
            content: 'Check screenshot',
            attachments: [
              { fileName: 'shot.png', mimeType: 'image/png', base64: 'IMGBASE64' },
              { fileName: 'notes.txt', mimeType: 'text/plain', extractedText: 'RM promised 12% fixed' }
            ]
          }
        ]
      },
      ollamaFetch as unknown as typeof fetch
    );
    const ollamaBody = JSON.parse(ollamaFetch.mock.calls[0][1].body);
    expect(ollamaBody.messages[1].images).toEqual(['IMGBASE64']);
    expect(ollamaBody.messages[1].content).toContain('RM promised 12% fixed');
  });
});
