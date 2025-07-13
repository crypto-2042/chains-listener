import { type BlockchainEvent, ChainType, EventType } from "../../types/events";
import config from "@/config.toml";
import {
	type ChainAdapterConfig,
	type ConnectionStatus,
	IChainAdapter,
	type MonitoringTarget,
} from "../base/chain-adapter.interface";
import axios, { type AxiosInstance } from "axios";

export interface BitcoinChainAdapterConfig extends ChainAdapterConfig {
	blockConfirmationCount: number;
	apiKey?: string;
	network: "mainnet" | "testnet";
	utxoTrackingLimit: number;
}

interface BitcoinUTXO {
	txid: string;
	vout: number;
	value: number;
	address: string;
	confirmations: number;
	scriptPubKey: string;
}

interface BitcoinTransaction {
	txid: string;
	blockHeight: number;
	blockTime: number;
	inputs: Array<{
		txid: string;
		vout: number;
		address: string;
		value: number;
	}>;
	outputs: Array<{
		address: string;
		value: number;
		scriptPubKey: string;
	}>;
	fee: number;
	confirmations: number;
}

export class BitcoinAdapter extends IChainAdapter {
	private httpClient: AxiosInstance | null = null;
	private bitcoinConfig: BitcoinChainAdapterConfig;
	private monitoringActive = false;
	private currentBlockHeight = 0;
	private monitoredUTXOs: Map<string, BitcoinUTXO> = new Map();
	private heartbeatTimer?: NodeJS.Timeout;
	private blockPollingTimer?: NodeJS.Timeout;
	public readonly chainType = ChainType.BITCOIN;

	constructor() {
		const bitcoinConfig: BitcoinChainAdapterConfig = {
			rpcUrl: config.chains.bitcoin.rpc_url,
			websocketUrl: config.chains.bitcoin.websocket_url,
			maxRetryAttempts: config.chains.bitcoin.max_retry_attempts,
			blockConfirmationCount: 6, // Standard Bitcoin confirmations
			network: "mainnet",
			utxoTrackingLimit: 1000,
			pollingInterval: 30000, // 30 seconds for Bitcoin
			batchSize: 50,
		};

		super(bitcoinConfig);
		this.bitcoinConfig = bitcoinConfig;
	}

	async connect(): Promise<void> {
		try {
			this.httpClient = axios.create({
				baseURL: this.bitcoinConfig.rpcUrl,
				timeout: 30000,
				headers: {
					"Content-Type": "application/json",
				},
			});

			// Test connection by getting current block height
			await this.getCurrentBlockNumber();
			this.connected = true;
			this.retryCount = 0;

			this.startHeartbeat();
			this.emit("connectionStatus", this.getConnectionStatus());
		} catch (error) {
			throw new Error(`Failed to connect to Bitcoin: ${error}`);
		}
	}

	async disconnect(): Promise<void> {
		this.connected = false;
		this.monitoringActive = false;

		this.stopHeartbeat();
		this.stopBlockPolling();

		this.httpClient = null;
		this.monitoredUTXOs.clear();
		this.emit("connectionStatus", this.getConnectionStatus());
	}

	getConnectionStatus(): ConnectionStatus {
		return {
			connected: this.connected,
			lastHeartbeat: Date.now(),
			blockHeight: this.currentBlockHeight,
			syncStatus: this.connected ? "synced" : "error",
			errors: [],
		};
	}

