import { type BlockchainEvent, ChainType, EventType } from "../../types/events";
import config from "@/config.toml";
import {
	type ChainAdapterConfig,
	type ConnectionStatus,
	IChainAdapter,
	type MonitoringTarget,
} from "../base/chain-adapter.interface";
import TronWeb from "tronweb";
import { decode } from "bs58";

export interface TronChainAdapterConfig extends ChainAdapterConfig {
	blockConfirmationCount: number;
	solidity?: {
		node: string;
		privateKey?: string;
	};
	event?: {
		node: string;
	};
}

export class TronAdapter extends IChainAdapter {
	private tronWeb: TronWeb | null = null;
	private tronConfig: TronChainAdapterConfig;
	private monitoringActive = false;
	private currentBlock = 0;
	private eventSubscriptions: Map<string, any> = new Map();
	private heartbeatTimer?: NodeJS.Timeout;
	private pollingTimer?: NodeJS.Timeout;
	public readonly chainType = ChainType.TRX;

	// TRC-20/TRC-721 event signatures (same as ERC standards)
	private readonly TRC20_TRANSFER_TOPIC =
		"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
	private readonly TRC20_MINT_TOPICS = [
		"0x0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d4121396885", // Mint(address,uint256)
		"0xab8530f87dc9b59234c4623bf917212bb2536d647574c8e7e5da92c2ede0c9f8", // Transfer(address,address,uint256) from 0x0
	];

	constructor() {
		const tronConfig: TronChainAdapterConfig = {
			rpcUrl: config.chains.trx.rpc_url,
			websocketUrl: config.chains.trx.websocket_url,
			maxRetryAttempts: config.chains.trx.max_retry_attempts,
			blockConfirmationCount: config.chains.trx.block_confirmation_count,
			pollingInterval: config.monitoring.transfers.polling_interval_ms,
			batchSize: config.monitoring.transfers.batch_size,
		};

		super(tronConfig);
		this.tronConfig = tronConfig;
	}

	async connect(): Promise<void> {
		try {
			this.tronWeb = new TronWeb({
				fullHost: this.tronConfig.rpcUrl,
				headers: { "TRON-PRO-API-KEY": "your-api-key" },
				privateKey: "01", // Dummy private key for read-only operations
			});

			// Test connection
			const nodeInfo = await this.tronWeb.trx.getNodeInfo();
			this.currentBlock = await this.tronWeb.trx.getCurrentBlock();

			this.connected = true;
			this.retryCount = 0;

			this.startHeartbeat();
			this.emit("connectionStatus", this.getConnectionStatus());
		} catch (error) {
			throw new Error(`Failed to connect to TRON: ${error}`);
		}
	}

	async disconnect(): Promise<void> {
		this.connected = false;
		this.monitoringActive = false;

		this.stopHeartbeat();
		this.stopPolling();

		this.tronWeb = null;
		this.emit("connectionStatus", this.getConnectionStatus());
	}

	getConnectionStatus(): ConnectionStatus {
		return {
			connected: this.connected,
			lastHeartbeat: Date.now(),
			blockHeight: this.currentBlock?.number || 0,
			syncStatus: this.connected ? "synced" : "error",
			errors: [],
		};
	}

	async getCurrentBlockNumber(): Promise<number> {
		if (!this.tronWeb) {
			throw new Error("TronWeb not connected");
		}

		return await this.retry(async () => {
			const block = await this.tronWeb?.trx.getCurrentBlock();
			return block?.block_header?.raw_data?.number || 0;
		}, "getCurrentBlockNumber");
	}

	async addMonitoringTarget(target: MonitoringTarget): Promise<void> {
		this.validateMonitoringTarget(target);
		this.monitoringTargets.set(target.address, target);

		if (this.monitoringActive) {
			await this.setupTargetMonitoring(target);
		}
	}

	async removeMonitoringTarget(address: string): Promise<void> {
		const target = this.monitoringTargets.get(address);
		if (target) {
			await this.removeTargetMonitoring(address);
			this.monitoringTargets.delete(address);
		}
	}

