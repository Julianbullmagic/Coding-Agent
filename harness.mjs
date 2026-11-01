// harness.mjs — a small local DeepSeek agent with real shell access.
//
// Usage:
//   export DEEPSEEK_API_KEY=sk-...
//   node harness.mjs "package this extension and back it up to GitHub"
//
// This mirrors the tool loop of CodingAgent.provideSuggestions (see src/agent.ts),
// but runs *on your machine* so its `run_command` tool can actually execute
// node/npm/docker/gh. It is not tied to VS Code.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(exec);

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error('DEEPSEEK_API_KEY is not set. Export it before running.');
  process.exit(1);
}

const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

// NOTE: the chat/completions endpoint only accepts type 'function' tools.
// The Responses API (used by src/agent.ts) supports 'web_search', but
// chat/completions does NOT — hence no web_search tool here.
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command in the current working directory and return stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
          timeoutMs: {
            type: 'number',
            description: 'Optional timeout in milliseconds (default 300000).'
          }
        },
        required: ['command']
      }
    }
  }
];

const SYSTEM = `You are a coding agent running on the user's machine with direct shell access.
You may call the run_command tool to execute commands (npm, node, git, gh, docker, npx, etc.).
Prefer non-interactive/safe flags (e.g. --yes for npx). Verify each step's output before proceeding.
When packaging and pushing to GitHub, run the necessary git/gh commands yourself.`;

async function chatRequest(messages, tools) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools,
      stream: false
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${text}`);
  }
  return res.json();
}

function toolCallArgument(name, argsJSON) {
  try {
    return JSON.parse(argsJSON);
  } catch (e) {
    throw new Error(`Tool ${name} returned invalid JSON: ${e.message}`);
  }
}

async function executeTool(name, args) {
  switch (name) {
    case 'run_command': {
      const cmd = String(args.command || '');
      const timeoutMs = Number(args.timeoutMs || 300000);
      const cap = 200_000;
      try {
        const { stdout, stderr } = await run(cmd, {
          cwd: process.cwd(),
          timeout: timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
          shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
        });
        let out = (stdout || '') + (stderr || '');
        if (out.length > cap) out = out.slice(0, cap) + '\n…[truncated]';
        return out || '(no output)';
      } catch (err) {
        const out = (err.stdout || '') + (err.stderr || '') + (err.message || '');
        return `command failed (exit ${err.code ?? 'unknown'}):\n${out.slice(0, cap)}`;
      }
    }
    default:
      return `Unknown/unsupported tool: ${name}`;
  }
}

function getText(completion) {
  const msg = completion?.choices?.[0]?.message;
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('');
  }
  return '';
}

async function main() {
  const task = process.argv.slice(2).join(' ').trim();
  if (!task) {
    console.error('Usage: node harness.mjs "<task>"');
    process.exit(1);
  }

  let messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: task }
  ];

  // Loop until the model stops asking for tools (max 20 rounds).
  for (let round = 0; round < 20; round++) {
    const data = await chatRequest(messages, TOOLS);
    const choice = data.choices?.[0];
    const msg = choice?.message;

    // No tool calls → model produced a final answer.
    if (!msg?.tool_calls || msg.tool_calls.length === 0) {
      console.log(getText(data));
      return;
    }

    // Append the assistant message (including its tool_calls) to history.
    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.tool_calls
    });

    // Execute each requested tool call. NOTE: `id` is a sibling of
    // `function` in the tool_calls array, NOT inside `call.function`.
    for (const call of msg.tool_calls) {
      const id = call.id;
      const name = call.function?.name;
      const argsJSON = call.function?.arguments;

      let result;
      try {
        const args = toolCallArgument(name, argsJSON);
        result = await executeTool(name, args);
      } catch (err) {
        result = `error: ${err.message}`;
      }

      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: String(result)
      });
    }
  }

  console.error('Reached maximum tool-call rounds without a final answer.');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
