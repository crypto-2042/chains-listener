declare module '@/config.toml' {
  interface Database {
    redis_url: string;
    connection_pool_size: number;
  }

  interface Logging {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
    correlation_tracking: boolean;
  }

  interface ChainConfig {
    rpc_url: string;
    websocket_url?: string;
    max_retry_attempts: number;
  }

  interface EVMChainConfig extends ChainConfig {
    chain_id: number;
    block_confirmation_count: number;
  }

  interface SolanaChainConfig extends ChainConfig {
    commitment: 'processed' | 'confirmed' | 'finalized';
  }

  interface MonitoringConfig {
    enabled: boolean;
    batch_size: number;
    polling_interval_ms: number;
    confirmation_blocks: number;
  }

  interface TargetAddresses {
    watch_addresses: string[];
  }

  interface TargetContracts {
    erc20_contracts: string[];
    erc721_contracts: string[];
    trc20_contracts: string[];
    trc721_contracts: string[];
    spl_token_programs: string[];
  }

  interface TransferFilter {
    min_amount: string;
    max_amount: string;
    exclude_self_transfers: boolean;
    include_failed_transactions: boolean;
  }

  interface TokenMintingFilter {
    min_mint_amount: string;
    track_burn_events: boolean;
    only_new_tokens: boolean;
  }

  interface NotificationConfig {
    enabled: boolean;
    channels: ('webhook' | 'redis_pubsub')[];
    webhook_url?: string;
    redis_channel?: string;
  }

  interface PerformanceConfig {
    worker_pool_size: number;
    max_concurrent_requests: number;
    request_timeout_ms: number;
    circuit_breaker_threshold: number;
  }

  interface Config {
    database: Database;
    logging: Logging;
    chains: {
      ethereum: EVMChainConfig;
      bsc: EVMChainConfig;
      solana: SolanaChainConfig;
      sui: ChainConfig;
      bitcoin: ChainConfig;
      trx: EVMChainConfig;
    };
    monitoring: {
      transfers: MonitoringConfig;
      token_minting: MonitoringConfig;
    };
    targets: {
      addresses: TargetAddresses;
      contracts: TargetContracts;
    };
    filters: {
      transfer: TransferFilter;
      token_minting: TokenMintingFilter;
    };
    notifications: NotificationConfig;
    performance: PerformanceConfig;
  }

  const config: Config;
  export default config;
}