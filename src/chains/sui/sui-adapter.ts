import { type BlockchainEvent, ChainType, EventType } from "../../types/events";
import { SuiClient, getFullnodeUrl } from "@mysten/sui.js/client";
import { SuiEventFilter, PaginatedEvents, SuiEvent, EventId } from "@mysten/sui.js/client";
import config from "@/config.toml";
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
	private subscriptionTimer?: NodeJS.Timeout;
	public readonly chainType = ChainType.SUI;
	private processedEvents: Set<string> = new Set();
	private lastProcessedCheckpoint = 0;

	// Common Sui event types for monitoring
	private readonly SUI_COIN_EVENTS = {
		TRANSFER: "0x2::pay::PayTxn",
		MINT: "0x2::coin::MintEvent",
		BURN: "0x2::coin::BurnEvent",
	};
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
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.emit(
				"error",
				new Error(`Failed to connect to Sui network: ${errorMessage}`),
			);
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
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.emit(
				"error",
				new Error(`Error disconnecting from Sui: ${errorMessage}`),
			);
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

		return await this.retry(async () => {
			const latestCheckpoint =
				await this.client?.getLatestCheckpointSequenceNumber();
			this.currentCheckpoint = Number.parseInt(latestCheckpoint);
			return this.currentCheckpoint;
		}, "getCurrentBlockNumber");
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

		// Start real-time event subscription
		this.startEventSubscription();
	}

	async stopMonitoring(): Promise<void> {
		if (!this.monitoringActive) {
			return;
		}

		this.monitoringActive = false;
		this.stopEventSubscription();

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
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.emit(
				"error",
				new Error(`Failed to get Sui transaction details: ${errorMessage}`),
			);
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
		if (!this.client) {
			return "100000";
		}
		
		try {
			// For real gas estimation, we'd need to dry run the transaction
			// This is a simplified approach returning typical gas costs
			const gasPrice = await this.client.getReferenceGasPrice();
			return (BigInt(gasPrice) * 1000n).toString(); // Estimate ~1000 gas units
		} catch {
			return "100000"; // Fallback default
		}
	}

	private async subscribeToTarget(target: SuiMonitoringTarget): Promise<void> {
		try {
			// In Sui, we monitor events rather than accounts directly
			// This is a placeholder for event monitoring logic
			const subscriptionId = `${target.address}_${Date.now()}`;
			this.eventSubscriptions.set(target.address, subscriptionId);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.emit(
				"error",
				new Error(`Failed to subscribe to Sui target: ${errorMessage}`),
			);
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

	private startEventSubscription(): void {
		// Use shorter intervals for near real-time monitoring
		this.subscriptionTimer = setInterval(async () => {
			await this.subscribeToEvents();
		}, 1000); // 1 second for near real-time
	}

	private stopEventSubscription(): void {
		if (this.subscriptionTimer) {
			clearInterval(this.subscriptionTimer);
			this.subscriptionTimer = undefined;
		}
	}

	private async subscribeToEvents(): Promise<void> {
		if (!this.client || !this.monitoringActive) {
			return;
		}

		try {
			// Get current checkpoint
			const currentCheckpoint = await this.getCurrentBlockNumber();
			
			// Query events from last processed checkpoint
			const fromCheckpoint = this.lastProcessedCheckpoint || Math.max(0, currentCheckpoint - 10);
			
			// Create targeted event filters for our monitoring targets
			const eventFilters = this.createEventFilters();
			
			for (const filter of eventFilters) {
				try {
					const events = await this.client.queryEvents({
						query: filter,
						limit: 50,
						order: "ascending",
					});

					for (const event of events.data) {
						if (!this.processedEvents.has(event.id.txDigest + event.id.eventSeq)) {
							await this.processEvent(event);
							this.processedEvents.add(event.id.txDigest + event.id.eventSeq);
						}
					}
				} catch (filterError) {
					// Continue with other filters if one fails
					console.debug("Filter query failed:", filterError);
				}
			}
			
			this.lastProcessedCheckpoint = currentCheckpoint;
			
			// Clean up old processed events to prevent memory leak
			if (this.processedEvents.size > 10000) {
				this.processedEvents.clear();
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.emit(
				"error",
				new Error(`Error subscribing to Sui events: ${errorMessage}`),
			);
		}
	}

	private createEventFilters(): SuiEventFilter[] {
		const filters: SuiEventFilter[] = [];
		
		// Add filters for each monitoring target
		for (const target of this.monitoringTargets.values()) {
			const suiTarget = target as SuiMonitoringTarget;
			
			if (target.eventTypes.includes(EventType.TRANSFER)) {
				// Coin transfer events
				filters.push({
					MoveEventType: "0x2::coin::CoinMetadata"
				});
				
				// Generic transfer events
				filters.push({
					MoveEventType: `${suiTarget.packageId || "0x2"}::pay::PayEvent`
				});
			}
			
			if (target.eventTypes.includes(EventType.TOKEN_MINT)) {
				// Mint events
				filters.push({
					MoveEventType: `${suiTarget.packageId || "0x2"}::coin::MintEvent`
				});
			}
			
			if (target.eventTypes.includes(EventType.TOKEN_BURN)) {
				// Burn events
				filters.push({
					MoveEventType: `${suiTarget.packageId || "0x2"}::coin::BurnEvent`
				});
			}
			
			// Package-specific events if specified
			if (suiTarget.packageId) {
				filters.push({
					Package: suiTarget.packageId
				});
			}
			
			// Module-specific events if specified
			if (suiTarget.packageId && suiTarget.moduleId) {
				filters.push({
					MoveModule: {
						package: suiTarget.packageId,
						module: suiTarget.moduleId
					}
				});
			}
		}
		
		// If no specific filters, monitor common events
		if (filters.length === 0) {
			filters.push(
				{ MoveEventType: "0x2::coin::CoinMetadata" },
				{ MoveEventType: "0x2::pay::PayEvent" },
				{ Package: "0x2" } // System package events
			);
		}
		
		return filters;
	}

	private async processEvent(event: any): Promise<void> {
		try {
			const blockchainEvent = await this.parseEventToBlockchainEvent(event);
			if (blockchainEvent && this.isEventRelevant(blockchainEvent)) {
				this.emit("blockchainEvent", blockchainEvent);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.emit(
				"error",
				new Error(`Error processing Sui event: ${errorMessage}`),
			);
		}
	}

	private async parseEventToBlockchainEvent(
		event: any,
	): Promise<BlockchainEvent | null> {
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
				blockNumber: Number.parseInt(event.timestampMs || "0"),
				transactionHash: event.id.txDigest,
				timestamp: Number.parseInt(event.timestampMs || "0"),
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
				blockNumber: Number.parseInt(txResponse.checkpoint || "0"),
				transactionHash: txResponse.digest,
				timestamp: Number.parseInt(txResponse.timestampMs || "0"),
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
		
		// More precise event type detection
		if (eventType.includes("::coin::MintEvent") || 
				eventType.includes("MintEvent") ||
				eventType.includes("Mint")) {
			return EventType.TOKEN_MINT;
		}
		
		if (eventType.includes("::coin::BurnEvent") || 
				eventType.includes("BurnEvent") ||
				eventType.includes("Burn")) {
			return EventType.TOKEN_BURN;
		}
		
		if (eventType.includes("::pay::") || 
				eventType.includes("::coin::") || 
				eventType.includes("Transfer") ||
				eventType.includes("PayEvent")) {
			return EventType.TRANSFER;
		}
		
		if (eventType.includes("::package::") || 
				eventType.includes("Publish")) {
			return EventType.CONTRACT_CREATION;
		}

		// Only return valid event types that we're monitoring
		return null;
	}

	private extractAddressFromEvent(
		event: any,
		field: string,
	): string | undefined {
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
				
				// Try multiple possible amount fields
				const amount = data.amount || data.value || data.balance || data.quantity;
				
				if (amount !== undefined) {
					// Handle both string and number amounts
					return typeof amount === 'string' ? amount : amount.toString();
				}
				
				// For coin events, amount might be in nested structure
				if (data.coin?.value) {
					return data.coin.value.toString();
				}
			}
			return "0";
		} catch {
			return "0";
		}
	}

	private extractTokenAddressFromEvent(event: any): string | undefined {
		try {
			// In Sui, token type is part of the event type parameters
			const typeParams = event.type.match(/<(.+)>/);
			if (typeParams && typeParams[1]) {
				return typeParams[1];
			}
			
			// Also check parsed JSON for coin type
			if (event.parsedJson && typeof event.parsedJson === "object") {
				const data = event.parsedJson as Record<string, any>;
				
				// Common patterns for token/coin type in Sui events
				const coinType = data.coin_type || data.coinType || data.type;
				if (coinType) {
					return coinType.toString();
				}
			}
			
			// Extract package ID as fallback
			if (event.packageId) {
				return event.packageId;
			}
			
			return undefined;
		} catch {
			return undefined;
		}
	}

	private isEventRelevant(event: BlockchainEvent): boolean {
		// Check if any of our monitoring targets are interested in this event
		for (const target of this.monitoringTargets.values()) {
			const suiTarget = target as SuiMonitoringTarget;
			
			if (target.eventTypes.includes(event.eventType)) {
				// Check address matching
				if (
					event.data.from === target.address ||
					event.data.to === target.address ||
					event.data.tokenAddress === target.address
				) {
					return true;
				}
				
				// Check package ID matching for Sui-specific filtering
				if (suiTarget.packageId && 
						event.data.metadata?.packageId === suiTarget.packageId) {
					return true;
				}
				
				// Check module ID matching
				if (suiTarget.moduleId && 
						event.data.metadata?.transactionModule === suiTarget.moduleId) {
					return true;
				}
			}
		}
		return false;
	}
}
