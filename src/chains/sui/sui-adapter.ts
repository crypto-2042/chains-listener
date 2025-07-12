import { type BlockchainEvent, ChainType, EventType } from "@/types/events";
import config from "@/config.toml";
import { SuiClient, getFullnodeUrl } from "@mysten/sui.js/client";
import {
	type ChainAdapterConfig,
	type ConnectionStatus,
	IChainAdapter,
	type MonitoringTarget,
} from "../base/chain-adapter.interface";

export interface SuiChainAdapterConfig extends ChainAdapterConfig {
	network?: "mainnet" | "testnet" | "devnet";
	requestTimeoutMs?: number;
}

interface SuiMonitoringTarget extends MonitoringTarget {
	packageId?: string;
	moduleId?: string;
}

export class SuiAdapter extends IChainAdapter {
	private client: SuiClient | null = null;
	private suiConfig: SuiChainAdapterConfig;
	private monitoringActive = false;
	private currentCheckpoint = 0;
	private eventSubscriptions: Map<string, any> = new Map();
	private heartbeatTimer?: NodeJS.Timeout;
	private eventPollingTimer?: NodeJS.Timeout;
	public readonly chainType = ChainType.SUI;

	// Common Sui event types for monitoring
	private readonly SUI_TRANSFER_EVENT_TYPE = "0x2::coin::CoinMetadata";
	private readonly SUI_PACKAGE_PUBLISH_EVENT = "0x2::package::UpgradeCap";


	constructor() {
		const suiConfig: SuiChainAdapterConfig = {
			rpcUrl: config.chains.sui.rpc_url,
			websocketUrl: config.chains.sui.websocket_url,
			maxRetryAttempts: config.chains.sui.max_retry_attempts,
			network: "mainnet",
			requestTimeoutMs: 30000,
		};

		super(suiConfig);
		this.suiConfig = suiConfig;
	}

