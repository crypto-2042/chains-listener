import { EventEmitter } from "node:events";
import type { BlockchainEvent, ChainType, EventType } from "../../types/events";

export interface ChainAdapterConfig {
	rpcUrl: string;
	websocketUrl?: string;
	maxRetryAttempts: number;
	pollingInterval?: number;
	batchSize?: number;
}

export interface ConnectionStatus {
	connected: boolean;
	lastHeartbeat: number;
	blockHeight: number;
	syncStatus: "synced" | "syncing" | "behind" | "error";
	errors: string[];
}

// Enhanced configuration for individual contract customization
export interface CustomFilterRule {
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

export interface TargetFilterConfiguration {
	// Amount-based filters
	minAmount?: string;
	maxAmount?: string;

	// Transaction filters
	excludeSelfTransfers?: boolean;
	includeFailedTransactions?: boolean;

	// Token-specific filters
	minMintAmount?: string;
	trackBurnEvents?: boolean;
	onlyNewTokens?: boolean;

	// Custom filtering rules
	customRules?: CustomFilterRule[];

	// Performance options
	batchSize?: number;
	pollingIntervalMs?: number;
	confirmationBlocks?: number;
}

// Original interface for backward compatibility
export interface MonitoringTarget {
	type: "address" | "contract" | "token";
	address: string;
	eventTypes: EventType[];
	metadata?: Record<string, unknown>;
}

// Enhanced interface with individual customization support
export interface EnhancedMonitoringTarget extends MonitoringTarget {
	id: string;
	name?: string;
	enabled?: boolean;
	tags?: string[];
	description?: string;
	priority?: "low" | "medium" | "high";
	notificationChannels?: string[];
	filters?: TargetFilterConfiguration;
	chains?: string[]; // Specific chains this target applies to
}

export abstract class IChainAdapter extends EventEmitter {
	protected config: ChainAdapterConfig;
	protected connected = false;
	protected retryCount = 0;
	protected monitoringTargets: Map<string, MonitoringTarget> = new Map();

	constructor(config: ChainAdapterConfig) {
		super();
		this.config = config;
	}

	abstract readonly chainType: ChainType;

	abstract connect(): Promise<void>;

	abstract disconnect(): Promise<void>;

	abstract getConnectionStatus(): ConnectionStatus;

	abstract getCurrentBlockNumber(): Promise<number>;

	abstract addMonitoringTarget(target: MonitoringTarget): Promise<void>;

	abstract removeMonitoringTarget(address: string): Promise<void>;

	abstract startMonitoring(): Promise<void>;

	abstract stopMonitoring(): Promise<void>;

	abstract getTransactionDetails(
		txHash: string,
	): Promise<BlockchainEvent | null>;

	abstract validateAddress(address: string): boolean;

	abstract estimateGas(transaction: unknown): Promise<string>;

	public emit(event: "blockchainEvent", data: BlockchainEvent): boolean;
	public emit(event: "connectionStatus", status: ConnectionStatus): boolean;
	public emit(event: "error", error: Error): boolean;
	public emit(event: string | symbol, ...args: unknown[]): boolean {
		return super.emit(event, ...args);
	}

	public on(
		event: "blockchainEvent",
		listener: (data: BlockchainEvent) => void,
	): this;
	public on(
		event: "connectionStatus",
		listener: (status: ConnectionStatus) => void,
	): this;
	public on(event: "error", listener: (error: Error) => void): this;
	public on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	protected async retry<T>(
		operation: () => Promise<T>,
		context: string,
	): Promise<T> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= this.config.maxRetryAttempts; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (attempt < this.config.maxRetryAttempts) {
					const delay = Math.min(1000 * 2 ** attempt, 30000);
					await this.sleep(delay);

					this.emit(
						"error",
						new Error(
							`${context} failed, retrying in ${delay}ms (attempt ${attempt + 1}/${this.config.maxRetryAttempts}): ${lastError.message}`,
						),
					);
				}
			}
		}

		throw new Error(
			`${context} failed after ${this.config.maxRetryAttempts} attempts: ${lastError?.message}`,
		);
	}

	protected sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	protected generateEventId(txHash: string, logIndex?: number): string {
		const suffix = logIndex !== undefined ? `_${logIndex}` : "";
		return `${this.chainType}_${txHash}${suffix}`;
	}

	protected validateMonitoringTarget(target: MonitoringTarget): void {
		if (!this.validateAddress(target.address)) {
			throw new Error(
				`Invalid address for ${this.chainType}: ${target.address}`,
			);
		}

		if (target.eventTypes.length === 0) {
			throw new Error("At least one event type must be specified");
		}
	}

	public getMonitoringTargets(): MonitoringTarget[] {
		return Array.from(this.monitoringTargets.values());
	}

	public isConnected(): boolean {
		return this.connected;
	}

	public getConfig(): Readonly<ChainAdapterConfig> {
		return { ...this.config };
	}
}
