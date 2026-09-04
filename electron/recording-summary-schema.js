const Ajv = require('ajv');

const SUMMARY_SCHEMA_V1 = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['topic', 'conclusions', 'discussionPoints', 'actionItems', 'keywords'],
  properties: {
    topic: { type: 'string', minLength: 1 },
    conclusions: { type: 'array', items: { type: 'string', minLength: 1 } },
    discussionPoints: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['title', 'content'],
        properties: { title: { type: 'string', minLength: 1 }, content: { type: 'string', minLength: 1 } },
      },
    },
    actionItems: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['task', 'owner', 'deadline'],
        properties: { task: { type: 'string', minLength: 1 }, owner: { type: ['string', 'null'] }, deadline: { type: ['string', 'null'] } },
      },
    },
    keywords: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
});

const validateSummaryV1 = new Ajv({ allErrors: true }).compile(SUMMARY_SCHEMA_V1);

function parseJsonObject(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

function validateSummary(value) {
  if (!validateSummaryV1(value)) {
    const error = new Error(`Summary result has an invalid structure: ${validateSummaryV1.errors?.map((item) => item.message).filter(Boolean).join(', ') || 'unknown validation error'}.`);
    error.code = 'SUMMARY_SCHEMA_INVALID';
    throw error;
  }
  return value;
}

function parseAndValidateSummary(raw) { return validateSummary(parseJsonObject(raw)); }

module.exports = { SUMMARY_SCHEMA_V1, parseAndValidateSummary, parseJsonObject, validateSummary };
