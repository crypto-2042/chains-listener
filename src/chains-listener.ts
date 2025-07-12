import { EventEmitter } from "events";
import type { MonitoringTarget } from "./chains/base/chain-adapter.interface";
import { ChainManager } from "./chains/base/chain-manager";
import { BSCAdapter, EthereumAdapter } from "./chains/evm";
import { SolanaAdapter } from "./chains/solana";
import { SuiAdapter } from "./chains/sui";
import { TronAdapter } from "./chains/tron";
import type { EventPipeline } from "./events/event-processor.interface";
import { PipelineFactory } from "./events/pipeline-factory";
import { ChainType, EventType, type ProcessedEvent } from "./types/events";
import config from "@/config.toml";

export interface ChainsListenerConfig {
	configPath?: string;
	autoStart?: boolean;
	enabledChains?: ChainType[];
	customPipeline?: EventPipeline;
}

export interface ChainsListenerStats {
	uptime: number;
	totalEvents: number;
	processedEvents: number;
	failedEvents: number;
	activeChains: number;
	connectedChains: number;
	pipelineStats: ReturnType<EventPipeline["getStats"]>;
}

export class ChainsListener extends EventEmitter {
	private config = config;
	private chainManager: ChainManager;
	private eventPipeline: EventPipeline;
	private isRunning = false;
	private startTime = 0;
	private stats: {
		totalEvents: number;
		processedEvents: number;
		failedEvents: number;
	} = {
		totalEvents: 0,
		processedEvents: 0,
		failedEvents: 0,
	};

	constructor(options: ChainsListenerConfig = {}) {
		super();

		// Note: configPath option is no longer supported with direct TOML imports
		if (options.configPath) {
			console.warn('configPath option is deprecated with direct TOML imports');
		}

		this.eventPipeline = options.customPipeline || this.createDefaultPipeline();

		this.chainManager = new ChainManager(this.eventPipeline, {
			maxConcurrentConnections: this.config.performance.max_concurrent_requests,
			healthCheckInterval: 30000,
			reconnectDelay: 5000,
			enableAutoReconnect: true,
		});

		this.setupChainAdapters(options.enabledChains);
		this.setupEventListeners();
	}

	public async start(): Promise<void> {
		if (this.isRunning) {
			throw new Error("ChainsListener is already running");
		}

		try {
			this.startTime = Date.now();
			this.isRunning = true;

			this.emit("starting");

			await this.setupMonitoringTargets();
			await this.chainManager.start();

			this.emit("started");
		} catch (error) {
			this.isRunning = false;
			this.emit("error", error);
			throw error;
		}
	}

	public async stop(): Promise<void> {
		if (!this.isRunning) {
			return;
		}

		try {
			this.emit("stopping");

			await this.chainManager.stop();
			await this.cleanupNotifiers();

			this.isRunning = false;
			this.emit("stopped");
		} catch (error) {
			this.emit("error", error);
			throw error;
		}
	}

	public async addWalletAddress(
		address: string,
		chains?: ChainType[],
	): Promise<void> {
		const targetChains = chains || this.chainManager.getSupportedChains();

		const target: MonitoringTarget = {
			type: "address",
			address,
			eventTypes: [EventType.TRANSFER, EventType.NATIVE_TRANSFER],
		};

		const promises = targetChains.map(async (chainType) => {
			if (this.chainManager.isChainSupported(chainType)) {
				await this.chainManager.addMonitoringTarget(chainType, target);
			}
		});

		await Promise.allSettled(promises);
		this.emit("walletAdded", address, targetChains);
	}

	public async removeWalletAddress(
		address: string,
		chains?: ChainType[],
	): Promise<void> {
		const targetChains = chains || this.chainManager.getSupportedChains();

		const promises = targetChains.map(async (chainType) => {
			if (this.chainManager.isChainSupported(chainType)) {
				await this.chainManager.removeMonitoringTarget(chainType, address);
			}
		});

		await Promise.allSettled(promises);
		this.emit("walletRemoved", address, targetChains);
	}

