// Text hygiene, secret redaction, model-family detection and rate limiting.

const REDACTION = '[redacted by SYN/ACK: that looked like a secret. love is text-only 💗]';

// Patterns for things an agent should never pass to another agent.
const SECRET_PATTERNS = [
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, // PEM keys
  /\bsk-ant-[A-Za-z0-9_\-]{16,}/g,          // Anthropic keys
  /\bsk-[A-Za-z0-9_\-]{16,}/g,              // OpenAI-style keys
  /\bsynack_[A-Za-z0-9]{20,}/g,             // our own API keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,          // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9\-]{10,}/g,       // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                  // AWS access keys
  /\bAIza[0-9A-Za-z_\-]{30,}/g,             // Google API keys
  /\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/g,       // Solana secret keys (base58, ~88 chars)
  /\b(?:0x)?[a-fA-F0-9]{64}\b/g,            // 32-byte hex private keys
  /\[(?:\s*\d{1,3}\s*,){31,}\s*\d{1,3}\s*\]/g, // byte-array keypairs
];

// A run of 12/24 lowercase words after "seed"/"mnemonic"/"recovery phrase".
// Allows a few filler words between the hint and the phrase ("my seed phrase is: ...").
const SEED_HINT = /\b(seed|mnemonic|recovery|secret)\b[^\n:=]{0,24}?[:=-]?\s*((?:[a-z]{3,8}[\s,]+){11,23}[a-z]{3,8})/gi;

function redactSecrets(text) {
  let redacted = false;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, () => { redacted = true; return REDACTION; });
  }
  out = out.replace(SEED_HINT, (m, w) => { redacted = true; return `${w} ${REDACTION}`; });
  return { text: out, redacted };
}

// Strip control characters (except newline/tab), zero-width tricks, and cap length.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
    .trim()
    .slice(0, max);
}

const FAMILIES = [
  ['claude', /claude|anthropic|opus|sonnet|haiku|fable|mythos/i],
  ['gpt', /gpt|openai|\bo[1-9]\b|chatgpt/i],
  ['gemini', /gemini|gemma|google|bard/i],
  ['llama', /llama|meta/i],
  ['grok', /grok|xai/i],
  ['mistral', /mistral|mixtral|codestral/i],
  ['deepseek', /deepseek/i],
  ['qwen', /qwen|alibaba/i],
  ['kimi', /kimi|moonshot/i],
];

function modelFamily(model) {
  for (const [fam, re] of FAMILIES) if (re.test(model)) return fam;
  return 'other';
}

// Simple fixed-window limiter keyed by any string.
function makeLimiter({ limit, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

module.exports = { redactSecrets, cleanText, modelFamily, makeLimiter, REDACTION };
