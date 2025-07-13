import { EventEmitter } from "node:events";
import type { EventPipeline } from "../../events/event-processor.interface";
import type {
	BlockchainEvent,
	ChainType,
	ProcessedEvent,
} from "../../types/events";
import type config from "@/config.toml";
type Config = typeof config;
import type {
	ConnectionStatus,
	IChainAdapter,
	MonitoringTarget,
} from "./chain-adapter.interface";

// Import all chain adapters
import { EthereumAdapter, BSCAdapter } from "../evm";
import { SolanaAdapter } from "../solana";
import { SuiAdapter } from "../sui";
import { TronAdapter } from "../tron";
import { BitcoinAdapter } from "../bitcoin";

export interface ChainManagerConfig {
	maxConcurrentConnections: number;
	healthCheckInterval: number;
	reconnectDelay: number;
	enableAutoReconnect: boolean;
}

export interface ChainStatus {
	chainType: ChainType;
	adapter: IChainAdapter;
	status: ConnectionStatus;
	lastActivity: number;
	eventCount: number;
	errorCount: number;
}

export class ChainManager extends EventEmitter {
	private adapters: Map<ChainType, IChainAdapter> = new Map();
	private eventPipeline: EventPipeline;
	private config: ChainManagerConfig;
	private healthCheckTimer?: NodeJS.Timeout;
	private isRunning = false;

	constructor(
		eventPipeline: EventPipeline,
		config: ChainManagerConfig = {
			maxConcurrentConnections: 10,
			healthCheckInterval: 30000,
			reconnectDelay: 5000,
			enableAutoReconnect: true,
		},
	) {
		super();
		this.eventPipeline = eventPipeline;
		this.config = config;
	}

	public registerAdapter(adapter: IChainAdapter): void {
		if (this.adapters.has(adapter.chainType)) {
			throw new Error(`Adapter for ${adapter.chainType} is already registered`);
		}

		this.adapters.set(adapter.chainType, adapter);
		this.setupAdapterListeners(adapter);
	}

	public unregisterAdapter(chainType: ChainType): void {
		const adapter = this.adapters.get(chainType);
		if (adapter) {
			this.cleanupAdapterListeners(adapter);
			this.adapters.delete(chainType);
		}
	}

	public async start(): Promise<void> {
		if (this.isRunning) {
			throw new Error("ChainManager is already running");
		}

		this.isRunning = true;

		const connectionPromises = Array.from(this.adapters.values()).map(
			async (adapter) => {
				try {
					await adapter.connect();
					await adapter.startMonitoring();
					this.emit("adapterStarted", adapter.chainType);
				} catch (error) {
					this.emit("adapterError", adapter.chainType, error);
					throw error;
				}
			},
		);

		await Promise.allSettled(connectionPromises);
		this.startHealthCheck();

		this.emit("managerStarted");
	}

	public async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;
		this.stopHealthCheck();

		const disconnectionPromises = Array.from(this.adapters.values()).map(
			async (adapter) => {
				try {
					await adapter.stopMonitoring();
					await adapter.disconnect();
					this.emit("adapterStopped", adapter.chainType);
				} catch (error) {
					this.emit("adapterError", adapter.chainType, error);
				}
			},
		);