	public async addTokenContract(
		address: string,
		chains?: ChainType[],
	): Promise<void> {
		const targetChains =
			chains ||
			this.chainManager
				.getSupportedChains()
				.filter(
					(chain) => 
						chain === ChainType.ETHEREUM || 
						chain === ChainType.BSC ||
						chain === ChainType.SUI ||
						chain === ChainType.TRX,
				);

		const target: MonitoringTarget = {
			type: "contract",
			address,
			eventTypes: [EventType.TOKEN_MINT, EventType.TRANSFER],
		};

		const promises = targetChains.map(async (chainType) => {
			if (this.chainManager.isChainSupported(chainType)) {
				await this.chainManager.addMonitoringTarget(chainType, target);
			}
		});

		await Promise.allSettled(promises);
		this.emit("contractAdded", address, targetChains);
	}

	public async removeTokenContract(
		address: string,
		chains?: ChainType[],
	): Promise<void> {
		const targetChains = chains || this.chainManager.getSupportedChains();

		const promises = targetChains.map(async (chainType) => {
			if (this.chainManager.isChainSupported(chainType)) {
				await this.chainManager.removeMonitoringTarget(chainType, address);
			}
		});

		await Promise.allSettled(promises);
		this.emit("contractRemoved", address, targetChains);
	}

	public getStats(): ChainsListenerStats {
		const chainStats = this.chainManager.getStats();

		return {
			uptime: this.isRunning ? Date.now() - this.startTime : 0,
			totalEvents: this.stats.totalEvents,
			processedEvents: this.stats.processedEvents,
			failedEvents: this.stats.failedEvents,
			activeChains: chainStats.activeChains,
			connectedChains: chainStats.connectedChains,
			pipelineStats: chainStats.pipelineStats,
		};
	}

	public getChainStatuses() {
		return this.chainManager.getAllChainStatuses();
	}

	public getSupportedChains(): ChainType[] {
		return this.chainManager.getSupportedChains();
	}

	public isChainSupported(chainType: ChainType): boolean {
		return this.chainManager.isChainSupported(chainType);
	}

	public getEventPipeline(): EventPipeline {
		return this.eventPipeline;
	}

	public async reloadConfiguration(configPath?: string): Promise<void> {
		try {
			// Note: Configuration reloading is not supported with direct TOML imports
			// The application must be restarted to reload configuration
			if (configPath) {
				console.warn('configPath option is deprecated with direct TOML imports');
			}
			
			console.warn('Configuration reloading requires application restart with direct TOML imports');
			this.emit("configReloaded");
		} catch (error) {
			this.emit("error", error);
			throw error;
		}
	}

	public async testConnections(): Promise<Record<ChainType, boolean>> {
		const results: Record<ChainType, boolean> = {} as any;
		const supportedChains = this.getSupportedChains();

		const promises = supportedChains.map(async (chainType) => {
			try {
				const adapter = this.chainManager.getAdapter(chainType);
				if (adapter) {
					const status = adapter.getConnectionStatus();
					results[chainType] = status.connected;
				} else {
					results[chainType] = false;
				}
			} catch {
				results[chainType] = false;
			}
		});

		await Promise.allSettled(promises);
		return results;
	}

