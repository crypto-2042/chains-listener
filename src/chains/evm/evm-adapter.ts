import {
	type BlockchainEvent,
	type ChainType,
	EventData,
	EventType,
} from "../../types/events";
import {
	JsonRpcProvider,
	type Log,
	type TransactionReceipt,
	type TransactionResponse,
	WebSocketProvider,
	ethers,
} from "ethers";
import {
	type ChainAdapterConfig,
	type ConnectionStatus,
	IChainAdapter,
	type MonitoringTarget,
} from "../base/chain-adapter.interface";

export interface EVMChainAdapterConfig extends ChainAdapterConfig {
	chainId: number;
	blockConfirmationCount: number;
	startBlock?: number;
}

export class EVMChainAdapter extends IChainAdapter {
	private provider: WebSocketProvider | JsonRpcProvider | null = null;
	private fallbackProvider: JsonRpcProvider | null = null;
	private evmConfig: EVMChainAdapterConfig;
	private monitoringActive = false;
	private currentBlockNumber = 0;
	private heartbeatTimer?: NodeJS.Timeout;
	public readonly chainType: ChainType;

	private readonly ERC20_TRANSFER_TOPIC =
		"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
	private readonly ERC721_TRANSFER_TOPIC =
		"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
	private readonly ERC20_MINT_TOPICS = [
		"0x0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d4121396885", // Mint(address,uint256)
		"0xab8530f87dc9b59234c4623bf917212bb2536d647574c8e7e5da92c2ede0c9f8", // Transfer(address,address,uint256) from 0x0
	];

	constructor(chainType: ChainType, config: EVMChainAdapterConfig) {
		super(config);
		this.chainType = chainType;
		this.evmConfig = config;
	}

	async connect(): Promise<void> {
		try {
			if (this.evmConfig.websocketUrl) {
				this.provider = new WebSocketProvider(this.evmConfig.websocketUrl);
			} else {
				this.provider = new JsonRpcProvider(this.evmConfig.rpcUrl);
			}

			this.fallbackProvider = new JsonRpcProvider(this.evmConfig.rpcUrl);

			await this.provider.getNetwork();

			this.currentBlockNumber = await this.provider.getBlockNumber();
			this.connected = true;
			this.retryCount = 0;

			this.startHeartbeat();
			this.emit("connectionStatus", this.getConnectionStatus());
		} catch (error) {
			throw new Error(`Failed to connect to ${this.chainType}: ${error}`);
		}
	}

	async disconnect(): Promise<void> {
		this.connected = false;
		this.monitoringActive = false;

		this.stopHeartbeat();

		if (this.provider) {
			if ("destroy" in this.provider) {
				this.provider.destroy();
			}
			this.provider = null;
		}

		if (this.fallbackProvider) {
			if ("destroy" in this.fallbackProvider) {
				this.fallbackProvider.destroy();
			}
			this.fallbackProvider = null;
		}

		this.emit("connectionStatus", this.getConnectionStatus());
	}

	getConnectionStatus(): ConnectionStatus {
		return {
			connected: this.connected,
			lastHeartbeat: Date.now(),
			blockHeight: this.currentBlockNumber,
			syncStatus: this.connected ? "synced" : "error",
			errors: [],
		};
	}

	async getCurrentBlockNumber(): Promise<number> {
		if (!this.provider) {
			throw new Error("Provider not connected");
		}

		return await this.retry(
			() => this.provider?.getBlockNumber(),
			"getCurrentBlockNumber",
		);
	}

	async addMonitoringTarget(target: MonitoringTarget): Promise<void> {
		this.validateMonitoringTarget(target);
		this.monitoringTargets.set(target.address, target);

		if (this.monitoringActive) {
			await this.setupEventListeners();
		}
	}

	async removeMonitoringTarget(address: string): Promise<void> {
		this.monitoringTargets.delete(address);

		if (this.monitoringActive) {
			await this.setupEventListeners();
		}
	}

	async startMonitoring(): Promise<void> {
		if (!this.connected || !this.provider) {
			throw new Error("Must be connected before starting monitoring");
		}

		this.monitoringActive = true;
		await this.setupEventListeners();
	}

	async stopMonitoring(): Promise<void> {
		this.monitoringActive = false;

		if (this.provider) {
			this.provider.removeAllListeners();
		}
	}

	async getTransactionDetails(txHash: string): Promise<BlockchainEvent | null> {
		if (!this.provider) {
			throw new Error("Provider not connected");
		}

		try {
			const [transaction, receipt] = await Promise.all([
				this.provider.getTransaction(txHash),
				this.provider.getTransactionReceipt(txHash),
			]);

			if (!transaction || !receipt) {
				return null;
			}

			return this.parseTransactionToEvent(transaction, receipt);
		} catch (error) {
			console.error(`Failed to get transaction details for ${txHash}:`, error);
			return null;
		}
	}

	validateAddress(address: string): boolean {
		try {
			return ethers.isAddress(address);
		} catch {
			return false;
		}
	}

