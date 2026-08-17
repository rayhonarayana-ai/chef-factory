## Gate 3 Model & Runtime Plan

### 1. Model Architecture Rule (Carried)
CHEF MUST remain model agnostic. No provider may become a hard dependency.

### 2. Gate 3 Model Changes

**No changes to model selection algorithm.** Cheapest-capable selection is proven.

**Change: Tool calling support per provider.**

| Provider | Tool Calling Support | Format | Status |
|----------|---------------------|--------|--------|
| OpenAI | YES — function calling | tools array + tool_calls response | IMPLEMENT (existing adapter) |
| Anthropic | YES — tool use | tools array + content[tool_use] response | IMPLEMENT (existing adapter) |
| Google | YES — function declarations | function_declarations + functionCall parts | IMPLEMENT (existing adapter) |
| OpenCode Zen | NO — CLI-based, no tool calling | N/A | DEFERRED (text-only) |

### 3. Tool Schema Distribution

Each provider adapter receives tool schemas in its native format:
- Adapter converts internal tool schema → provider-specific format
- Adapter parses provider response → extract tool_calls
- Adapter converts tool results → provider-specific format
- Core pipeline is provider-agnostic (never sees provider-specific formats)

### 4. Runtime Changes

**No changes to runtime selection.** OpenCode Zen remains the only runtime adapter.

**Runtime execution is NOT part of Gate 3.** Gate 3 focuses on LLM tool calling, not runtime execution. Runtime-based tool execution is deferred.

### 5. Model Selection for Tool Calling

When tool calls are expected:
- Model must support function calling (all 3 providers do)
- Model selection considers: tool calling capability, cost, context window
- If cheapest model doesn't support tools, skip to next cheapest that does
- Tool calling capability is a boolean filter in model selection

### 6. Seeded Models (Unchanged)
6 models remain:
- OpenAI: gpt-4o-mini, gpt-4o
- Anthropic: claude-3-5-haiku, claude-3-5-sonnet
- Google: gemini-1.5-flash, gemini-1.5-pro

### 7. What Gate 3 Does NOT Include
- New model providers
- New runtime adapters
- Model fine-tuning
- Model caching
- Runtime execution changes
- Batch processing
- Streaming responses