	async getCurrentBlockNumber(): Promise<number> {
		if (!this.httpClient) {
			throw new Error("HTTP client not connected");
		}

		return await this.retry(async () => {
			const response = await this.httpClient?.get("/api/blocks/tip/height");
			this.currentBlockHeight = response?.data || 0;
			return this.currentBlockHeight;
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
		if (!this.connected || !this.httpClient) {
			throw new Error("Must be connected before starting monitoring");
		}

		this.monitoringActive = true;

		// Setup monitoring for all targets
		const targets = Array.from(this.monitoringTargets.values());
		for (const target of targets) {
			await this.setupTargetMonitoring(target);
		}

		// Start block polling to detect new transactions
		this.startBlockPolling();
	}

	async stopMonitoring(): Promise<void> {
		this.monitoringActive = false;
		this.stopBlockPolling();
		this.monitoredUTXOs.clear();
	}

	async getTransactionDetails(txHash: string): Promise<BlockchainEvent | null> {
		if (!this.httpClient) {
			throw new Error("HTTP client not connected");
		}

		try {
			const transaction = await this.fetchTransaction(txHash);
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
		// Bitcoin address validation (simplified)
		if (!address || typeof address !== "string") {
			return false;
		}

		// P2PKH addresses (start with 1)
		if (/^[1][A-HJ-NP-Za-km-z1-9]{25,34}$/.test(address)) {
			return true;
		}

		// P2SH addresses (start with 3)
		if (/^[3][A-HJ-NP-Za-km-z1-9]{25,34}$/.test(address)) {
			return true;
		}

		// Bech32 addresses (start with bc1)
		if (/^bc1[a-z0-9]{39,59}$/.test(address)) {
			return true;
		}

		// Testnet addresses
		if (this.bitcoinConfig.network === "testnet") {
			if (/^[mn2][A-HJ-NP-Za-km-z1-9]{25,34}$/.test(address) || 
				/^tb1[a-z0-9]{39,59}$/.test(address)) {
				return true;
			}
		}

		return false;
	}

	async estimateGas(): Promise<string> {
		// Bitcoin doesn't use gas, but fees per byte
		// Return a reasonable fee estimate in satoshis per byte
		try {
			if (!this.httpClient) {
				return "10"; // Default fee rate
			}

			const response = await this.httpClient.get("/api/v1/fees/recommended");
			const feeRate = response.data?.fastestFee || 10;
			return feeRate.toString();
		} catch {
			return "10"; // Default fee rate in sat/vB
		}
	}

	private async setupTargetMonitoring(target: MonitoringTarget): Promise<void> {
		if (!this.httpClient || !this.monitoringActive) {
			return;
		}

		try {
			// For Bitcoin, we monitor UTXO changes for addresses
			if (target.eventTypes.includes(EventType.TRANSFER) || 
				target.eventTypes.includes(EventType.NATIVE_TRANSFER)) {
				await this.setupUTXOMonitoring(target);
			}
		} catch (error) {
			console.error(`Failed to setup monitoring for ${target.address}:`, error);
		}
	}

	private async setupUTXOMonitoring(target: MonitoringTarget): Promise<void> {
		if (!this.httpClient) return;

		try {
			// Get current UTXOs for the address
			const response = await this.httpClient.get(`/api/address/${target.address}/utxo`);
			const utxos = response.data || [];

			// Store current UTXOs for comparison
			for (const utxo of utxos) {
				const utxoKey = `${utxo.txid}:${utxo.vout}`;
				this.monitoredUTXOs.set(utxoKey, {
					txid: utxo.txid,
					vout: utxo.vout,
					value: utxo.value,
					address: target.address,
					confirmations: utxo.status?.confirmed ? 6 : 0,
					scriptPubKey: utxo.scriptpubkey || "",
				});
			}
		} catch (error) {
			console.error(`Failed to setup UTXO monitoring for ${target.address}:`, error);
		}
	}

	private startBlockPolling(): void {
		this.blockPollingTimer = setInterval(async () => {
			await this.checkForNewTransactions();
		}, this.bitcoinConfig.pollingInterval || 30000);
	}

	private stopBlockPolling(): void {
		if (this.blockPollingTimer) {
			clearInterval(this.blockPollingTimer);
			this.blockPollingTimer = undefined;
		}
	}

	private async checkForNewTransactions(): Promise<void> {
		if (!this.httpClient || !this.monitoringActive) {
			return;
		}

		try {
			// Check each monitored address for new transactions
			for (const target of this.monitoringTargets.values()) {
				await this.checkAddressForNewTransactions(target);
			}
		} catch (error) {
			console.error("Error checking for new Bitcoin transactions:", error);
		}
	}

	private async checkAddressForNewTransactions(target: MonitoringTarget): Promise<void> {
		if (!this.httpClient) return;

		try {
			// Get recent transactions for the address
			const response = await this.httpClient.get(`/api/address/${target.address}/txs`);
			const transactions = response.data || [];

			// Process recent transactions (limit to last 10)
			const recentTxs = transactions.slice(0, 10);
			
			for (const tx of recentTxs) {
				await this.processTransaction(tx, target);
			}
		} catch (error) {
			console.error(`Error checking transactions for ${target.address}:`, error);
		}
	}

	private async processTransaction(tx: any, target: MonitoringTarget): Promise<void> {
		try {
			// Check if this transaction affects our monitored address
			const isRelevant = this.isTransactionRelevant(tx, target);
			if (!isRelevant) return;

			const event = await this.parseTransactionToEvent(tx, target);
			if (event) {
				this.emit("blockchainEvent", event);
			}
		} catch (error) {
			console.error("Error processing Bitcoin transaction:", error);
		}
	}

	private isTransactionRelevant(tx: any, target: MonitoringTarget): boolean {
		// Check if the transaction involves the monitored address
		const address = target.address;

		// Check inputs
		if (tx.vin && Array.isArray(tx.vin)) {
			for (const input of tx.vin) {
				if (input.prevout?.scriptpubkey_address === address) {
					return true;
				}
			}
		}

		// Check outputs
		if (tx.vout && Array.isArray(tx.vout)) {
			for (const output of tx.vout) {
				if (output.scriptpubkey_address === address) {
					return true;
				}
			}
		}

		return false;
	}

	private async parseTransactionToEvent(
		tx: any, 
		target?: MonitoringTarget
	): Promise<BlockchainEvent | null> {
		try {
			// Calculate the transaction amount for the monitored address
			let amount = 0;
			let isIncoming = false;

			if (target) {
				// Calculate net effect on the monitored address
				for (const output of tx.vout || []) {
					if (output.scriptpubkey_address === target.address) {
						amount += output.value;
						isIncoming = true;
					}
				}

				for (const input of tx.vin || []) {
					if (input.prevout?.scriptpubkey_address === target.address) {
						amount -= input.prevout.value;
						isIncoming = false;
					}
				}
			}

			return {
				id: this.generateEventId(tx.txid),
				chainType: this.chainType,
				eventType: EventType.NATIVE_TRANSFER,
				blockNumber: tx.status?.block_height || 0,
				transactionHash: tx.txid,
				timestamp: tx.status?.block_time ? tx.status.block_time * 1000 : Date.now(),
				confirmed: tx.status?.confirmed || false,
				confirmationCount: tx.status?.confirmed ? 6 : 0,
				data: {
					from: this.extractSenderAddress(tx),
					to: this.extractReceiverAddress(tx),
					amount: Math.abs(amount).toString(),
					fee: tx.fee?.toString() || "0",
					metadata: {
						bitcoinTransaction: tx,
						inputCount: tx.vin?.length || 0,
						outputCount: tx.vout?.length || 0,
						size: tx.size || 0,
						vsize: tx.vsize || 0,
						isIncoming: isIncoming,
					},
				},
			};
		} catch (error) {
			console.error("Error parsing Bitcoin transaction to event:", error);
			return null;
		}
	}

	private extractSenderAddress(tx: any): string {
		// Get the first input address
		if (tx.vin && tx.vin.length > 0) {
			return tx.vin[0].prevout?.scriptpubkey_address || "unknown";
		}
		return "unknown";
	}

	private extractReceiverAddress(tx: any): string {
		// Get the first output address
		if (tx.vout && tx.vout.length > 0) {
			return tx.vout[0].scriptpubkey_address || "unknown";
		}
		return "unknown";
	}

	private async fetchTransaction(txHash: string): Promise<any> {
		if (!this.httpClient) {
			throw new Error("HTTP client not connected");
		}

		try {
			const response = await this.httpClient.get(`/api/tx/${txHash}`);
			return response.data;
		} catch (error) {
			console.error(`Failed to fetch transaction ${txHash}:`, error);
			return null;
		}
	}

	private async removeTargetMonitoring(address: string): Promise<void> {
		// Remove stored UTXOs for this address
		const keysToRemove: string[] = [];
		
		for (const [key, utxo] of this.monitoredUTXOs) {
			if (utxo.address === address) {
				keysToRemove.push(key);
			}
		}

		for (const key of keysToRemove) {
			this.monitoredUTXOs.delete(key);
		}
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(async () => {
			try {
				await this.getCurrentBlockNumber();
				this.emit("connectionStatus", this.getConnectionStatus());
			} catch (error) {
				this.emit("error", new Error(`Bitcoin heartbeat failed: ${error}`));
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