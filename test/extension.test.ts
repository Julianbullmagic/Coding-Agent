import { strict as assert } from 'assert';
import { buildRequestBody } from '../src/agent';
import { parsePromptInput } from '../src/tools';

describe('DeepSeek request helpers', () => {
    it('enables DeepSeek web search and workspace/GitHub tools', () => {
        const request = JSON.parse(buildRequestBody('Explain this function')) as {
            model: string;
            tools: Array<{ type: string; name?: string }>;
            input: string;
        };

        assert.equal(request.model, 'deepseek-v4-pro');
        assert.equal(request.input, 'Explain this function');
        assert.ok(request.tools.some((tool) => tool.type === 'web_search'));
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

    it('does not expose the SearXNG tool (disabled)', () => {
        const request = JSON.parse(buildRequestBody('Explain this function')) as {
            tools: Array<{ type: string; name?: string }>;
        };
        assert.ok(!request.tools.some((tool) => tool.name === 'search_searxng'));
    });

    it('trims whitespace from prompts', () => {
        assert.equal(parsePromptInput('  help me  '), 'help me');
    });
});
