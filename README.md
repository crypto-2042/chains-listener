# Chains-Listener

一个多链事件监听工具，用于实时监控区块链上的各类活动事件，支持钱包转账、代币铸造、NFT 转移等事件的统一监听和处理。

## 🌟 核心特性

- **多链支持**: 支持 Ethereum、BSC、Solana、Sui、Bitcoin、Tron 等主流区块链
- **实时监听**: 基于事件驱动的实时区块链事件监控
- **灵活配置**: 支持自定义监听地址、合约和事件类型
- **事件过滤**: 内置多种过滤器，可按金额、地址等条件筛选事件
- **通知系统**: 支持 Webhook、Redis 发布订阅、日志等多种通知方式
- **高可靠性**: 自动重连、错误恢复、连接状态监控
- **统计监控**: 实时统计事件处理数量、连接状态等指标

## 🔗 支持的区块链

| 区块链 | 支持的事件类型 | 状态 |
|-------|-------------|------|
| Ethereum | Transfer, Token Mint/Burn, NFT | ✅ |
| BSC | Transfer, Token Mint/Burn, NFT | ✅ |
| Solana | Transfer, Token Program Events | ✅ |
| Sui | Object Events, Transfer | ✅ |
| Tron | TRC20/TRC721 Transfer, Mint | ✅ |
| Bitcoin | Transfer (基础支持) | ✅ |

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- Bun >= 1.1.0 (推荐) 或 npm/yarn
- Redis (可选，用于缓存和通知)

### 安装

```bash
# 使用 Bun (推荐)
bun install

# 或使用 npm
npm install
```

### 配置

1. 复制并编辑配置文件：

```bash
cp config.toml config.local.toml
```

2. 编辑 `config.toml` 文件，配置需要监听的地址和合约：

```toml
[targets.addresses]
watch_addresses = [
    "0x742D35Cc6634C0532925a3b8D9C9e0aE8e123456",  # 替换为实际地址
    "0x123456789abcdef123456789abcdef123456789a"   # 可以添加多个地址
]

[targets.contracts]
erc20_contracts = [
    "0xA0b86a33E6D5a0A2b0b86a33E6D5a0A2b0b86a33"   # 监听的 ERC20 合约
]

[notifications]
enabled = true
webhook_url = "https://your-app.com/webhook"  # 设置你的 webhook 接收地址
```

### 运行

```bash
# 开发模式 (监听文件变化自动重启)
bun run dev

# 生产模式
bun run build
bun run start
```

## 📋 配置说明

### 基础配置

```toml
[database]
redis_url = "redis://localhost:6379"  # Redis 连接地址
connection_pool_size = 10

[logging]
level = "info"                        # 日志级别: debug, info, warn, error
format = "json"                       # 日志格式: json, simple
```

### 链配置

每个支持的区块链都有独立的配置部分：

```toml
[chains.ethereum]
rpc_url = "https://eth.public-rpc.com"              # RPC 节点地址
websocket_url = "wss://ethereum-rpc.publicnode.com" # WebSocket 地址 (可选)
chain_id = 1                                        # 链 ID
block_confirmation_count = 12                       # 确认块数
max_retry_attempts = 3                              # 最大重试次数
```

### 监听目标配置

```toml
[targets.addresses]
watch_addresses = [
    "0x742D35Cc6634C0532925a3b8D9C9e0aE8e123456"  # 监听的钱包地址
]

[targets.contracts]
erc20_contracts = [
    "0xA0b86a33E6D5a0A2b0b86a33E6D5a0A2b0b86a33"   # ERC20 代币合约
]
erc721_contracts = [
    "0xC2d8b55F7C2d8b55F7C2d8b55F7C2d8b55F7C2d8"   # ERC721 NFT 合约
]
```

### 事件过滤器

```toml
[filters.transfer]
min_amount = "0.1"              # 最小转账金额
max_amount = "1000000"          # 最大转账金额
exclude_self_transfers = true   # 排除自转
include_failed_transactions = false  # 是否包含失败交易
```

