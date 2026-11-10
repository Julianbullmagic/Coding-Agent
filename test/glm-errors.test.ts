import { strict as assert } from 'assert';
import {
    GLM_API_ENDPOINT,
    GLM_DEFAULT_MODEL,
    normalizeGlmModel,
    glmSupportsReasoningEffort,
    interpretGlmError,
    resolveProvider,
    extractGlmText,
} from '../src/providers';

describe('GLM provider helpers', () => {
    it('routes GLM to the z.ai international endpoint', () => {
        assert.equal(GLM_API_ENDPOINT, 'https://api.z.ai/api/paas/v4/chat/completions');
        const cfg = resolveProvider('glm');
        assert.equal(cfg.endpoint, GLM_API_ENDPOINT);
        assert.equal(cfg.openAIStyle, true);
    });

    it('normalizes invented glm-5.3 down to a real model id', () => {
        assert.equal(normalizeGlmModel('glm-5.3'), 'glm-5');
        assert.equal(normalizeGlmModel('glm-5.9'), 'glm-5');
        assert.equal(normalizeGlmModel(' GLM-4.6 '), 'glm-4.6');
        assert.equal(normalizeGlmModel(''), GLM_DEFAULT_MODEL);
        assert.equal(normalizeGlmModel(undefined), GLM_DEFAULT_MODEL);
        assert.equal(normalizeGlmModel('nonsense'), GLM_DEFAULT_MODEL);
    });

    it('only allows reasoning_effort on reasoning models', () => {
        assert.ok(glmSupportsReasoningEffort('glm-5'));
        assert.ok(glmSupportsReasoningEffort('glm-5.1'));
        assert.ok(!glmSupportsReasoningEffort('glm-4.6'));
        assert.ok(!glmSupportsReasoningEffort('glm-5.3'));
    });

    it('extracts visible text, falling back to reasoning_content', () => {
        assert.equal(extractGlmText({ content: 'hello', reasoning_content: 'thinking' }), 'hello');
        assert.equal(extractGlmText({ content: null, reasoning_content: 'reasoned answer' }), 'reasoned answer');
        assert.equal(extractGlmText(undefined), '');
    });
});

describe('GLM error diagnostics', () => {
    it('explains a DeepSeek-only key used for GLM models', () => {
        const out = interpretGlmError(
            'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed glm-4.6. (request_id: 1b6e5621-d14d-4891-ad0d-06223d3382c5)',
        );
        assert.ok(out.startsWith('GLM request failed:'));
        assert.ok(out.includes('not authorized for the model "glm-4.6"'));
        assert.ok(out.includes('deepseek-flash, deepseek-v4-pro'));
        assert.ok(out.includes('DeepSeek-only z.ai key'));
        assert.ok(out.includes('Coding Agent: Set GLM API Key'));
    });

    it('does not claim DeepSeek-only when GLM models are supported', () => {
        const out = interpretGlmError(
            'The supported API model names are glm-4.6, glm-4.7, but you passed glm-9.',
        );
        assert.ok(!out.includes('DeepSeek-only'));
        assert.ok(out.includes('Coding Agent: Set GLM API Key'));
    });

    it('explains rejected API keys', () => {
        const out = interpretGlmError('Invalid authorization credentials');
        assert.ok(out.includes('API key was rejected'));
        assert.ok(out.includes('Coding Agent: Set GLM API Key'));
    });

    it('explains unknown model ids', () => {
        const out = interpretGlmError('Model does not exist: glm-x');
        assert.ok(out.includes('model id is not valid'));
        assert.ok(out.includes('codingAgent.glmModel'));
    });

    it('explains quota exhaustion', () => {
        const out = interpretGlmError('Insufficient balance in account');
        assert.ok(out.includes('quota or balance'));
    });

    it('explains timeouts', () => {
        const out = interpretGlmError('Web request timed out.');
        assert.ok(out.includes('did not respond within the timeout'));
    });

    it('tags unrecognized errors as GLM failures', () => {
        const out = interpretGlmError('Something unexpected happened');
        assert.equal(out, 'GLM request failed: Something unexpected happened');
    });

    it('handles empty error messages', () => {
        assert.equal(
            interpretGlmError(''),
            'GLM request failed: the service returned an empty error message.',
        );
    });
});
