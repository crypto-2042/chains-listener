# Chains-Listener - AI Context Template (claude-master)

## 1. Project Overview

- **Vision:** Chain-Listener 是一个多链事件监听工具，旨在提供统一、灵活的区块链事件监听服务，帮助开发者和用户实时追踪区块链上的各类活动。
- **Current Phase:** 项目处于初始开发阶段，正在从零开始搭建基础架构和核心功能。
- **Key Architecture:** 采用模块化设计，将不同区块链的监听逻辑抽象为统一接口，通过适配器模式支持多链生态。核心由事件监听器、数据处理管道和通知系统组成。
- **Development Strategy:** 
  1. 首先实现对主要区块链(BSC/ETH/BTC/Solana/Sui)的基础事件监听
  2. 构建灵活的配置系统，允许用户自定义监听对象和参数
  3. 开发事件过滤和处理管道
  4. 实现可扩展的通知机制
  5. 优化性能和可靠性

## 2. Project Structure

**⚠️ CRITICAL: AI agents MUST read the [Project Structure documentation](/docs/ai-context/project-structure.md) before attempting any task to understand the complete technology stack, file tree and project organization.**

For the complete tech stack and file tree structure, see [docs/ai-context/project-structure.md](/docs/ai-context/project-structure.md).

## 3. Coding Standards & AI Instructions

### General Instructions
- Your most important job is to manage your own context. Always read any relevant files BEFORE planning changes.
- When updating documentation, keep updates concise and on point to prevent bloat.
- Write code following KISS, YAGNI, and DRY principles.
- When in doubt follow proven best practices for implementation.
- Do not commit to git without user approval.
- Do not run any servers, rather tell the user to run servers for testing.
- Always consider industry standard libraries/frameworks first over custom implementations.
- Never mock anything. Never use placeholders. Never omit code.
- Apply SOLID principles where relevant. Use modern framework features rather than reinventing solutions.
- Be brutally honest about whether an idea is good or bad.
- Make side effects explicit and minimal.
- Design database schema to be evolution-friendly (avoid breaking changes).


### File Organization & Modularity
- Default to creating multiple small, focused files rather than large monolithic ones
- Each file should have a single responsibility and clear purpose
- Keep files under 350 lines when possible - split larger files by extracting utilities, constants, types, or logical components into separate modules
- Separate concerns: utilities, constants, types, components, and business logic into different files
- Prefer composition over inheritance - use inheritance only for true 'is-a' relationships, favor composition for 'has-a' or behavior mixing

- Follow existing project structure and conventions - place files in appropriate directories. Create new directories and move files if deemed appropriate.
- Use well defined sub-directories to keep things organized and scalable
- Structure projects with clear folder hierarchies and consistent naming conventions
- Import/export properly - design for reusability and maintainability

### 类型提示
- **始终**为函数参数和返回值使用类型注解
- 使用 TypeScript 内置类型和自定义类型接口
- 对可选参数使用 `?` 符号或 `| undefined` 类型
- 使用接口或类型别名定义数据结构

### 命名规范
- **类**: PascalCase (例如: `VoicePipeline`)
- **函数/方法**: camelCase (例如: `processAudio`)
- **常量**: UPPER_SNAKE_CASE (例如: `MAX_AUDIO_SIZE`)
- **私有方法**: 前缀下划线 (例如: `_validateInput`)
- **接口**: PascalCase 带 `I` 前缀 (例如: `IUserData`, `IChatRequest`)
- **类型别名**: PascalCase (例如: `UserSchema`, `ChatRequestType`)
- **枚举**: PascalCase (例如: `EventType`, `ChainType`)


### 文档要求
- 每个模块都需要文档注释
- 每个公共函数都需要文档注释
- 使用 JSDoc 风格的注释
- 在注释中包含类型信息


### Security First
- Never trust external inputs - validate everything at the boundaries
- Keep secrets in environment variables, never in code
- Log security events (login attempts, auth failures, rate limits, permission denials) but never log sensitive data (audio, conversation content, tokens, personal info)
- Authenticate users at the API gateway level - never trust client-side tokens
- Use Row Level Security (RLS) to enforce data isolation between users
- Design auth to work across all client types consistently
- Use secure authentication patterns for your platform
- Validate all authentication tokens server-side before creating sessions
- Sanitize all user inputs before storing or processing

### Error Handling
- Use specific exceptions over generic ones
- Always log errors with context
- Provide helpful error messages
- Fail securely - errors shouldn't reveal system internals