	async startMonitoring(): Promise<void> {
		if (!this.connected || !this.tronWeb) {
			throw new Error("Must be connected before starting monitoring");
		}

		this.monitoringActive = true;

		const targets = Array.from(this.monitoringTargets.values());
		for (const target of targets) {
			await this.setupTargetMonitoring(target);
		}

		this.startPolling();
	}

	async stopMonitoring(): Promise<void> {
		this.monitoringActive = false;
		this.stopPolling();
		this.eventSubscriptions.clear();
	}

	async getTransactionDetails(txHash: string): Promise<BlockchainEvent | null> {
		if (!this.tronWeb) {
			throw new Error("TronWeb not connected");
		}

		try {
			const transaction = await this.tronWeb.trx.getTransaction(txHash);
			if (!transaction) {
				return null;
			}

			return this.parseTransactionToEvent(transaction);
		} catch (error) {
			console.error(`Failed to get transaction details for ${txHash}:`, error);
			return null;
		}
	}

	validateAddress(address: string): boolean {
		// TRON addresses use Base58 encoding and start with 'T' for mainnet
		// They are 34 characters long
		if (!address || typeof address !== "string") {
			return false;
		}

		// Check for TRON Base58 address format
		if (/^T[A-HJ-NP-Za-km-z1-9]{33}$/.test(address)) {
			try {
				// Validate Base58 encoding
				const decoded = decode(address);
				return decoded.length === 25; // 21 bytes + 4 byte checksum
			} catch {
				return false;
			}
		}

		// Also support hex format for contract addresses
		if (/^(0x)?[a-fA-F0-9]{40}$/.test(address)) {
			return true;
		}

		return false;
	}


	async estimateGas(transaction: unknown): Promise<string> {
		// TRON uses energy/bandwidth model instead of gas
		// Return a reasonable default for compatibility
		if (!this.tronWeb) {
			return "100000";
		}

		try {
			// For TRON, we estimate energy consumption
			// This is a simplified approach
			return "100000"; // Default energy estimate
		} catch (error) {
			return "100000";
		}
	}

	private async setupTargetMonitoring(target: MonitoringTarget): Promise<void> {
		if (!this.tronWeb || !this.monitoringActive) {
			return;
		}

		try {
			// Set up monitoring based on target type and event types
			if (target.eventTypes.includes(EventType.TRANSFER)) {
				await this.setupTransferMonitoring(target);
			}

			if (target.eventTypes.includes(EventType.TOKEN_MINT)) {
				await this.setupMintingMonitoring(target);
			}
		} catch (error) {
			console.error(`Failed to setup monitoring for ${target.address}:`, error);
		}
	}

	private async setupTransferMonitoring(target: MonitoringTarget): Promise<void> {
		// Store monitoring configuration for polling
		this.eventSubscriptions.set(`transfer_${target.address}`, {
			type: "transfer",
			address: target.address,
			target,
		});
	}

	private async setupMintingMonitoring(target: MonitoringTarget): Promise<void> {
		// Store monitoring configuration for polling
		this.eventSubscriptions.set(`mint_${target.address}`, {
			type: "mint",
			address: target.address,
			target,
		});
	}

	private startPolling(): void {
		this.pollingTimer = setInterval(async () => {
			await this.pollForEvents();
		}, this.tronConfig.pollingInterval || 5000);
	}

	private stopPolling(): void {
		if (this.pollingTimer) {
			clearInterval(this.pollingTimer);
			this.pollingTimer = undefined;
		}
	}

	private async pollForEvents(): Promise<void> {
		if (!this.tronWeb || !this.monitoringActive) {
			return;
		}

		try {
			// Get recent blocks and check for relevant events
			for (const [key, subscription] of this.eventSubscriptions) {
				await this.checkSubscriptionEvents(subscription);
			}
		} catch (error) {
			console.error("Error polling for TRON events:", error);
		}
	}

