import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { listProviderModels, runLLMCompletion } from '@main/ai/providers';
import {
  buildAugmentedPath,
  buildLocalCliPrompt,
  listLocalCliModels,
  parseAgyModelsOutput,
  parseLocalCliOutput,
  resolveCliBinary,
  runLocalCliCompletion
} from '@main/ai/localCli';

function mockResponse(body: unknown, ok = true, status = 200, headers?: Record<string, string>): Response {
  const lowerHeaders = new Map(
    Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: {
      get: (name: string) => lowerHeaders.get(name.toLowerCase()) ?? null
    },
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

  it('retries transient Gemini 429 rate limits once and surfaces actionable error for limit: 0 free-tier models', async () => {
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    // 1. Transient burst 429 with short retryDelay succeeds on retry
    const retryFetch = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(
          {
            error: {
              message: 'Resource exhausted, please retry in 2s',
              details: [{ retryDelay: '2s' }]
            }
          },
          false,
          429
        )
      )
      .mockResolvedValueOnce(
        mockResponse({ candidates: [{ content: { parts: [{ text: 'Recovered after 429' }] } }] })
      );

    const okRes = await runLLMCompletion(
      {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'AIzaTestKey',
        systemPrompt: 'Sys',
        messages: [{ role: 'user', content: 'Review holdings' }]
      },
      retryFetch as unknown as typeof fetch,
      sleepMock
    );
    expect(okRes.text).toBe('Recovered after 429');
    expect(retryFetch).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(2000);

    // 2. Zero free-tier quota (limit: 0) fails fast without sleeping and recommends Local AI CLI
    const zeroQuotaFetch = vi.fn().mockResolvedValue(
      mockResponse(
        {
          error: {
            message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0'
          }
        },
        false,
        429
      )
    );
    sleepMock.mockClear();
    await expect(
      runLLMCompletion(
        {
          provider: 'gemini',
          model: 'gemini-2.5-pro',
          apiKey: 'AIzaTestKey',
          systemPrompt: 'Sys',
          messages: [{ role: 'user', content: 'Review holdings' }]
        },
        zeroQuotaFetch as unknown as typeof fetch,
        sleepMock
      )
    ).rejects.toThrow(/0 free-tier quota.*Local AI CLI/i);
    expect(zeroQuotaFetch).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });
});

