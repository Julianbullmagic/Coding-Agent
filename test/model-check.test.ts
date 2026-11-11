import { strict as assert } from 'assert';
import { isLikelyGlmModelId, checkLatestModel, describeNetworkError } from '../src/model-check';

describe('model-check model-id guard', () => {
    it('recognizes GLM model ids', () => {
        assert.equal(isLikelyGlmModelId('glm-5.3'), true);
        assert.equal(isLikelyGlmModelId('glm-5.3-flash'), true);
        assert.equal(isLikelyGlmModelId('GLM-4.6'), true);
        assert.equal(isLikelyGlmModelId('glm-4.6'), true);
        assert.equal(isLikelyGlmModelId(' glm-5.3 '), true);
    });

    it('does not flag DeepSeek model ids', () => {
        assert.equal(isLikelyGlmModelId('deepseek-v4-pro'), false);
        assert.equal(isLikelyGlmModelId('deepseek-flash'), false);
        assert.equal(isLikelyGlmModelId('deepseek-chat'), false);
    });

    it('does not flag empty or undefined', () => {
        assert.equal(isLikelyGlmModelId(''), false);
        assert.equal(isLikelyGlmModelId(undefined), false);
    });
});

describe('checkLatestModel GLM short-circuit', () => {
    it('returns the GLM id unchanged without hitting the network', async () => {
        // If we passed "glm-5.3" to the DeepSeek /models endpoint it would
        // reject with "The supported API model names are ... but you passed
        // glm-5.3." The guard must return early, so no error is thrown and no
        // network request is attempted.
        const result = await checkLatestModel(undefined, 'glm-5.3');
        assert.deepEqual(result, { id: 'glm-5.3', name: 'glm-5.3', version: '' });
    });
});

describe('describeNetworkError', () => {
    function errno(code: string, message: string): NodeJS.ErrnoException {
        return Object.assign(new Error(message), { code });
    }

    it('wraps an ENOTFOUND DNS failure with a readable diagnosis and host', () => {
        const error = errno('ENOTFOUND', 'getaddrinfo ENOTFOUND api.deepseek.com');
        const described = describeNetworkError(error, 'Model check request failed');
        assert.ok(described.message.startsWith('Model check request failed'));
        assert.ok(described.message.includes('deepseek.com'), 'should name the host');
        assert.ok(described.message.toLowerCase().includes('dns'), 'should mention DNS');
        assert.ok(described.message.toLowerCase().includes('check your internet connection'));
    });

    it('wraps ECONNREFUSED as a connection failure', () => {
        const error = errno('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:8080');
        const described = describeNetworkError(error, 'Request failed');
        assert.ok(described.message.toLowerCase().includes('refused'));
        assert.ok(described.message.includes('Request failed'));
    });

    it('preserves a recognizable prefix so classifySource can file it correctly', () => {
        const error = errno('ENOTFOUND', 'getaddrinfo ENOTFOUND api.deepseek.com');
        const described = describeNetworkError(error, 'Model check request failed');
        // classifySource in self-heal.ts keys off this exact prefix.
        assert.ok(described.message.includes('Model check request failed'));
    });
});