		await Promise.allSettled(disconnectionPromises);
		this.emit("managerStopped");
	}

	public async addMonitoringTarget(
		chainType: ChainType,
		target: MonitoringTarget,
	): Promise<void> {
		const adapter = this.adapters.get(chainType);
		if (!adapter) {
			throw new Error(`No adapter registered for chain: ${chainType}`);
		}

		await adapter.addMonitoringTarget(target);
		this.emit("targetAdded", chainType, target);
	}

	public async removeMonitoringTarget(
		chainType: ChainType,
		address: string,
	): Promise<void> {
		const adapter = this.adapters.get(chainType);
		if (!adapter) {
			throw new Error(`No adapter registered for chain: ${chainType}`);
		}

		await adapter.removeMonitoringTarget(address);
		this.emit("targetRemoved", chainType, address);
	}

	public getChainStatus(chainType: ChainType): ChainStatus | null {
		const adapter = this.adapters.get(chainType);
		if (!adapter) {
			return null;
		}

		return {
			chainType,
			adapter,
			status: adapter.getConnectionStatus(),
			lastActivity: Date.now(),
			eventCount: 0,
			errorCount: 0,
		};
	}

	public getAllChainStatuses(): ChainStatus[] {
		return Array.from(this.adapters.keys())
			.map((chainType) => this.getChainStatus(chainType))
			.filter((status): status is ChainStatus => status !== null);
	}

	public getAdapter(chainType: ChainType): IChainAdapter | null {
		return this.adapters.get(chainType) || null;
	}

	public getSupportedChains(): ChainType[] {
		return Array.from(this.adapters.keys());
	}

	public isChainSupported(chainType: ChainType): boolean {
		return this.adapters.has(chainType);
	}

	public async reconnectChain(chainType: ChainType): Promise<void> {
		const adapter = this.adapters.get(chainType);
		if (!adapter) {
			throw new Error(`No adapter registered for chain: ${chainType}`);
		}

		try {
			await adapter.disconnect();
			await this.sleep(this.config.reconnectDelay);
			await adapter.connect();
			await adapter.startMonitoring();

			this.emit("chainReconnected", chainType);
		} catch (error) {
			this.emit("reconnectionFailed", chainType, error);
			throw error;
		}
	}

	private setupAdapterListeners(adapter: IChainAdapter): void {
		adapter.on("blockchainEvent", async (event: BlockchainEvent) => {
			try {
				const processedEvent = await this.eventPipeline.execute(event);
				if (processedEvent) {
					this.emit("eventProcessed", processedEvent);
				}
			} catch (error) {
				this.emit("eventProcessingError", event, error);
			}
		});

		adapter.on("connectionStatus", (status: ConnectionStatus) => {
			this.emit("chainStatusUpdate", adapter.chainType, status);
		});

		adapter.on("error", (error: Error) => {
			this.emit("chainError", adapter.chainType, error);

			if (this.config.enableAutoReconnect && this.isRunning) {
				this.scheduleReconnection(adapter.chainType);
			}
		});
	}

	private cleanupAdapterListeners(adapter: IChainAdapter): void {
		adapter.removeAllListeners();
	}

	private startHealthCheck(): void {
		if (this.healthCheckTimer) {
			return;
		}

		this.healthCheckTimer = setInterval(() => {
			this.performHealthCheck();
		}, this.config.healthCheckInterval);
	}

	private stopHealthCheck(): void {
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
			this.healthCheckTimer = undefined;
		}
	}

	private async performHealthCheck(): Promise<void> {
		const statuses = this.getAllChainStatuses();

		for (const status of statuses) {
			const timeSinceLastHeartbeat = Date.now() - status.status.lastHeartbeat;
			const isStale =
				timeSinceLastHeartbeat > this.config.healthCheckInterval * 2;

			if (isStale && this.config.enableAutoReconnect) {
				this.emit("chainUnhealthy", status.chainType);
				this.scheduleReconnection(status.chainType);
			}
		}

		this.emit("healthCheckCompleted", statuses);
	}

	private scheduleReconnection(chainType: ChainType): void {
		setTimeout(async () => {
			if (this.isRunning) {
				try {
					await this.reconnectChain(chainType);
				} catch (error) {
					this.emit("autoReconnectFailed", chainType, error);
				}
			}
		}, this.config.reconnectDelay);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	public getEventPipeline(): EventPipeline {
		return this.eventPipeline;
	}

	/**
	 * Create and register all supported chain adapters
	 */
	public initializeAllAdapters(): void {
		try {
			// Initialize Ethereum adapter
			const ethereumAdapter = new EthereumAdapter();
			this.registerAdapter(ethereumAdapter);

			// Initialize BSC adapter
			const bscAdapter = new BSCAdapter();
			this.registerAdapter(bscAdapter);

			// Initialize Solana adapter
			const solanaAdapter = new SolanaAdapter();
			this.registerAdapter(solanaAdapter);

			// Initialize Sui adapter
			const suiAdapter = new SuiAdapter();
			this.registerAdapter(suiAdapter);

			// Initialize Tron adapter
			const tronAdapter = new TronAdapter();
			this.registerAdapter(tronAdapter);

			// Initialize Bitcoin adapter
			const bitcoinAdapter = new BitcoinAdapter();
			this.registerAdapter(bitcoinAdapter);

			this.emit("adaptersInitialized", this.adapters.size);
		} catch (error) {
			this.emit("adapterInitializationError", error);
			throw error;
		}
	}

	/**
	 * Initialize specific adapters based on enabled chains in config
	 */
	public initializeEnabledAdapters(enabledChains: ChainType[]): void {
		try {
			for (const chainType of enabledChains) {
				switch (chainType) {
					case ChainType.ETHEREUM:
						this.registerAdapter(new EthereumAdapter());
						break;
					case ChainType.BSC:
						this.registerAdapter(new BSCAdapter());
						break;
					case ChainType.SOLANA:
						this.registerAdapter(new SolanaAdapter());
						break;
					case ChainType.SUI:
						this.registerAdapter(new SuiAdapter());
						break;
					case ChainType.TRX:
						this.registerAdapter(new TronAdapter());
						break;
					case ChainType.BITCOIN:
						this.registerAdapter(new BitcoinAdapter());
						break;
					default:
						console.warn(`Unknown chain type: ${chainType}`);
				}
			}
			this.emit("adaptersInitialized", this.adapters.size);
		} catch (error) {
			this.emit("adapterInitializationError", error);
			throw error;
		}
	}

	public getStats(): {
		activeChains: number;
		connectedChains: number;
		totalEvents: number;
		pipelineStats: ReturnType<EventPipeline["getStats"]>;
	} {
		const statuses = this.getAllChainStatuses();
		const connectedChains = statuses.filter((s) => s.status.connected).length;
		const totalEvents = statuses.reduce((sum, s) => sum + s.eventCount, 0);

		return {
			activeChains: this.adapters.size,
			connectedChains,
			totalEvents,
			pipelineStats: this.eventPipeline.getStats(),
		};
	}

	public on(event: "managerStarted", listener: () => void): this;
	public on(event: "managerStopped", listener: () => void): this;
	public on(
		event: "eventProcessed",
		listener: (event: ProcessedEvent) => void,
	): this;
	public on(
		event: "eventProcessingError",
		listener: (event: BlockchainEvent, error: Error) => void,
	): this;
	public on(
		event: "adapterStarted",
		listener: (chainType: ChainType) => void,
	): this;
	public on(
		event: "adapterStopped",
		listener: (chainType: ChainType) => void,
	): this;
	public on(
		event: "adapterError",
		listener: (chainType: ChainType, error: Error) => void,
	): this;
	public on(
		event: "chainStatusUpdate",
		listener: (chainType: ChainType, status: ConnectionStatus) => void,
	): this;
	public on(
		event: "chainError",
		listener: (chainType: ChainType, error: Error) => void,
	): this;
	public on(
		event: "chainReconnected",
		listener: (chainType: ChainType) => void,
	): this;
	public on(
		event: "reconnectionFailed",
		listener: (chainType: ChainType, error: Error) => void,
	): this;
	public on(
		event: "targetAdded",
		listener: (chainType: ChainType, target: MonitoringTarget) => void,
	): this;
	public on(
		event: "targetRemoved",
		listener: (chainType: ChainType, address: string) => void,
	): this;
	public on(
		event: "chainUnhealthy",
		listener: (chainType: ChainType) => void,
	): this;
	public on(
		event: "healthCheckCompleted",
		listener: (statuses: ChainStatus[]) => void,
	): this;
	public on(
		event: "autoReconnectFailed",
		listener: (chainType: ChainType, error: Error) => void,
	): this;
	public on(
		event: "adaptersInitialized",
		listener: (count: number) => void,
	): this;
	public on(
		event: "adapterInitializationError",
		listener: (error: Error) => void,
	): this;
	public on(event: string, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}
}
