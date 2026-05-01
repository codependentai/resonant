# Provider-Neutral Architecture Research Notes

Checked on 2026-04-25. Sources are primary docs/specs only.

## Summary

The proposed Resonant refactor is consistent with established agent architecture patterns.

Across current agent frameworks, the common shape is:

1. A model/provider abstraction.
2. An application-owned tool/function registry.
3. A loop that lets the model request tool calls, executes those tools in application code, then returns results to the model.
4. Middleware, guardrails, or lifecycle hooks around prompts, model calls, tool calls, and outputs.
5. Capability-aware provider selection rather than assuming all models support the same features.
6. Optional protocol bridges such as MCP or OpenAPI for sharing tools across runtimes.

For Resonant, this confirms that the right direction is not "make Claude hooks run everywhere." The right direction is "make Resonant lifecycle/tool/context/session behavior provider-neutral, then adapt Claude hooks, Codex, OpenRouter, and future providers to that internal contract."

## What Existing Systems Confirm

### LangChain / LangGraph

LangChain describes agents as systems combining language models with tools and a graph runtime that moves through model nodes, tool nodes, and middleware. It also explicitly supports static and dynamic model selection, dynamic system prompts through middleware, streaming, memory, MCP, and guardrails.

Implication for Resonant:

- A graph/runtime boundary is normal.
- "Model call" and "tool execution" should be separate steps.
- Dynamic context injection belongs in middleware/lifecycle, not in provider-specific hook code only.

Source:

- https://docs.langchain.com/oss/python/langchain/agents

### LlamaIndex

LlamaIndex defines an agent as an LLM plus memory plus tools. Its documented loop sends tool schemas and chat history to the model, receives direct responses or tool calls, executes each tool, adds results back into history, and invokes the model again. It also distinguishes provider-native function/tool calling from alternative prompting strategies such as ReAct or CodeAct.

Implication for Resonant:

- The universal tool loop is well established.
- Provider-native tool calling is only one execution strategy.
- We can support OpenRouter models with native tool calls where available and a structured fallback where needed.

Source:

- https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/

### Semantic Kernel

Semantic Kernel uses plugins/functions as the durable abstraction. Functions can be native code, imported from OpenAPI, or imported from MCP. Microsoft explicitly calls out that functions need semantic descriptions of input, output, and side effects, and that task automation tools often need human-in-the-loop approval.

Implication for Resonant:

- A Resonant-owned tool registry with schema, descriptions, side-effect metadata, permission level, and audit is the right shape.
- OpenAPI/MCP export/import can be layered later.

Source:

- https://learn.microsoft.com/en-us/semantic-kernel/concepts/plugins/

### Model Context Protocol

MCP standardizes tool discovery and invocation with `tools/list`, tool names, descriptions, JSON input schemas, optional output schemas, annotations, and structured tool results. The spec also says tool-originated errors should be reported inside the tool result with `isError`, so the model can see the failure and self-correct.

Implication for Resonant:

- Our proposed internal tool definition closely matches MCP.
- Returning tool errors as model-visible tool results is the right behavior.
- MCP is a good external bridge, but Resonant still needs its own execution/audit/security layer.

Source:

- https://modelcontextprotocol.io/specification/2025-06-18/schema

### OpenAI Responses API

OpenAI documents tool/function calling as a multi-step application loop: provide tool definitions, receive a tool call, execute application-side code, return tool output, then receive final response or more tool calls. OpenAI also supports JSON-schema function tools, custom tools, built-in tools, and MCP server access.

Implication for Resonant:

- OpenAI itself expects the application to own tool execution for function tools.
- This supports moving Resonant tools out of shell commands and into backend-executed tool handlers.

Source:

- https://developers.openai.com/api/docs/guides/function-calling

### OpenAI Agents SDK

The OpenAI Agents SDK has first-class concepts for tools, guardrails, sessions, context management, lifecycle, MCP servers, tracing, handoffs, and model/provider interfaces. Its tool guardrails run before and after function tool execution, while some hosted/built-in tools do not use the same guardrail pipeline.

Implication for Resonant:

- Provider-specific hooks/guardrails differ, so Resonant should not bind its safety model to one provider's hook system.
- Tool-level guardrails before/after execution are an established pattern and should map well to Resonant's tool registry.

Sources:

- https://openai.github.io/openai-agents-js/guides/guardrails/
- https://openai.github.io/openai-agents-python/handoffs/

### Vercel AI SDK

The AI SDK explicitly says it standardizes model integration across supported providers. Its tool docs distinguish:

- custom tools: provider-agnostic, application-owned, portable
- provider-defined tools: provider-specific schema, app-side execution
- provider-executed tools: provider-side execution

It also has language model middleware for model-agnostic guardrails, RAG, caching, and logging, plus provider/model management through custom providers and registries.

Implication for Resonant:

- Our capability matrix should distinguish Resonant-owned tools from provider-native and provider-executed tools.
- Context injection, logging, and guardrails should be runtime-agnostic middleware/lifecycle.
- Central provider/model management is a normal design, not over-engineering.

Sources:

- https://ai-sdk.dev/docs/introduction
- https://ai-sdk.dev/docs/foundations/tools
- https://ai-sdk.dev/docs/ai-sdk-core/middleware
- https://ai-sdk.dev/docs/ai-sdk-core/provider-management

### Vercel AI Gateway

Vercel AI Gateway presents a unified API that lets developers switch models and providers without rewriting the app, while still acknowledging that different providers have different specifications, pricing, and performance.

Implication for Resonant:

- Provider switching should be explicit and capability-labeled.
- We should avoid pretending every runtime has the same feature surface.

Source:

- https://vercel.com/docs/ai-gateway/models-and-providers

### OpenRouter

OpenRouter documents its schema as similar to the OpenAI Chat API and says it normalizes request/response schema across models and providers.

Implication for Resonant:

- OpenRouter is useful as a BYOK model-router layer.
- It does not remove the need for Resonant capability detection, because schema normalization does not mean every model has equal tool, reasoning, streaming, or reliability behavior.

Source:

- https://openrouter.ai/docs/api/reference/overview/

## Conclusion For Resonant

The proposed direction is validated:

- Keep Claude Code as a full-featured default provider.
- Build an explicit provider/runtime adapter interface.
- Move orientation context out of Claude hooks into provider-neutral lifecycle/middleware.
- Create a Resonant-owned tool registry and executor.
- Treat MCP as an external bridge, not the only tool abstraction.
- Add capability metadata and UI labels.
- Move Scribe/digest/background model calls through the same runtime layer.
- Preserve provider-native features where they are valuable, but do not make them the product's core contract.

The strongest wording is:

> Resonant is moving toward provider-pluggable companion runtimes. The companion layer, tools, context, and continuity are Resonant-owned; Claude Code, OpenAI Codex, OpenRouter, and future providers are runtime adapters with clearly labeled capabilities.