	private setupChainAdapters(enabledChains?: ChainType[]): void {
		const chainsToEnable = enabledChains || [
			ChainType.ETHEREUM,
			ChainType.BSC,
			ChainType.SOLANA,
			ChainType.SUI,
			ChainType.TRX,
		];

		if (chainsToEnable.includes(ChainType.ETHEREUM)) {
			const ethereumAdapter = new EthereumAdapter();
			this.chainManager.registerAdapter(ethereumAdapter);
		}

		if (chainsToEnable.includes(ChainType.BSC)) {
			const bscAdapter = new BSCAdapter();
			this.chainManager.registerAdapter(bscAdapter);
		}

		if (chainsToEnable.includes(ChainType.SOLANA)) {
			const solanaAdapter = new SolanaAdapter();
			this.chainManager.registerAdapter(solanaAdapter);
		}

		if (chainsToEnable.includes(ChainType.SUI)) {
			const suiAdapter = new SuiAdapter();
			this.chainManager.registerAdapter(suiAdapter);
		}

		if (chainsToEnable.includes(ChainType.TRX)) {
			const tronAdapter = new TronAdapter();
			this.chainManager.registerAdapter(tronAdapter);
		}
	}

	private createDefaultPipeline(): EventPipeline {
		const factory = new PipelineFactory();
		return factory.createDefaultPipeline();
	}

	private setupEventListeners(): void {
		this.chainManager.on("eventProcessed", (event: ProcessedEvent) => {
			this.stats.totalEvents++;
			this.stats.processedEvents++;
			this.emit("eventProcessed", event);
		});

		this.chainManager.on("eventProcessingError", (originalEvent, error) => {
			this.stats.totalEvents++;
			this.stats.failedEvents++;
			this.emit("eventProcessingError", originalEvent, error);
		});

		this.chainManager.on("chainStatusUpdate", (chainType, status) => {
			this.emit("chainStatusUpdate", chainType, status);
		});

		this.chainManager.on("chainError", (chainType, error) => {
			this.emit("chainError", chainType, error);
		});

		this.chainManager.on("managerStarted", () => {
			this.emit("chainsConnected");
		});

		this.chainManager.on("managerStopped", () => {
			this.emit("chainsDisconnected");
		});
	}

	private async setupMonitoringTargets(): Promise<void> {
		const promises: Promise<void>[] = [];

		for (const address of this.config.targets.addresses.watch_addresses) {
			promises.push(this.addWalletAddress(address));
		}

		for (const contract of this.config.targets.contracts.erc20_contracts) {
			promises.push(
				this.addTokenContract(contract, [ChainType.ETHEREUM, ChainType.BSC]),
			);
		}

		for (const contract of this.config.targets.contracts.erc721_contracts) {
			promises.push(
				this.addTokenContract(contract, [ChainType.ETHEREUM, ChainType.BSC]),
			);
		}

		await Promise.allSettled(promises);
	}

	private async cleanupNotifiers(): Promise<void> {
		try {
			const stats = this.eventPipeline.getStats();
			if (stats.notifiers > 0) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		} catch (error) {
			console.error("Error during notifier cleanup:", error);
		}
	}

	public on(event: "starting", listener: () => void): this;
	public on(event: "started", listener: () => void): this;
	public on(event: "stopping", listener: () => void): this;
	public on(event: "stopped", listener: () => void): this;
	public on(
		event: "eventProcessed",
		listener: (event: ProcessedEvent) => void,
	): this;
	public on(
		event: "eventProcessingError",
		listener: (originalEvent: any, error: Error) => void,
	): this;
	public on(
		event: "chainStatusUpdate",
		listener: (chainType: ChainType, status: any) => void,
	): this;
	public on(
		event: "chainError",
		listener: (chainType: ChainType, error: Error) => void,
	): this;
	public on(event: "chainsConnected", listener: () => void): this;
	public on(event: "chainsDisconnected", listener: () => void): this;
	public on(
		event: "walletAdded",
		listener: (address: string, chains: ChainType[]) => void,
	): this;
	public on(
		event: "walletRemoved",
		listener: (address: string, chains: ChainType[]) => void,
	): this;
	public on(
		event: "contractAdded",
		listener: (address: string, chains: ChainType[]) => void,
	): this;
	public on(
		event: "contractRemoved",
		listener: (address: string, chains: ChainType[]) => void,
	): this;
	public on(event: "configReloaded", listener: () => void): this;
	public on(event: "error", listener: (error: Error) => void): this;
	public on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}
}
