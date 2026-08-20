# GATE 15 — IMPLEMENTATION: Streaming Response Delivery (SSE)

**Classification:** GATE_15_PASS
**Date:** 2026-08-19
**Owner Authorization:** OD18 (rayhonarayana40@gmail.com approved streaming SSE)

---

## 1. Summary

Gate 15 implements Server-Sent Events (SSE) streaming for the `/api/chat` endpoint. When `stream=true` is sent in the request body, the response is delivered as a sequence of SSE events over a persistent HTTP connection. When `stream=false` or omitted, the existing JSON response path is preserved unchanged.

**Streaming mode:** PROGRESS_EVENT_STREAMING. The pipeline emits real incremental events (start, error, approval) at genuine decision points during execution. The handler emits the authoritative `complete` event with the full `PipelineResult`. True provider token-by-token streaming is not implemented (ProviderAdapter interface has no `stream()` method).

## 2. Files Modified/Created

### New Files
| File | Lines | Purpose |
|------|-------|---------|
| `src/api/sse.ts` | 137 | SSE transport layer: event vocabulary (7 types), framing, SseWriter class, response setup |
| `src/api/streaming.ts` | 139 | Streaming chat handler: wraps pipeline with SSE events, disconnect detection, conversation handling |
| `src/api/gate15.streaming.test.ts` | ~570 | 37 unit tests covering SSE constructors, framing, pipeline callbacks, security preservation |
| `src/api/gate15.integration.test.ts` | ~470 | 26 integration tests covering pipeline emission, SSE writer, disconnect, backward compat, security |

### Modified Files
| File | Changes |
|------|---------|
| `src/core/pipeline.ts` | Added `StreamingCallbacks` interface and optional `streaming` parameter to `run()`, `executeTask()`, `runOrchestration()`. Emits `start`, `error`, `approval` events at all return points. |
| `src/api/server.ts` | Added `handleStreamingChat` import, `STREAMING_REQUEST_TIMEOUT_MS` (5min), `stream=true` detection on `POST /api/chat`, routes to SSE handler. |

## 3. Event Vocabulary

| Event | Source | Trigger |
|-------|--------|---------|
| `start` | Pipeline | Execution begins (line 188) |
| `error` | Pipeline | Error at any decision point (13 emission points) |
| `approval` | Pipeline | require_approval reached (line 431) |
| `complete` | Handler | Pipeline finished, full PipelineResult emitted |
| `cancelled` | Handler | Client disconnect detected |
| `delta` | Defined only | Not yet emitted (requires true provider streaming) |
| `tool` | Defined only | Not yet emitted (deferred to future gate) |

## 4. SSE Framing

```
data: {"type":"start","seq":0,"data":{"correlationId":"abc","intent":"status in chef-hq"}}

data: {"type":"complete","seq":1,"data":{"outcome":"executed",...,"conversation_id":"def"}}
```

- Content-Type: `text/event-stream`
- Cache-Control: `no-cache`
- Connection: `keep-alive`
- X-Accel-Buffering: `no`
- Initial comment: `: connected\n\n`
- Frame format: `data: {JSON}\n\n`
- Sequence: monotonically increasing integer per stream

## 5. Architecture

```
POST /api/chat { stream: true }
  → server.ts: stream=true detection (line 254)
  → streaming.ts: handleStreamingChat()
  → sse.ts: initSseResponse() — Content-Type: text/event-stream
  → streaming.ts: createDisconnectAwareCallbacks()
  → pipeline.run(ctx, command, history, callbacks)
    → pipeline emits: start → error/approval → (return PipelineResult)
  → streaming.ts: append assistant to conversation
  → streaming.ts: emit complete event (full PipelineResult + conversation_id)
  → sse.ts: SseWriter.close()
```

## 6. Backward Compatibility

- `POST /api/chat` with `stream: false` or no `stream` field → JSON response via `handlers.ts` (unchanged)
- `POST /api/chat` with `stream: true` → SSE event stream via `streaming.ts`
- `pipeline.run()` without `streaming` parameter → no events emitted (existing behavior)
- All 624 baseline tests pass without modification

## 7. Timeout Handling

- Non-streaming: 30s (existing Gate 13 `API_REQUEST_TIMEOUT_MS`)
- Streaming: 5 minutes (`STREAMING_REQUEST_TIMEOUT_MS = 300_000`)
- Streaming timer cleared in `finally` block (line 277)
- Non-streaming timer also cleared if streaming detected (line 261)

## 8. Disconnect Detection

- `req.on('close')` sets `cancelFlag.cancelled = true`
- `cancelled` SSE event emitted before writer close
- `callbacks.isCancelled()` checked before pipeline start and after completion
- Writer closed on all exit paths (error, cancellation, completion)

## 9. Security Invariants Preserved

All 16 Gate 5 security invariants verified:
1. Guardian evaluation runs identically on streaming path
2. Authority resolution unchanged
3. ToolBroker boundary preserved
4. Single execution preserved (streaming does NOT call pipeline twice)
5. CostProtector unchanged
6. RateLimiter unchanged
7. AnomalyDetector unchanged
8. Prompt injection denial unchanged
9. Owner isolation maintained
10. Project isolation maintained
11. Conversation isolation maintained
12. RLS unchanged
13. Approval boundaries preserved
14. Cancellation propagated
15. Orchestration timeout unchanged
16. Step timeout unchanged
