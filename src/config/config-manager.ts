import type {
	EnhancedMonitoringTarget,
	MonitoringTarget,
	TargetFilterConfiguration,
} from "../chains/base/chain-adapter.interface";
import type { ChainType, EventType } from "../types/events";
import config from "@/config.toml";

export interface ResolvedTargetConfig {
	filters: {
		transfer: {
			min_amount: string;
			max_amount: string;
			exclude_self_transfers: boolean;
			include_failed_transactions: boolean;
		};
		token_minting: {
			min_mint_amount: string;
			track_burn_events: boolean;
			only_new_tokens: boolean;
		};
	};
	monitoring: {
		batch_size: number;
		polling_interval_ms: number;
		confirmation_blocks: number;
	};
	notifications: {
		enabled: boolean;
		channels: string[];
		webhook_url?: string;
		redis_channel?: string;
	};
	priority: "low" | "medium" | "high";
}

/**
 * Configuration manager that handles both global and per-target configurations
 * Provides unified access to configuration with proper fallback handling
 */
export class ConfigManager {
	private static instance: ConfigManager;
	private baseConfig = config;
	private enhancedTargets: Map<string, EnhancedMonitoringTarget> = new Map();

	private constructor() {
		this.loadEnhancedTargets();
	}

	public static getInstance(): ConfigManager {
		if (!ConfigManager.instance) {
			ConfigManager.instance = new ConfigManager();
		}
		return ConfigManager.instance;
	}

	/**
	 * Load enhanced targets from configuration
	 */
	private loadEnhancedTargets(): void {
		const enhancedTargets = this.baseConfig.targets?.enhanced_targets;
		if (!enhancedTargets) return;

		for (const target of enhancedTargets) {
			const enhancedTarget: EnhancedMonitoringTarget = {
				id: target.id,
				name: target.name,
				type: target.type as "address" | "contract" | "token",
				address: target.address.toLowerCase(),
				eventTypes: target.event_types as EventType[],
				enabled: target.enabled ?? true,
				tags: target.tags,
				description: target.description,
				priority: target.priority,
				notificationChannels: target.notification_channels,
				chains: target.chains,
				filters: target.filters
					? this.convertConfigFilters(target.filters)
					: undefined,
			};

			this.enhancedTargets.set(target.address.toLowerCase(), enhancedTarget);
		}
	}

	/**
	 * Convert configuration filters to target filter configuration
	 */
	private convertConfigFilters(configFilters: any): TargetFilterConfiguration {
		return {
			minAmount: configFilters.min_amount,
			maxAmount: configFilters.max_amount,
			excludeSelfTransfers: configFilters.exclude_self_transfers,
			includeFailedTransactions: configFilters.include_failed_transactions,
			minMintAmount: configFilters.min_mint_amount,
			trackBurnEvents: configFilters.track_burn_events,
			onlyNewTokens: configFilters.only_new_tokens,
			customRules: configFilters.custom_rules,
			batchSize: configFilters.batch_size,
			pollingIntervalMs: configFilters.polling_interval_ms,
			confirmationBlocks: configFilters.confirmation_blocks,
		};
	}

	/**
	 * Resolves configuration for a specific contract/address
	 * Falls back to global settings when per-target configuration is not available
	 */
	public getTargetConfig(
		contractAddress: string,
		chainType?: ChainType,
	): ResolvedTargetConfig {
		const lowerAddress = contractAddress.toLowerCase();
		const enhancedTarget = this.enhancedTargets.get(lowerAddress);

		// If no enhanced target or target doesn't have custom filters, use global config
		if (!enhancedTarget?.filters) {
			return this.getGlobalConfig();
		}

		// Check if target applies to specific chain
		if (
			chainType &&
			enhancedTarget.chains &&
			!enhancedTarget.chains.includes(chainType)
		) {
			return this.getGlobalConfig();
		}

		// Merge target-specific configuration with global defaults
		const globalConfig = this.getGlobalConfig();
		const targetFilters = enhancedTarget.filters;

		return {
			filters: {
				transfer: {
					min_amount:
						targetFilters.minAmount ?? globalConfig.filters.transfer.min_amount,
					max_amount:
						targetFilters.maxAmount ?? globalConfig.filters.transfer.max_amount,
					exclude_self_transfers:
						targetFilters.excludeSelfTransfers ??
						globalConfig.filters.transfer.exclude_self_transfers,
					include_failed_transactions:
						targetFilters.includeFailedTransactions ??
						globalConfig.filters.transfer.include_failed_transactions,
				},
				token_minting: {
					min_mint_amount:
						targetFilters.minMintAmount ??
						globalConfig.filters.token_minting.min_mint_amount,
					track_burn_events:
						targetFilters.trackBurnEvents ??
						globalConfig.filters.token_minting.track_burn_events,
					only_new_tokens:
						targetFilters.onlyNewTokens ??
						globalConfig.filters.token_minting.only_new_tokens,
				},
			},
			monitoring: {
				batch_size:
					targetFilters.batchSize ?? globalConfig.monitoring.batch_size,
				polling_interval_ms:
					targetFilters.pollingIntervalMs ??
					globalConfig.monitoring.polling_interval_ms,
				confirmation_blocks:
					targetFilters.confirmationBlocks ??
					globalConfig.monitoring.confirmation_blocks,
			},
			notifications: {
				enabled: globalConfig.notifications.enabled,
				channels:
					enhancedTarget.notificationChannels ??
					globalConfig.notifications.channels,
				webhook_url: globalConfig.notifications.webhook_url,
				redis_channel: globalConfig.notifications.redis_channel,
			},
			priority: enhancedTarget.priority ?? "medium",
		};
	}

