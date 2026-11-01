import { strict as assert } from 'assert';
import { buildRequestBody, buildSearxngSearchUrl } from '../src/agent';
import { parsePromptInput } from '../src/tools';

describe('DeepSeek request helpers', () => {
    it('enables DeepSeek web search and SearXNG tools', () => {
        const request = JSON.parse(buildRequestBody('Explain this function')) as {
            model: string;
            tools: Array<{ type: string; name?: string }>;
            input: string;
        };

        assert.equal(request.model, 'deepseek-v4-pro');
        assert.equal(request.input, 'Explain this function');
        assert.ok(request.tools.some((tool) => tool.type === 'web_search'));
        assert.ok(request.tools.some((tool) => tool.name === 'search_searxng'));
        assert.ok(request.tools.some((tool) => tool.name === 'fetch_page'));
        assert.ok(request.tools.some((tool) => tool.name === 'create_github_repository'));
        assert.ok(request.tools.some((tool) => tool.name === 'commit_and_push'));
        assert.ok(request.tools.some((tool) => tool.name === 'sign_in_to_github'));
        assert.ok(request.tools.some((tool) => tool.name === 'list_files'));
        assert.ok(request.tools.some((tool) => tool.name === 'read_file'));
        assert.ok(request.tools.some((tool) => tool.name === 'write_file'));
        assert.ok(request.tools.some((tool) => tool.name === 'create_directory'));
        assert.ok(request.tools.some((tool) => tool.name === 'run_command'));
    });

    it('builds a SearXNG JSON search URL', () => {
        const url = buildSearxngSearchUrl('http://localhost:8080/', 'vscode extension');
        assert.equal(url.pathname, '/search');
        assert.equal(url.searchParams.get('q'), 'vscode extension');
        assert.equal(url.searchParams.get('format'), 'json');
    });

    it('rejects SearXNG URLs with embedded credentials', () => {
        assert.throws(() => buildSearxngSearchUrl('http://user:pass@example.org', 'query'));
    });

    it('trims whitespace from prompts', () => {
        assert.equal(parsePromptInput('  help me  '), 'help me');
    });
});
