import { strict as assert } from 'assert';
import { isLikelyGlmModelId, checkLatestModel } from '../src/model-check';

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