	/**
	 * Gets global configuration as ResolvedTargetConfig
	 */
	public getGlobalConfig(): ResolvedTargetConfig {
		return {
			filters: {
				transfer: {
					min_amount: this.baseConfig.filters.transfer.min_amount,
					max_amount: this.baseConfig.filters.transfer.max_amount,
					exclude_self_transfers:
						this.baseConfig.filters.transfer.exclude_self_transfers,
					include_failed_transactions:
						this.baseConfig.filters.transfer.include_failed_transactions,
				},
				token_minting: {
					min_mint_amount:
						this.baseConfig.filters.token_minting.min_mint_amount,
					track_burn_events:
						this.baseConfig.filters.token_minting.track_burn_events,
					only_new_tokens:
						this.baseConfig.filters.token_minting.only_new_tokens,
				},
			},
			monitoring: {
				batch_size: this.baseConfig.monitoring.transfers.batch_size,
				polling_interval_ms:
					this.baseConfig.monitoring.transfers.polling_interval_ms,
				confirmation_blocks:
					this.baseConfig.monitoring.transfers.confirmation_blocks,
			},
			notifications: {
				enabled: this.baseConfig.notifications.enabled,
				channels: this.baseConfig.notifications.channels,
				webhook_url: this.baseConfig.notifications.webhook_url,
				redis_channel: this.baseConfig.notifications.redis_channel,
			},
			priority: "medium",
		};
	}

	/**
	 * Gets list of contracts with custom configurations
	 */
	public getCustomizedContracts(): string[] {
		return Array.from(this.enhancedTargets.keys());
	}

	/**
	 * Gets enhanced target by address
	 */
	public getEnhancedTarget(
		address: string,
	): EnhancedMonitoringTarget | undefined {
		return this.enhancedTargets.get(address.toLowerCase());
	}

	/**
	 * Gets all enhanced targets
	 */
	public getAllEnhancedTargets(): EnhancedMonitoringTarget[] {
		return Array.from(this.enhancedTargets.values());
	}

	/**
	 * Checks if an address has custom configuration
	 */
	public hasCustomConfig(address: string): boolean {
		return this.enhancedTargets.has(address.toLowerCase());
	}

	/**
	 * Dynamically adds an enhanced target (runtime configuration)
	 */
	public addEnhancedTarget(target: EnhancedMonitoringTarget): void {
		this.enhancedTargets.set(target.address.toLowerCase(), target);
	}

	/**
	 * Removes an enhanced target
	 */
	public removeEnhancedTarget(address: string): boolean {
		return this.enhancedTargets.delete(address.toLowerCase());
	}

	/**
	 * Converts legacy MonitoringTarget to EnhancedMonitoringTarget
	 */
	public enhanceTarget(
		target: MonitoringTarget,
		customConfig?: Partial<EnhancedMonitoringTarget>,
	): EnhancedMonitoringTarget {
		return {
			id: customConfig?.id ?? `target_${target.address.slice(0, 8)}`,
			name: customConfig?.name,
			type: target.type,
			address: target.address,
			eventTypes: target.eventTypes,
			metadata: target.metadata,
			enabled: customConfig?.enabled ?? true,
			tags: customConfig?.tags,
			description: customConfig?.description,
			priority: customConfig?.priority ?? "medium",
			notificationChannels: customConfig?.notificationChannels,
			filters: customConfig?.filters,
			chains: customConfig?.chains,
		};
	}
}