	async estimateGas(transaction: unknown): Promise<string> {
		if (!this.provider) {
			throw new Error("Provider not connected");
		}

		const gasEstimate = await this.provider.estimateGas(
			transaction as ethers.TransactionRequest,
		);
		return gasEstimate.toString();
	}

	private async setupEventListeners(): Promise<void> {
		if (!this.provider || !this.monitoringActive) {
			return;
		}

		this.provider.removeAllListeners();

		this.provider.on("block", async (blockNumber: number) => {
			this.currentBlockNumber = blockNumber;
			await this.processNewBlock(blockNumber);
		});

		const targets = Array.from(this.monitoringTargets.values());

		for (const target of targets) {
			await this.setupTargetListener(target);
		}
	}

	private async setupTargetListener(target: MonitoringTarget): Promise<void> {
		if (!this.provider) return;

		const eventTypes = target.eventTypes;

		if (
			eventTypes.includes(EventType.TRANSFER) ||
			eventTypes.includes(EventType.NATIVE_TRANSFER)
		) {
			await this.setupTransferListener(target);
		}

		if (
			eventTypes.includes(EventType.TOKEN_MINT) ||
			eventTypes.includes(EventType.NFT_MINT)
		) {
			await this.setupMintingListener(target);
		}
	}

	private async setupTransferListener(target: MonitoringTarget): Promise<void> {
		if (!this.provider) return;

		if (target.type === "address") {
			const filter = {
				topics: [this.ERC20_TRANSFER_TOPIC, null, null],
			};

			this.provider.on(filter, async (log: Log) => {
				await this.handleTransferEvent(log, target);
			});

			this.provider.on(
				{
					address: target.address,
				},
				async (log: Log) => {
					await this.handleNativeTransfer(log, target);
				},
			);
		}

		if (target.type === "contract") {
			const contractFilter = {
				address: target.address,
				topics: [this.ERC20_TRANSFER_TOPIC],
			};

			this.provider.on(contractFilter, async (log: Log) => {
				await this.handleTransferEvent(log, target);
			});
		}
	}

	private async setupMintingListener(target: MonitoringTarget): Promise<void> {
		if (!this.provider) return;

		if (target.type === "contract") {
			for (const mintTopic of this.ERC20_MINT_TOPICS) {
				const filter = {
					address: target.address,
					topics: [mintTopic],
				};

				this.provider.on(filter, async (log: Log) => {
					await this.handleMintingEvent(log, target);
				});
			}

			const transferFromZeroFilter = {
				address: target.address,
				topics: [
					this.ERC20_TRANSFER_TOPIC,
					"0x0000000000000000000000000000000000000000000000000000000000000000", // from 0x0
				],
			};

			this.provider.on(transferFromZeroFilter, async (log: Log) => {
				await this.handleMintingEvent(log, target);
			});
		}
	}

	private async handleTransferEvent(
		log: Log,
		target: MonitoringTarget,
	): Promise<void> {
		try {
			const event = await this.parseLogToTransferEvent(log);
			if (event) {
				this.emit("blockchainEvent", event);
			}
		} catch (error) {
			console.error("Error handling transfer event:", error);
		}
	}

	private async handleNativeTransfer(
		log: Log,
		target: MonitoringTarget,
	): Promise<void> {
		try {
			const event = await this.parseLogToNativeTransferEvent(log);
			if (event) {
				this.emit("blockchainEvent", event);
			}
		} catch (error) {
			console.error("Error handling native transfer:", error);
		}
	}

	private async handleMintingEvent(
		log: Log,
		target: MonitoringTarget,
	): Promise<void> {
		try {
			const event = await this.parseLogToMintingEvent(log);
			if (event) {
				this.emit("blockchainEvent", event);
			}
		} catch (error) {
			console.error("Error handling minting event:", error);
		}
	}

	private async parseLogToTransferEvent(
		log: Log,
	): Promise<BlockchainEvent | null> {
		try {
			const decoded = this.decodeTransferLog(log);
			if (!decoded) return null;

			const block = await this.getBlockInfo(log.blockNumber);

			return {
				id: this.generateEventId(log.transactionHash, log.index),
				chainType: this.chainType,
				eventType: EventType.TRANSFER,
				blockNumber: log.blockNumber,
				transactionHash: log.transactionHash,
				timestamp: block.timestamp * 1000,
				confirmed: await this.isEventConfirmed(log.blockNumber),
				confirmationCount: this.currentBlockNumber - log.blockNumber,
				data: {
					from: decoded.from,
					to: decoded.to,
					amount: decoded.amount,
					tokenAddress: log.address,
					gasUsed: block.gasUsed,
					gasPrice: block.gasPrice,
				},
			};
		} catch (error) {
			console.error("Error parsing transfer log:", error);
			return null;
		}
	}

