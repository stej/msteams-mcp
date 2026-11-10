/**
 * Unit tests for tools/registry.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  Tool: {},
}));

vi.mock('./search-tools.js', () => ({
  searchTools: [{
    definition: { name: 'teams_search' },
    schema: z.object({ query: z.string() }),
    handler: vi.fn().mockResolvedValue({ success: true }),
  }, {
    definition: { name: 'teams_get_thread' },
    schema: z.object({ conversationId: z.string(), markRead: z.boolean().optional() }),
    handler: vi.fn().mockResolvedValue({ success: true }),
  }],
}));

vi.mock('./message-tools.js', () => ({
  messageTools: [{
    definition: { name: 'teams_send_message' },
    schema: z.object({ conversationId: z.string(), content: z.string() }),
    handler: vi.fn().mockResolvedValue({ success: true }),
  }],
}));

vi.mock('./people-tools.js', () => ({
  peopleTools: [{
    definition: { name: 'teams_get_me' },
    schema: z.object({ userId: z.string() }),
    handler: vi.fn().mockResolvedValue({ success: true }),
  }],
}));

vi.mock('./auth-tools.js', () => ({
  authTools: [{
    definition: { name: 'teams_login' },
    schema: z.object({}),
    handler: vi.fn().mockResolvedValue({ success: true }),
  }],
}));

vi.mock('./meeting-tools.js', () => ({
  meetingTools: [{
    definition: { name: 'teams_get_meetings' },
    schema: z.object({}),
    handler: vi.fn().mockResolvedValue({ success: true }),
  }],
}));

vi.mock('./file-tools.js', () => ({
  fileTools: [{
    definition: { name: 'teams_upload_file' },
    schema: z.object({}),
    handler: vi.fn().mockResolvedValue({ success: true }),
  }],
}));

import { getToolDefinitions, getTool, invokeTool, hasTool } from './registry.js';

describe('getToolDefinitions', () => {
  it('returns an array of tool definitions', () => {
    const tools = getToolDefinitions();
    
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('returns tools with expected properties', () => {
    const tools = getToolDefinitions();
    
    for (const tool of tools) {
      expect(tool).toHaveProperty('name');
      expect(typeof tool.name).toBe('string');
    }
  });
});

describe('getTool', () => {
  it('returns a tool by name', () => {
    const tool = getTool('teams_search');
    
    expect(tool).toBeDefined();
    expect(tool?.definition.name).toBe('teams_search');
  });

  it('returns undefined for unknown tool', () => {
    const tool = getTool('nonexistent_tool');
    
    expect(tool).toBeUndefined();
  });
});

describe('hasTool', () => {
  it('returns true for existing tool', () => {
    expect(hasTool('teams_search')).toBe(true);
  });

  it('returns false for unknown tool', () => {
    expect(hasTool('nonexistent_tool')).toBe(false);
  });
});

describe('invokeTool', () => {
  it('invokes a known tool', async () => {
    const result = await invokeTool('teams_search', { query: 'test' });
    
    expect(result.success).toBe(true);
  });

  it('returns error for unknown tool', async () => {
    const result = await invokeTool('nonexistent_tool', {});
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('Unknown tool');
    }
  });

  it('validates input against schema', async () => {
    const result = await invokeTool('teams_search', { query: 'test' });
    
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it('returns validation error for invalid input', async () => {
    // teams_search requires a string query
    const result = await invokeTool('teams_search', { query: 123 } as Record<string, unknown>);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.message).toContain('Invalid input');
    }
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MSTEAMS_ACCESS_MODE', 'readOnly');
});
afterEach(() => vi.unstubAllEnvs());

describe('read-only enforcement at invocation', () => {
  it('hides writes and rejects a direct call before its handler runs', async () => {
    expect(getToolDefinitions().some(tool => tool.name === 'teams_send_message')).toBe(false);
    expect(await invokeTool('teams_send_message', { conversationId: 'id', content: 'text' }))
      .toMatchObject({ success: false, error: { code: 'ACCESS_DENIED' } });
    expect(getTool('teams_send_message')?.handler).not.toHaveBeenCalled();
  });

  it('rejects a credential reset before login runs', async () => {
    expect(await invokeTool('teams_login', { forceNew: true }))
      .toMatchObject({ success: false, error: { code: 'ACCESS_DENIED' } });
    expect(getTool('teams_login')?.handler).not.toHaveBeenCalled();
  });

  it('permits a write only with explicit fullAccess', async () => {
    vi.stubEnv('MSTEAMS_ACCESS_MODE', 'fullAccess');
    expect(await invokeTool('teams_send_message', { conversationId: 'id', content: 'text' }))
      .toMatchObject({ success: true });
    expect(getTool('teams_send_message')?.handler).toHaveBeenCalledTimes(1);
  });
});

it('rejects markRead before a readable handler runs', async () => {
  expect(await invokeTool('teams_get_thread', { conversationId: 'id', markRead: true }))
    .toMatchObject({ success: false, error: { code: 'ACCESS_DENIED' } });
  expect(getTool('teams_get_thread')?.handler).not.toHaveBeenCalled();
});