### 通知配置

```toml
[notifications]
enabled = true
channels = ["webhook", "redis_pubsub"]   # 通知渠道
webhook_url = "https://your-app.com/webhook"
redis_channel = "blockchain_events"
```

## 💻 使用示例

### 基础使用

```typescript
import { ChainsListener, ChainType, EventType } from 'chains-listener';

const listener = new ChainsListener({
  enabledChains: [ChainType.ETHEREUM, ChainType.BSC],
  autoStart: true
});

// 监听事件
listener.on('eventProcessed', (event) => {
  console.log(`收到事件: ${event.originalEvent.eventType}`);
  console.log(`链: ${event.originalEvent.chainType}`);
  console.log(`交易哈希: ${event.originalEvent.transactionHash}`);
});

// 监听连接状态
listener.on('chainStatusUpdate', (chainType, status) => {
  console.log(`${chainType} 连接状态: ${status.connected ? '已连接' : '已断开'}`);
});

// 启动监听
await listener.start();
```

### 动态添加监听目标

```typescript
// 添加钱包地址监听
await listener.addWalletAddress(
  '0x742D35Cc6634C0532925a3b8D9C9e0aE8e123456',
  [ChainType.ETHEREUM, ChainType.BSC]
);

// 添加代币合约监听
await listener.addTokenContract(
  '0xA0b86a33E6D5a0A2b0b86a33E6D5a0A2b0b86a33',
  [ChainType.ETHEREUM]
);

// 移除监听目标
await listener.removeWalletAddress('0x742D35Cc6634C0532925a3b8D9C9e0aE8e123456');
```

### 获取统计信息

```typescript
const stats = listener.getStats();
console.log(`运行时间: ${Math.floor(stats.uptime / 1000)}秒`);
console.log(`总事件数: ${stats.totalEvents}`);
console.log(`已处理: ${stats.processedEvents}`);
console.log(`失败: ${stats.failedEvents}`);
console.log(`活跃链数: ${stats.activeChains}`);
```

### 测试连接

```typescript
const connections = await listener.testConnections();
for (const [chainType, connected] of Object.entries(connections)) {
  console.log(`${chainType}: ${connected ? '连接正常' : '连接失败'}`);
}
```

## 🛠️ 开发指南

### 项目结构

```
src/
├── chains/                 # 区块链适配器
│   ├── base/              # 基础接口和管理器
│   ├── evm/               # EVM 兼容链 (Ethereum, BSC)
│   ├── solana/            # Solana 适配器
│   ├── sui/               # Sui 适配器
│   ├── tron/              # Tron 适配器
│   └── bitcoin/           # Bitcoin 适配器
├── events/                # 事件处理系统
│   ├── filters/           # 事件过滤器
│   └── pipeline-factory.ts
├── notifications/         # 通知系统
│   ├── webhook-notifier.ts
│   ├── redis-notifier.ts
│   └── logger-notifier.ts
├── types/                 # 类型定义
└── utils/                 # 工具函数
```

### 开发环境设置

1. 安装依赖：
```bash
bun install
```

2. 运行类型检查：
```bash
bun run type-check
```

3. 运行代码检查：
```bash
bun run lint
bun run lint:fix  # 自动修复问题
```

4. 运行测试：
```bash
bun test
```

5. 构建项目：
```bash
bun run build
```

### 添加新的区块链支持

1. 在 `src/chains/` 下创建新的适配器目录
2. 实现 `IChainAdapter` 接口
3. 在 `src/types/events.ts` 中添加新的 `ChainType`
4. 在 `src/chains-listener.ts` 中注册新的适配器
5. 在 `config.toml` 中添加链配置

参考 `src/chains/evm/ethereum-adapter.ts` 的实现示例。

### 自定义事件处理器

