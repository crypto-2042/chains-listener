declare module "@/config.toml" {
	interface Database {
		redis_url: string;
		connection_pool_size: number;
	}

	interface Logging {
		level: "debug" | "info" | "warn" | "error";
		format: "json" | "text";
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
		commitment: "processed" | "confirmed" | "finalized";
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
		channels: ("webhook" | "redis_pubsub")[];
		webhook_url?: string;
		redis_channel?: string;
	}

	interface PerformanceConfig {
		worker_pool_size: number;
		max_concurrent_requests: number;
		request_timeout_ms: number;
		circuit_breaker_threshold: number;
	}

	// Enhanced configuration for individual contract customization
	interface CustomFilterRule {
		field: string; // e.g., "from", "to", "amount", "tokenSymbol"
		operator:
			| "equals"
			| "not_equals"
			| "greater_than"
			| "less_than"
			| "contains"
			| "regex";
		value: string | number;
		description?: string;
	}

	interface FilterConfiguration {
		// Amount-based filters
		min_amount?: string;
		max_amount?: string;

		// Transaction filters
		exclude_self_transfers?: boolean;
		include_failed_transactions?: boolean;

		// Token-specific filters
		min_mint_amount?: string;
		track_burn_events?: boolean;
		only_new_tokens?: boolean;

		// Custom filtering rules
		custom_rules?: CustomFilterRule[];

		// Performance options
		batch_size?: number;
		polling_interval_ms?: number;
		confirmation_blocks?: number;
	}

	interface EnhancedTarget {
		id: string;
		name?: string;
		type: "address" | "contract" | "token";
		address: string;
		event_types: string[];
		chains?: string[];
		enabled?: boolean;
		tags?: string[];
		description?: string;
		priority?: "low" | "medium" | "high";
		notification_channels?: string[];
		filters?: FilterConfiguration;
	}

	interface EnhancedTargetsConfig {
		// Backward compatibility - existing batch configuration
		addresses: TargetAddresses;
		contracts: TargetContracts;

		// New enhanced per-target configuration
		enhanced_targets?: EnhancedTarget[];
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
		targets: EnhancedTargetsConfig;
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
