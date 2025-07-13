# Project Structure Template

This document provides a template for documenting the complete technology stack and file tree structure for your project. **AI agents MUST read this file to understand the project organization before making any changes.**

## Technology Stack Template

### Backend Technologies
- **TypeScript + Bun 1.1+** - Primary runtime and package management
- **config.toml + config.d.ts** - Type-safe configuration management
- **Node.js Events** - Event-driven architecture for real-time monitoring

#### Configuration Usage

1. **config.toml** - Centralized configuration file for all application settings
   - Store environment-specific configurations (database URLs, API keys, chain endpoints)
   - Use TOML format for human-readable and structured configuration
   - Example structure:
     ```toml
     [database]
     redis_url = "redis://localhost:6379"
     
     [chains.ethereum]
     rpc_url = "https://mainnet.infura.io/v3/YOUR_KEY"
     
     [logging]
     level = "info"
     ```

2. **config.d.ts** - TypeScript declarations for config.toml to ensure type safety
   - Provides IntelliSense and compile-time type checking
   - Eliminates compilation warnings and enables code highlighting
   - Must be configured with tsconfig.json path aliases for proper module resolution
   - Example declaration:
     ```typescript
     declare module '@/config.toml' {
       interface Config {
         database: {
           redis_url: string;
         };
         chains: {
           ethereum: {
             rpc_url: string;
           };
         };
         logging: {
           level: 'debug' | 'info' | 'warn' | 'error';
         };
       }
       const config: Config;
       export default config;
     }
     ```

3. **tsconfig.json alias configuration** - Required for proper module resolution
   ```json
   {
     "compilerOptions": {
       "paths": {
         // ... 
         "@/config.toml": ["./config.toml"]
       }
     }
   }
   ```

4. **Usage Patterns** - Direct TOML import in code
   - Leverages Bun runtime's native TOML support without requiring additional toml parsing libraries
   - Supports both destructured imports for specific config sections and full config object imports
   - Example usage:
    ```typescript
    // Import complete config object
    import config from '@/config.toml';
    console.log(config.database.redis_url);
    
    // Destructured imports for specific config sections
    import { logging, chains } from '@/config.toml';
    console.log(logging.level);
    console.log(chains.ethereum.rpc_url);
     
    ```






### Blockchain Integration SDKs
- **Ethers.js v6.x** - EVM-compatible chains (ETH/BSC) interaction SDK for contract calls, event listening, and transactions
- **@solana/web3.js v1.x** - Solana blockchain interaction SDK for account queries and transaction monitoring  
- **@mysten/sui.js v0.x** - Sui blockchain interaction SDK for object monitoring and event subscriptions
- **bitcoinjs-lib v6.x** - Bitcoin blockchain interaction library for transactions and UTXO monitoringogging

### Infrastructure & Utilities
- **Redis v4.x** - High-performance in-memory database for caching, message queues, and temporary data storage
- **Winston v3.x** - Extensible logging framework supporting multiple transports and log levels
- **Axios v1.x** - HTTP client for API requests
- **Node-cron v3.x** - Task scheduling and cron jobs

### Development & Quality Tools
- **Biome v1.x** - Code formatting and code quality checking tool, replacing ESLint and Prettier
- **TypeScript v5.x** - Static type checking and type definitions
- **Bun Test v1.x** - Built-in test framework for unit and integration testing
- **Bun v1.1+** - Package manager, task runner, and build tool
- **tsx** - Direct TypeScript execution for development and prototyping


## Complete Project Structure Template

```
[PROJECT-NAME]/
├── README.md                           # Project overview and setup
├── CLAUDE.md                           # Master AI context file
├── package.json                        # Build configuration (Makefile, package.json, etc.)
├── .gitignore                          # Git ignore patterns
├── chains/                             # Chains core code
│   ├── CONTEXT.md                      # Chains AI context
│   ├── evm/                            # Evm core
│   │   ├── index.ts                    # Entry script
│   │   └── evm.ts                      # Core
│   ├── solana/                         # Solana core
│   │   ├── index.ts                    # Entry script
│   │   └── solana.ts                   # Core
│   ├── [other chains name]/            # Solana core
│   │   ├── index.ts                    # Entry script
│   │   └── [name].ts                   # Core
│   └── index.ts                        # Entry script
├── utils/                              # utils code
│   ├── CONTEXT.md                      # Utils AI context
│   ├── [name].ts                       # Util
│   └── index.ts                        # Entry script
├── docs/                               # Documentation
│   ├── ai-context/                     # AI-specific documentation
│   │   ├── project-structure.md        # This file
│   │   ├── docs-overview.md            # Documentation architecture
│   │   ├── system-integration.md       # Integration patterns
│   │   ├── deployment-infrastructure.md # Infrastructure docs
│   │   └── handoff.md                  # Task management
│   ├── api/                            # API documentation
│   ├── deployment/                     # Deployment guides
│   └── development/                    # Development guides
├── config.d.ts                         # Config declare file
├── config.toml                         # Config fle
├── index.ts                            # Entry scripts
├── setup.sh                            # Setup scripts
└── tsconfig.json                       # Typescript configuration files
```


---

*This template provides a comprehensive foundation for documenting project structure. Adapt it based on your specific technology stack, architecture decisions, and organizational requirements.*