	private async parseLogToNativeTransferEvent(
		log: Log,
	): Promise<BlockchainEvent | null> {
		try {
			const receipt = await this.provider?.getTransactionReceipt(
				log.transactionHash,
			);
			if (!receipt) return null;

			const transaction = await this.provider?.getTransaction(
				log.transactionHash,
			);
			if (!transaction) return null;

			const block = await this.getBlockInfo(log.blockNumber);

			return {
				id: this.generateEventId(log.transactionHash),
				chainType: this.chainType,
				eventType: EventType.NATIVE_TRANSFER,
				blockNumber: log.blockNumber,
				transactionHash: log.transactionHash,
				timestamp: block.timestamp * 1000,
				confirmed: await this.isEventConfirmed(log.blockNumber),
				confirmationCount: this.currentBlockNumber - log.blockNumber,
				data: {
					from: transaction.from || "",
					to: transaction.to || "",
					amount: transaction.value.toString(),
					gasUsed: receipt.gasUsed.toString(),
					gasPrice: (receipt.gasPrice || transaction.gasPrice || 0n).toString(),
					fee: (
						receipt.gasUsed * (receipt.gasPrice || transaction.gasPrice || 0n)
					).toString(),
				},
			};
		} catch (error) {
			console.error("Error parsing native transfer:", error);
			return null;
		}
	}

	private async parseLogToMintingEvent(
		log: Log,
	): Promise<BlockchainEvent | null> {
		try {
			const decoded = this.decodeMintLog(log);
			if (!decoded) return null;

			const block = await this.getBlockInfo(log.blockNumber);

			return {
				id: this.generateEventId(log.transactionHash, log.index),
				chainType: this.chainType,
				eventType: EventType.TOKEN_MINT,
				blockNumber: log.blockNumber,
				transactionHash: log.transactionHash,
				timestamp: block.timestamp * 1000,
				confirmed: await this.isEventConfirmed(log.blockNumber),
				confirmationCount: this.currentBlockNumber - log.blockNumber,
				data: {
					to: decoded.to,
					amount: decoded.amount,
					tokenAddress: log.address,
					minter: decoded.minter,
					gasUsed: block.gasUsed,
					gasPrice: block.gasPrice,
				},
			};
		} catch (error) {
			console.error("Error parsing minting log:", error);
			return null;
		}
	}

	private decodeTransferLog(
		log: Log,
	): { from: string; to: string; amount: string } | null {
		try {
			if (log.topics[0] !== this.ERC20_TRANSFER_TOPIC) return null;

			const from = ethers.getAddress(`0x${log.topics[1]?.slice(26)}`);
			const to = ethers.getAddress(`0x${log.topics[2]?.slice(26)}`);
			const amount = ethers.getBigInt(log.data).toString();

			return { from, to, amount };
		} catch (error) {
			return null;
		}
	}

	private decodeMintLog(
		log: Log,
	): { to: string; amount: string; minter?: string } | null {
		try {
			if (log.topics[0] === this.ERC20_TRANSFER_TOPIC) {
				const from = log.topics[1];
				if (
					from ===
					"0x0000000000000000000000000000000000000000000000000000000000000000"
				) {
					const to = ethers.getAddress(`0x${log.topics[2]?.slice(26)}`);
					const amount = ethers.getBigInt(log.data).toString();
					return { to, amount };
				}
			}

			return null;
		} catch (error) {
			return null;
		}
	}

	private async getBlockInfo(blockNumber: number): Promise<{
		timestamp: number;
		gasUsed: string;
		gasPrice: string;
	}> {
		try {
			const block = await this.provider?.getBlock(blockNumber);
			return {
				timestamp: block?.timestamp || 0,
				gasUsed: "0",
				gasPrice: "0",
			};
		} catch (error) {
			return {
				timestamp: Date.now() / 1000,
				gasUsed: "0",
				gasPrice: "0",
			};
		}
	}

	private async isEventConfirmed(blockNumber: number): Promise<boolean> {
		const confirmations = this.currentBlockNumber - blockNumber;
		return confirmations >= this.evmConfig.blockConfirmationCount;
	}

	private async processNewBlock(blockNumber: number): Promise<void> {
		this.emit("connectionStatus", this.getConnectionStatus());
	}

	private async parseTransactionToEvent(
		transaction: TransactionResponse,
		receipt: TransactionReceipt,
	): Promise<BlockchainEvent> {
		const block = await this.getBlockInfo(receipt.blockNumber);

		return {
			id: this.generateEventId(transaction.hash),
			chainType: this.chainType,
			eventType: EventType.NATIVE_TRANSFER,
			blockNumber: receipt.blockNumber,
			transactionHash: transaction.hash,
			timestamp: block.timestamp * 1000,
			confirmed: await this.isEventConfirmed(receipt.blockNumber),
			confirmationCount: this.currentBlockNumber - receipt.blockNumber,
			data: {
				from: transaction.from,
				to: transaction.to || "",
				amount: transaction.value.toString(),
				gasUsed: receipt.gasUsed.toString(),
				gasPrice: (receipt.gasPrice || transaction.gasPrice || 0n).toString(),
				fee: (
					receipt.gasUsed * (receipt.gasPrice || transaction.gasPrice || 0n)
				).toString(),
			},
		};
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(async () => {
			try {
				if (this.provider) {
					await this.provider.getBlockNumber();
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