describe('Local AI CLI Provider (agy, gemini, codex, claude)', () => {
  it('resolves CLI binaries from augmented user & nvm bin paths cleanly', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-path-test-'));
    try {
      const localBin = path.join(tmpHome, '.local', 'bin');
      const nvmBin = path.join(tmpHome, '.nvm', 'versions', 'node', 'v22.14.0', 'bin');
      fs.mkdirSync(localBin, { recursive: true });
      fs.mkdirSync(nvmBin, { recursive: true });

      const agyBin = path.join(localBin, 'agy');
      const geminiBin = path.join(nvmBin, 'gemini');
      fs.writeFileSync(agyBin, '#!/bin/sh\necho ok\n', { mode: 0o755 });
      fs.writeFileSync(geminiBin, '#!/bin/sh\necho ok\n', { mode: 0o755 });

      const augmented = buildAugmentedPath({
        currentPath: '/usr/bin:/bin',
        homeDir: tmpHome,
        platform: 'darwin'
      });
      expect(augmented).toContain(localBin);
      expect(augmented).toContain(nvmBin);

      expect(resolveCliBinary('agy', undefined, { currentPath: '/usr/bin:/bin', homeDir: tmpHome, platform: 'darwin' })).toBe(agyBin);
      expect(resolveCliBinary('gemini', undefined, { currentPath: '/usr/bin:/bin', homeDir: tmpHome, platform: 'darwin' })).toBe(geminiBin);
      expect(resolveCliBinary('agy', '~/.local/bin/agy', { currentPath: '', homeDir: tmpHome, platform: 'darwin' })).toBe(agyBin);
      expect(resolveCliBinary('codex', undefined, { currentPath: '/usr/bin:/bin', homeDir: tmpHome, platform: 'darwin' })).toBeNull();
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('invokes agy CLI via stream-json stdin/stdout with sandbox flags and parses result event', async () => {
    const execMock = vi.fn().mockResolvedValue({
      stdout: [
        '{"event":"init","conversation_id":"conv-1"}',
        '{"event":"text_delta","delta":"## Portfolio Summary"}',
        '{"event":"result","result":{"status":"SUCCESS","response":"## Portfolio Summary\\nStrong allocation."}}'
      ].join('\n') + '\n',
      stderr: '',
      exitCode: 0,
      timedOut: false
    });

    const res = await runLocalCliCompletion(
      {
        cliTool: 'agy',
        model: 'gemini-3.8-pro',
        systemPrompt: 'You are a portfolio analyst.',
        messages: [
          {
            role: 'user',
            content: 'Analyze my SIP runway.',
            attachments: [
              { fileName: 'policy.pdf', mimeType: 'application/pdf', extractedText: 'Sum Assured 1 Cr' }
            ]
          }
        ]
      },
      execMock,
      () => '/usr/local/bin/agy'
    );

    expect(res.text).toBe('## Portfolio Summary\nStrong allocation.');
    expect(res.model).toBe('agy:gemini-3.8-pro');
    expect(execMock).toHaveBeenCalledTimes(1);

    const call = execMock.mock.calls[0][0];
    expect(call.command).toBe('/usr/local/bin/agy');
    expect(call.args).toContain('--model');
    expect(call.args).toContain('gemini-3.8-pro');
    expect(call.args).toContain('--input-format');
    expect(call.args).toContain('--output-format');
    expect(call.args).toContain('stream-json');
    expect(call.args).toContain('--disable-slash-commands');
    expect(call.args).toContain('--sandbox');
    expect(call.args).not.toContain('-p');
    // Sensitive portfolio context must go over NDJSON stdin, NOT argv
    expect(call.args.join(' ')).not.toContain('Analyze my SIP runway.');
    const ndjsonPayload = JSON.parse(call.stdin.trim()) as { event: string; message: { content: string } };
    expect(ndjsonPayload.event).toBe('user');
    expect(ndjsonPayload.message.content).toContain('You are a portfolio analyst.');
    expect(ndjsonPayload.message.content).toContain('Sum Assured 1 Cr');
    expect(ndjsonPayload.message.content).toContain('Analyze my SIP runway.');
    expect(typeof call.closeStdinWhen).toBe('function');
    expect(call.closeStdinWhen('{"event":"init"}\n')).toBe(false);
    expect(call.closeStdinWhen('{"event":"init"}\n{"event":"result","result":{"status":"SUCCESS"}}\n')).toBe(true);
  });

  it('invokes gemini, codex (with --output-last-message), and claude (with unknown-option retry)', async () => {
    // 1. Gemini CLI
    const geminiExec = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ response: 'Gemini CLI response', error: null }),
      stderr: '',
      exitCode: 0,
      timedOut: false
    });
    const gemRes = await runLocalCliCompletion(
      {
        cliTool: 'gemini',
        model: 'default',
        systemPrompt: 'Sys',
        messages: [{ role: 'user', content: 'Check FDs' }]
      },
      geminiExec,
      () => '/opt/bin/gemini'
    );
    expect(gemRes.text).toBe('Gemini CLI response');
    expect(gemRes.model).toBe('gemini:default');
    expect(geminiExec.mock.calls[0][0].args).not.toContain('-m');

    // 2. Codex CLI writes final answer to --output-last-message file
    const codexExec = vi.fn().mockImplementation(async (opts) => {
      const outIdx = opts.args.indexOf('--output-last-message');
      expect(outIdx).toBeGreaterThan(0);
      expect(opts.args).toContain('--skip-git-repo-check');
      expect(opts.args).toContain('--sandbox');
      expect(opts.args).toContain('read-only');
      expect(opts.args[opts.args.length - 1]).toBe('-');
      fs.writeFileSync(opts.args[outIdx + 1], 'Codex clean final message', 'utf-8');
      return { stdout: 'verbose log', stderr: '', exitCode: 0, timedOut: false };
    });
    const codexRes = await runLocalCliCompletion(
      {
        cliTool: 'codex',
        model: 'gpt-5-codex',
        systemPrompt: 'Sys',
        messages: [{ role: 'user', content: 'Check allocation' }]
      },
      codexExec,
      () => '/opt/bin/codex'
    );
    expect(codexRes.text).toBe('Codex clean final message');
    expect(codexRes.model).toBe('codex:gpt-5-codex');

    // 3. Claude CLI retries cleanly when older CLI rejects --tools
    const claudeExec = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: '',
        stderr: 'error: unknown option --tools',
        exitCode: 1,
        timedOut: false
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ result: 'Claude CLI response', is_error: false }),
        stderr: '',
        exitCode: 0,
        timedOut: false
      });
    const claudeRes = await runLocalCliCompletion(
      {
        cliTool: 'claude',
        model: 'sonnet',
        systemPrompt: 'Sys',
        messages: [{ role: 'user', content: 'Review risks' }]
      },
      claudeExec,
      () => '/opt/bin/claude'
    );
    expect(claudeRes.text).toBe('Claude CLI response');
    expect(claudeExec).toHaveBeenCalledTimes(2);
    expect(claudeExec.mock.calls[0][0].args).toContain('--tools');
    expect(claudeExec.mock.calls[1][0].args).not.toContain('--tools');
  });

  it('parses agy models output (full names with effort parens & slug tables), always keeps CLI Default first, and handles multi-turn prompt formatting', async () => {
    const humanModels = parseAgyModelsOutput(`
Available models:
  Gemini Pro (High)
  Gemini Pro (Medium)
  Gemini Flash (Low) (default)
  * Claude Sonnet (High) [current]
  GPT-OSS 120B (Medium)
    `);
    expect(humanModels.map((m) => m.id)).toEqual([
      'default',
      'Gemini Pro (High)',
      'Gemini Pro (Medium)',
      'Gemini Flash (Low)',
      'Claude Sonnet (High)',
      'GPT-OSS 120B (Medium)'
    ]);
    // Effort labels like "Low" / "Medium" / "High" must NEVER be parsed as standalone model IDs
    expect(humanModels.map((m) => m.id)).not.toContain('Low');
    expect(humanModels.map((m) => m.id)).not.toContain('Medium');
    expect(humanModels.map((m) => m.id)).not.toContain('High');

    const slugModels = parseAgyModelsOutput(`
      MODEL                       DESCRIPTION
      gemini-3.8-pro              Frontier reasoning
      * claude-sonnet-4-6         Balanced coding & analysis
      Gemini Flash (gemini-3.8-flash)
    `);
    expect(slugModels[0]).toEqual({ id: 'default', displayName: 'CLI Default (Recommended)' });
    expect(slugModels.map((m) => m.id)).toContain('gemini-3.8-pro');
    expect(slugModels.map((m) => m.id)).toContain('claude-sonnet-4-6');
    expect(slugModels.map((m) => m.id)).toContain('gemini-3.8-flash');

    const liveList = await listLocalCliModels(
      'agy',
      undefined,
      vi.fn().mockResolvedValue({
        stdout: JSON.stringify([{ id: 'gemini-3.8-pro', displayName: 'Gemini 3.8 Pro' }]),
        stderr: '',
        exitCode: 0,
        timedOut: false
      }),
      () => '/usr/local/bin/agy'
    );
    expect(liveList).toEqual([
      { id: 'default', displayName: 'CLI Default (Recommended)' },
      { id: 'gemini-3.8-pro', displayName: 'Gemini 3.8 Pro' }
    ]);

    const multiTurn = buildLocalCliPrompt('System prompt', [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Check emergency cushion' }
    ]);
    expect(multiTurn).toContain('<system_instructions>');
    expect(multiTurn).toContain('<conversation>');
    expect(multiTurn).toContain('Assistant:\nHello!');
    expect(multiTurn).toContain('Check emergency cushion');

    expect(parseLocalCliOutput('agy', '{"status":"ERROR","error":"Not logged in"}').errorMessage).toBe('Not logged in');
  });
});