### Observable Systems & Logging Standards
- Every request needs a correlation ID for debugging
- Structure logs for machines, not humans - use JSON format with consistent fields (timestamp, level, correlation_id, event, context) for automated analysis
- Make debugging possible across service boundaries

### State Management
- Have one source of truth for each piece of state
- Make state changes explicit and traceable
- Design for multi-service voice processing - use session IDs for state coordination, avoid storing conversation data in server memory
- Keep conversation history lightweight (text, not audio)

### API Design Principles
- RESTful design with consistent URL patterns
- Use HTTP status codes correctly
- Version APIs from day one (/v1/, /v2/)
- Support pagination for list endpoints
- Use consistent JSON response format:
  - Success: `{ "data": {...}, "error": null }`
  - Error: `{ "data": null, "error": {"message": "...", "code": "..."} }`


## 4. Multi-Agent Workflows & Context Injection

### Automatic Context Injection for Sub-Agents
When using the Task tool to spawn sub-agents, the core project context (CLAUDE.md, project-structure.md, docs-overview.md) is automatically injected into their prompts via the subagent-context-injector hook. This ensures all sub-agents have immediate access to essential project documentation without the need of manual specification in each Task prompt.


## 5. MCP Server Integrations

### Gemini Consultation Server
**When to use:**
- Complex coding problems requiring deep analysis or multiple approaches
- Code reviews and architecture discussions
- Debugging complex issues across multiple files
- Performance optimization and refactoring guidance
- Detailed explanations of complex implementations
- Highly security relevant tasks

**Automatic Context Injection:**
- The kit's `gemini-context-injector.sh` hook automatically includes two key files for new sessions:
  - `/docs/ai-context/project-structure.md` - Complete project structure and tech stack
  - `/MCP-ASSISTANT-RULES.md` - Your project-specific coding standards and guidelines
- This ensures Gemini always has comprehensive understanding of your technology stack, architecture, and project standards

**Usage patterns:**
```python
# New consultation session (project structure auto-attached by hooks)
mcp__gemini__consult_gemini(
    specific_question="How should I optimize this voice pipeline?",
    problem_description="Need to reduce latency in real-time audio processing",
    code_context="Current pipeline processes audio sequentially...",
    attached_files=[
        "src/core/pipelines/voice_pipeline.py"  # Your specific files
    ],
    preferred_approach="optimize"
)

# Follow-up in existing session
mcp__gemini__consult_gemini(
    specific_question="What about memory usage?",
    session_id="session_123",
    additional_context="Implemented your suggestions, now seeing high memory usage"
)
```

**Key capabilities:**
- Persistent conversation sessions with context retention
- File attachment and caching for multi-file analysis
- Specialized assistance modes (solution, review, debug, optimize, explain)
- Session management for complex, multi-step problems

**Important:** Treat Gemini's responses as advisory feedback. Evaluate the suggestions critically, incorporate valuable insights into your solution, then proceed with your implementation.

### Context7 Documentation Server
**Repository**: [Context7 MCP Server](https://github.com/upstash/context7)

**When to use:**
- Working with external libraries/frameworks (React, FastAPI, Next.js, etc.)
- Need current documentation beyond training cutoff
- Implementing new integrations or features with third-party tools
- Troubleshooting library-specific issues

**Usage patterns:**
```python
# Resolve library name to Context7 ID
mcp__context7__resolve_library_id(libraryName="react")

# Fetch focused documentation
mcp__context7__get_library_docs(
    context7CompatibleLibraryID="/facebook/react",
    topic="hooks",
    tokens=8000
)
```

**Key capabilities:**
- Up-to-date library documentation access
- Topic-focused documentation retrieval
- Support for specific library versions
- Integration with current development practices


## 6. 任务完成后协议
完成任何编码任务后，请遵循此检查清单：

### 1. 类型安全和质量检查
根据修改的内容运行相应的命令：
- **TypeScript项目**: 运行 `bun run tsc --noEmit` 进行类型检查
- **代码质量检查**: 运行 `bunx biome check` 进行代码格式化和质量检查
- **测试验证**: 运行 `bun test` 执行单元测试和集成测试

### 2. 验证
- 确保所有类型检查通过后才认为任务完成
- 如果发现类型错误，在标记任务完成前必须修复
- 确保Biome检查通过，代码符合项目规范
- 验证相关测试用例通过