```typescript
import { EventPipeline } from './events/event-processor.interface';

class CustomPipeline implements EventPipeline {
  async processEvent(event: BlockchainEvent): Promise<ProcessedEvent> {
    // 自定义事件处理逻辑
    return {
      id: event.id,
      originalEvent: event,
      processed: true,
      processedAt: Date.now(),
      notifications: [],
      metadata: {
        correlationId: generateCorrelationId(),
        processingDuration: 0,
        filters: [],
        enrichments: {},
        classification: {
          category: 'medium_value',
          confidence: 0.8,
          tags: ['custom']
        }
      }
    };
  }
}

const listener = new ChainsListener({
  customPipeline: new CustomPipeline()
});
```

## 📊 API 参考

### ChainsListener 类

#### 构造函数

```typescript
new ChainsListener(options?: ChainsListenerConfig)
```

#### 主要方法

| 方法 | 描述 | 参数 | 返回值 |
|------|------|------|-------|
| `start()` | 启动监听器 | - | `Promise<void>` |
| `stop()` | 停止监听器 | - | `Promise<void>` |
| `addWalletAddress()` | 添加钱包地址监听 | `address: string, chains?: ChainType[]` | `Promise<void>` |
| `removeWalletAddress()` | 移除钱包地址监听 | `address: string, chains?: ChainType[]` | `Promise<void>` |
| `addTokenContract()` | 添加合约监听 | `address: string, chains?: ChainType[]` | `Promise<void>` |
| `removeTokenContract()` | 移除合约监听 | `address: string, chains?: ChainType[]` | `Promise<void>` |
| `getStats()` | 获取统计信息 | - | `ChainsListenerStats` |
| `testConnections()` | 测试所有链连接 | - | `Promise<Record<ChainType, boolean>>` |

#### 事件

| 事件名 | 触发时机 | 参数 |
|--------|----------|------|
| `starting` | 监听器开始启动 | - |
| `started` | 监听器启动完成 | - |
| `stopping` | 监听器开始停止 | - |
| `stopped` | 监听器停止完成 | - |
| `eventProcessed` | 事件处理完成 | `event: ProcessedEvent` |
| `eventProcessingError` | 事件处理失败 | `originalEvent: any, error: Error` |
| `chainStatusUpdate` | 链状态更新 | `chainType: ChainType, status: ConnectionStatus` |
| `chainError` | 链连接错误 | `chainType: ChainType, error: Error` |

## 🔧 故障排除

### 常见问题

1. **连接超时或失败**
   - 检查网络连接
   - 验证 RPC 节点地址是否正确
   - 确认 API 密钥（如果需要）是否有效

2. **事件丢失**
   - 增加 `block_confirmation_count` 以确保事件稳定
   - 检查过滤器配置是否过于严格
   - 确认监听的地址格式正确

3. **性能问题**
   - 调整 `polling_interval_ms` 减少轮询频率
   - 增加 `worker_pool_size` 提高并发处理能力
   - 使用 WebSocket 连接代替 HTTP 轮询

4. **内存使用过高**
   - 减少 `batch_size` 降低批处理大小
   - 定期清理旧的事件数据
   - 检查是否有内存泄漏

### 日志调试

启用详细日志：

```toml
[logging]
level = "debug"
format = "json"
correlation_tracking = true
```

查看特定链的连接状态：

```typescript
const statuses = listener.getChainStatuses();
console.log(JSON.stringify(statuses, null, 2));
```

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

### 开发规范

- 遵循项目的 TypeScript 编码规范
- 确保所有测试通过
- 添加适当的类型注解
- 更新相关文档

## 🙏 致谢

- [ethers.js](https://github.com/ethers-io/ethers.js/) - Ethereum 交互库
- [@solana/web3.js](https://github.com/solana-labs/solana-web3.js) - Solana 交互库
- [@mysten/sui.js](https://github.com/MystenLabs/sui/tree/main/sdk/typescript) - Sui 交互库
- [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib) - Bitcoin 交互库
- [tronweb](https://github.com/tronprotocol/tronweb) - Tron 交互库

---

如有问题或建议，欢迎提交 [Issue](https://github.com/crypto-2042/chains-listener/issues) 或联系维护者。