	async connect(): Promise<void> {
		try {
			this.client = new SuiClient({
				url: this.suiConfig.rpcUrl,
			});

			// Test connection
			await this.getCurrentBlockNumber();
			this.connected = true;

			this.startHeartbeat();
			this.emit("connectionStatus", this.getConnectionStatus());
		} catch (error) {
			this.connected = false;
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.emit("error", new Error(`Failed to connect to Sui network: ${errorMessage}`));
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		try {
			this.stopHeartbeat();
			this.stopEventPolling();
			this.connected = false;
			this.client = null;
			this.emit("connectionStatus", this.getConnectionStatus());
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.emit("error", new Error(`Error disconnecting from Sui: ${errorMessage}`));
		}
	}

	getConnectionStatus(): ConnectionStatus {
		return {
			connected: this.connected,
			lastHeartbeat: Date.now(),
			blockHeight: this.currentCheckpoint,
			syncStatus: this.connected ? "synced" : "error",
			errors: [],
		};
	}

	async getCurrentBlockNumber(): Promise<number> {
		if (!this.client) {
			throw new Error("Sui client not connected");
		}

		return await this.retry(
			async () => {
				const latestCheckpoint = await this.client!.getLatestCheckpointSequenceNumber();
				this.currentCheckpoint = parseInt(latestCheckpoint);
				return this.currentCheckpoint;
			},
			"getCurrentBlockNumber",
		);
	}

	async addMonitoringTarget(target: MonitoringTarget): Promise<void> {
		this.validateMonitoringTarget(target);
		
		const suiTarget: SuiMonitoringTarget = {
			...target,
			packageId: target.metadata?.packageId as string,
			moduleId: target.metadata?.moduleId as string,
		};

		this.monitoringTargets.set(target.address, suiTarget);

		if (this.monitoringActive) {
			await this.subscribeToTarget(suiTarget);
		}
	}

	async removeMonitoringTarget(address: string): Promise<void> {
		if (this.monitoringTargets.has(address)) {
			this.unsubscribeFromTarget(address);
			this.monitoringTargets.delete(address);
		}
	}

	async startMonitoring(): Promise<void> {
		if (!this.connected || this.monitoringActive) {
			return;
		}

		this.monitoringActive = true;

		// Subscribe to all configured targets
		for (const target of this.monitoringTargets.values()) {
			await this.subscribeToTarget(target as SuiMonitoringTarget);
		}

		// Start event polling since WebSocket subscriptions are deprecated
		this.startEventPolling();
	}

	async stopMonitoring(): Promise<void> {
		if (!this.monitoringActive) {
			return;
		}

		this.monitoringActive = false;
		this.stopEventPolling();

		// Clear all subscriptions
		for (const address of this.monitoringTargets.keys()) {
			this.unsubscribeFromTarget(address);
		}
	}

	async getTransactionDetails(txHash: string): Promise<BlockchainEvent | null> {
		if (!this.client) {
			return null;
		}

		try {
			const txResponse = await this.client.getTransactionBlock({
				digest: txHash,
				options: {
					showEvents: true,
					showEffects: true,
					showInput: true,
				},
			});

			return this.parseTransactionToEvent(txResponse);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.emit("error", new Error(`Failed to get Sui transaction details: ${errorMessage}`));
			return null;
		}
	}

	validateAddress(address: string): boolean {
		// Sui addresses are 32-byte hex strings with 0x prefix
		if (!address || typeof address !== "string") {
			return false;
		}

		// Check for proper Sui address format: 0x followed by 64 hex characters (32 bytes)
		const suiAddressRegex = /^0x[a-fA-F0-9]{64}$/;
		return suiAddressRegex.test(address);
	}

	async estimateGas(transaction: unknown): Promise<string> {
		// Sui uses a different gas model - return a reasonable default
		// In Sui, gas is calculated based on computation and storage costs
		return "100000"; // Default gas estimate for Sui transactions
	}

	private async subscribeToTarget(target: SuiMonitoringTarget): Promise<void> {
		try {
			// In Sui, we monitor events rather than accounts directly
			// This is a placeholder for event monitoring logic
			const subscriptionId = `${target.address}_${Date.now()}`;
			this.eventSubscriptions.set(target.address, subscriptionId);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.emit("error", new Error(`Failed to subscribe to Sui target: ${errorMessage}`));
		}
	}

	private unsubscribeFromTarget(address: string): void {
		if (this.eventSubscriptions.has(address)) {
			this.eventSubscriptions.delete(address);
		}
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(async () => {
			try {
				await this.getCurrentBlockNumber();
				this.emit("connectionStatus", this.getConnectionStatus());
			} catch (error) {
				this.connected = false;
				this.emit("connectionStatus", this.getConnectionStatus());
			}
		}, 30000); // 30 seconds
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}

	private startEventPolling(): void {
		// Poll for events every 5 seconds
		this.eventPollingTimer = setInterval(async () => {
			await this.pollForEvents();
		}, 5000);
	}

	private stopEventPolling(): void {
		if (this.eventPollingTimer) {
			clearInterval(this.eventPollingTimer);
			this.eventPollingTimer = undefined;
		}
	}

	private async pollForEvents(): Promise<void> {
		if (!this.client || !this.monitoringActive) {
			return;
		}

		try {
			// Query recent events
			const events = await this.client.queryEvents({
				query: { "All": [] },
				limit: 50,
				order: "descending",
			});

			for (const event of events.data) {
				await this.processEvent(event);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.emit("error", new Error(`Error polling Sui events: ${errorMessage}`));
		}
	}

	private async processEvent(event: any): Promise<void> {
		try {
			const blockchainEvent = await this.parseEventToBlockchainEvent(event);
			if (blockchainEvent && this.isEventRelevant(blockchainEvent)) {
				this.emit("blockchainEvent", blockchainEvent);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.emit("error", new Error(`Error processing Sui event: ${errorMessage}`));
		}
	}

	private async parseEventToBlockchainEvent(event: any): Promise<BlockchainEvent | null> {
		try {
			// Determine event type based on Sui event structure
			const eventType = this.determineSuiEventType(event);
			if (!eventType) {
				return null;
			}

			return {
				id: `${this.chainType}_${event.id.txDigest}_${event.id.eventSeq}`,
				chainType: this.chainType,
				eventType,
				blockNumber: parseInt(event.timestampMs || "0"),
				transactionHash: event.id.txDigest,
				timestamp: parseInt(event.timestampMs || "0"),
				data: {
					from: this.extractAddressFromEvent(event, "sender"),
					to: this.extractAddressFromEvent(event, "recipient"),
					amount: this.extractAmountFromEvent(event),
					tokenAddress: this.extractTokenAddressFromEvent(event),
					metadata: {
						suiEvent: event,
						packageId: event.packageId,
						transactionModule: event.transactionModule,
					},
				},
				confirmed: true,
				confirmationCount: 1,
			};
		} catch (error) {
			return null;
		}
	}

	private parseTransactionToEvent(txResponse: any): BlockchainEvent | null {
		try {
			if (!txResponse.events || txResponse.events.length === 0) {
				return null;
			}

			// Use the first event for simplicity
			const event = txResponse.events?.[0];
			if (!event) {
				return null;
			}

			const eventType = this.determineSuiEventType(event);
			
			if (!eventType) {
				return null;
			}

			return {
				id: `${this.chainType}_${txResponse.digest}`,
				chainType: this.chainType,
				eventType,
				blockNumber: parseInt(txResponse.checkpoint || "0"),
				transactionHash: txResponse.digest,
				timestamp: parseInt(txResponse.timestampMs || "0"),
				data: {
					from: this.extractAddressFromEvent(event, "sender"),
					to: this.extractAddressFromEvent(event, "recipient"),
					amount: this.extractAmountFromEvent(event),
					tokenAddress: this.extractTokenAddressFromEvent(event),
					gasUsed: txResponse.effects?.gasUsed?.computationCost?.toString(),
					metadata: {
						suiTransaction: txResponse,
						checkpoint: txResponse.checkpoint,
					},
				},
				confirmed: true,
				confirmationCount: 1,
			};
		} catch (error) {
			return null;
		}
	}

	private determineSuiEventType(event: any): EventType | null {
		const eventType = event.type;

		if (eventType.includes("::coin::") || eventType.includes("Transfer")) {
			return EventType.TRANSFER;
		}

		if (eventType.includes("Mint") || eventType.includes("mint")) {
			return EventType.TOKEN_MINT;
		}

		if (eventType.includes("Burn") || eventType.includes("burn")) {
			return EventType.TOKEN_BURN;
		}

		// Default to transfer for unknown types
		return EventType.TRANSFER;
	}

	private extractAddressFromEvent(event: any, field: string): string | undefined {
		try {
			if (event.parsedJson && typeof event.parsedJson === "object") {
				const data = event.parsedJson as Record<string, any>;
				return data[field] as string;
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	private extractAmountFromEvent(event: any): string | undefined {
		try {
			if (event.parsedJson && typeof event.parsedJson === "object") {
				const data = event.parsedJson as Record<string, any>;
				return data.amount?.toString() || data.value?.toString();
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	private extractTokenAddressFromEvent(event: any): string | undefined {
		try {
			// In Sui, token type is part of the event type
			const typeParams = event.type.match(/<(.+)>/);
			return typeParams ? typeParams[1] : undefined;
		} catch {
			return undefined;
		}
	}

	private isEventRelevant(event: BlockchainEvent): boolean {
		// Check if any of our monitoring targets are interested in this event
		for (const target of this.monitoringTargets.values()) {
			if (target.eventTypes.includes(event.eventType)) {
				// Check if addresses match
				if (event.data.from === target.address || 
				    event.data.to === target.address ||
				    event.data.tokenAddress === target.address) {
					return true;
				}
			}
		}
		return false;
	}
}