	private async checkSubscriptionEvents(subscription: any): Promise<void> {
		if (!this.tronWeb) return;

		try {
			const target = subscription.target as MonitoringTarget;
			
			// For contract addresses, get transaction events
			if (target.type === "contract") {
				const events = await this.tronWeb.event.getEventsByContractAddress(
					target.address,
					{
						sinceTimestamp: Date.now() - 60000, // Last minute
						limit: 50,
					}
				);

				for (const event of events) {
					await this.handleContractEvent(event, target);
				}
			}
			
			// For address monitoring, check transactions
			if (target.type === "address") {
				const transactions = await this.tronWeb.trx.getAccount(target.address);
				// Process recent transactions (simplified)
			}
		} catch (error) {
			console.error("Error checking subscription events:", error);
		}
	}

	private async handleContractEvent(event: any, target: MonitoringTarget): Promise<void> {
		try {
			const blockchainEvent = await this.parseContractEventToBlockchainEvent(event, target);
			if (blockchainEvent) {
				this.emit("blockchainEvent", blockchainEvent);
			}
		} catch (error) {
			console.error("Error handling contract event:", error);
		}
	}

	private async parseContractEventToBlockchainEvent(
		event: any,
		target: MonitoringTarget,
	): Promise<BlockchainEvent | null> {
		try {
			const eventType = this.determineEventTypeFromTronEvent(event);
			if (!eventType) return null;

			return {
				id: this.generateEventId(event.transaction_id, event.event_index),
				chainType: this.chainType,
				eventType,
				blockNumber: event.block_number,
				transactionHash: event.transaction_id,
				timestamp: event.block_timestamp,
				confirmed: true,
				confirmationCount: 1,
				data: {
					from: event.result?.from || event.result?._from,
					to: event.result?.to || event.result?._to,
					amount: event.result?.value || event.result?._value,
					tokenAddress: event.contract_address,
					metadata: {
						tronEvent: event,
						eventName: event.event_name,
						contractType: event.contract_type,
					},
				},
			};
		} catch (error) {
			console.error("Error parsing TRON event:", error);
			return null;
		}
	}

	private determineEventTypeFromTronEvent(event: any): EventType | null {
		const eventName = event.event_name?.toLowerCase() || "";

		if (eventName.includes("transfer")) {
			return EventType.TRANSFER;
		}

		if (eventName.includes("mint")) {
			return EventType.TOKEN_MINT;
		}

		if (eventName.includes("burn")) {
			return EventType.TOKEN_BURN;
		}

		// Check event signature for standard events
		if (event.topics && event.topics[0] === this.TRC20_TRANSFER_TOPIC) {
			return EventType.TRANSFER;
		}

		return null;
	}

	private async parseTransactionToEvent(transaction: any): Promise<BlockchainEvent | null> {
		try {
			// Basic transaction parsing for TRON
			return {
				id: this.generateEventId(transaction.txID),
				chainType: this.chainType,
				eventType: EventType.TRANSFER,
				blockNumber: transaction.block_header?.raw_data?.number || 0,
				transactionHash: transaction.txID,
				timestamp: transaction.block_header?.raw_data?.timestamp || Date.now(),
				confirmed: true,
				confirmationCount: 1,
				data: {
					metadata: {
						tronTransaction: transaction,
					},
				},
			};
		} catch (error) {
			console.error("Error parsing TRON transaction:", error);
			return null;
		}
	}

	private async removeTargetMonitoring(address: string): Promise<void> {
		const subscriptionKeys = [
			`transfer_${address}`,
			`mint_${address}`,
		];

		for (const key of subscriptionKeys) {
			this.eventSubscriptions.delete(key);
		}
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(async () => {
			try {
				if (this.tronWeb) {
					await this.getCurrentBlockNumber();
				}
			} catch (error) {
				this.emit("error", new Error(`Heartbeat failed: ${error}`));
			}
		}, 30000);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
	}
}
