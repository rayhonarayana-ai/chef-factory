import { describe, expect, it } from 'vitest';
import {
  estimateStringTokens,
  estimateMessageTokens,
  truncateConversationHistory,
  CONVERSATION_TOKEN_BUDGET,
  CONVERSATION_RESERVE_TOKENS,
} from './execution.js';
import type { ConversationMessage } from '../core/pipeline.js';

function msg(role: 'user' | 'assistant', content: string): ConversationMessage {
  return { role, content };
}

// ─── G11-17: estimateStringTokens ───────────────────────────────────
describe('estimateStringTokens (G11-17)', () => {
  it('estimates tokens for empty string', () => {
    expect(estimateStringTokens('')).toBe(0);
  });

  it('estimates ~1 token per 4 chars', () => {
    expect(estimateStringTokens('abcd')).toBe(1);
    expect(estimateStringTokens('abcdefgh')).toBe(2);
  });

  it('rounds up for non-multiple of 4', () => {
    expect(estimateStringTokens('abc')).toBe(1);
    expect(estimateStringTokens('abcde')).toBe(2);
  });
});

// ─── G11-18: estimateMessageTokens ──────────────────────────────────
describe('estimateMessageTokens (G11-18)', () => {
  it('estimates tokens for a simple message', () => {
    const tokens = estimateMessageTokens(msg('user', 'hello'));
    expect(tokens).toBeGreaterThan(0);
    // "hello" = 2 tokens + 4 overhead = 6
    expect(tokens).toBe(6);
  });

  it('includes tool_call_id tokens', () => {
    const m: ConversationMessage = { role: 'assistant', content: '', tool_call_id: 'call-123' };
    const tokens = estimateMessageTokens(m);
    expect(tokens).toBeGreaterThan(4); // more than just overhead
  });

  it('includes name tokens', () => {
    const m: ConversationMessage = { role: 'assistant', content: '', name: 'tool_name' };
    const tokens = estimateMessageTokens(m);
    expect(tokens).toBeGreaterThan(4);
  });
});

// ─── G11-19: truncateConversationHistory ─────────────────────────────
describe('truncateConversationHistory (G11-19)', () => {
  it('returns empty for undefined input', () => {
    expect(truncateConversationHistory(undefined)).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(truncateConversationHistory([])).toEqual([]);
  });

  it('returns all messages when within budget', () => {
    const history = [msg('user', 'hi'), msg('assistant', 'hello')];
    expect(truncateConversationHistory(history, 10000)).toEqual(history);
  });

  it('truncates oldest messages when over budget', () => {
    const history = [
      msg('user', 'message 1 with some content'),
      msg('assistant', 'response 1 with some content'),
      msg('user', 'message 2 with some content'),
      msg('assistant', 'response 2 with some content'),
    ];
    // Set a very small budget to force truncation
    const truncated = truncateConversationHistory(history, 20);
    expect(truncated.length).toBeLessThan(history.length);
    // Should keep most recent messages
    expect(truncated[truncated.length - 1]).toEqual(history[history.length - 1]);
  });

  it('preserves order of kept messages', () => {
    const history = [
      msg('user', 'first'),
      msg('assistant', 'second'),
      msg('user', 'third'),
    ];
    const truncated = truncateConversationHistory(history, 10000);
    expect(truncated.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('handles single message within budget', () => {
    const history = [msg('user', 'hello')];
    expect(truncateConversationHistory(history, 100)).toEqual(history);
  });

  it('handles single message exceeding budget', () => {
    const history = [msg('user', 'a very long message that exceeds the budget')];
    const truncated = truncateConversationHistory(history, 5);
    expect(truncated).toEqual([]);
  });

  it('does not modify the original array', () => {
    const history = [msg('user', 'a'), msg('user', 'b')];
    const original = [...history];
    truncateConversationHistory(history, 2);
    expect(history).toEqual(original);
  });
});

// ─── G11-20: Token budget constants ─────────────────────────────────
describe('token budget constants (G11-20)', () => {
  it('CONVERSATION_TOKEN_BUDGET is 8000', () => {
    expect(CONVERSATION_TOKEN_BUDGET).toBe(8000);
  });

  it('CONVERSATION_RESERVE_TOKENS is 2000', () => {
    expect(CONVERSATION_RESERVE_TOKENS).toBe(2000);
  });
});
