import { type BlockchainEvent, ChainType, EventType } from "../../types/events";
import {
	type AccountChangeCallback,
	type Commitment,
	Connection,
	type Context,
	type Logs,
	type LogsCallback,
	type ParsedInstruction,
	type ParsedTransactionWithMeta,
	type PartiallyDecodedInstruction,
	PublicKey,
	SignatureStatus,
} from "@solana/web3.js";
import {
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	getMint,
	getAccount,
	getAssociatedTokenAddress,
	type Mint,
	type Account,
} from "@solana/spl-token";
import config from "@/config.toml";
import {
	type ChainAdapterConfig,
	type ConnectionStatus,
	IChainAdapter,
	type MonitoringTarget,
} from "../base/chain-adapter.interface";

export interface SolanaChainAdapterConfig extends ChainAdapterConfig {
	commitment: Commitment;
}

interface SolanaMonitoringTarget extends MonitoringTarget {
	programId?: string;
	tokenMint?: string;
	associatedTokenAccount?: string;
}

interface TokenMetadata {
	mint: string;
	decimals: number;
	supply: bigint;
	mintAuthority: string | null;
	freezeAuthority: string | null;
	isInitialized: boolean;
}

interface SplTokenInstruction {
	type: string;
	data: any;
	accounts: string[];
	amount?: bigint;
	authority?: string;
	mint?: string;
	source?: string;
	destination?: string;
}

export class SolanaAdapter extends IChainAdapter {
	private connection: Connection | null = null;
	private solanaConfig: SolanaChainAdapterConfig;
	private monitoringActive = false;
	private currentSlot = 0;
	private subscriptions: Map<string, number> = new Map();
	private heartbeatTimer?: NodeJS.Timeout;
	public readonly chainType = ChainType.SOLANA;

	private readonly SPL_TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ID;
	private readonly TOKEN_2022_PROGRAM_ID = TOKEN_2022_PROGRAM_ID;
	private readonly ASSOCIATED_TOKEN_PROGRAM_ID =
		"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

	// Token metadata cache
	private tokenMetadataCache: Map<string, TokenMetadata> = new Map();

	constructor() {
		const solanaConfig: SolanaChainAdapterConfig = {
			rpcUrl: config.chains.solana.rpc_url,
			websocketUrl: config.chains.solana.websocket_url,
			maxRetryAttempts: config.chains.solana.max_retry_attempts,
			commitment: config.chains.solana.commitment,
			pollingInterval: config.monitoring.transfers.polling_interval_ms,
			batchSize: config.monitoring.transfers.batch_size,
		};

		super(solanaConfig);
		this.solanaConfig = solanaConfig;
	}

	async connect(): Promise<void> {
		try {
			this.connection = new Connection(this.solanaConfig.rpcUrl, {
				commitment: this.solanaConfig.commitment,
				wsEndpoint: this.solanaConfig.websocketUrl,
			});

			const version = await this.connection.getVersion();
			this.currentSlot = await this.connection.getSlot();

			this.connected = true;
			this.retryCount = 0;

			this.startHeartbeat();
			this.emit("connectionStatus", this.getConnectionStatus());
		} catch (error) {
			throw new Error(`Failed to connect to Solana: ${error}`);
		}
	}

	async disconnect(): Promise<void> {
		this.connected = false;
		this.monitoringActive = false;

		this.stopHeartbeat();
		await this.removeAllSubscriptions();

		this.connection = null;
		this.emit("connectionStatus", this.getConnectionStatus());
	}

	getConnectionStatus(): ConnectionStatus {
		return {
			connected: this.connected,
			lastHeartbeat: Date.now(),
			blockHeight: this.currentSlot,
			syncStatus: this.connected ? "synced" : "error",
			errors: [],
		};
	}

	async getCurrentBlockNumber(): Promise<number> {
		if (!this.connection) {
			throw new Error("Connection not established");
		}

		return await this.retry(() => this.connection?.getSlot(), "getCurrentSlot");
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
		if (!this.connected || !this.connection) {
			throw new Error("Must be connected before starting monitoring");
		}

		this.monitoringActive = true;

		const targets = Array.from(this.monitoringTargets.values());
		for (const target of targets) {
			await this.setupTargetMonitoring(target);
		}

		await this.setupProgramLogMonitoring();
	}

	async stopMonitoring(): Promise<void> {
		this.monitoringActive = false;
		await this.removeAllSubscriptions();
	}

	async getTransactionDetails(
		signature: string,
	): Promise<BlockchainEvent | null> {
		if (!this.connection) {
			throw new Error("Connection not established");
		}

		try {
			const transaction = await this.connection.getParsedTransaction(
				signature,
				{
					commitment: this.solanaConfig.commitment as any,
					maxSupportedTransactionVersion: 0,
				},
			);

			if (!transaction) {
				return null;
			}

			return this.parseTransactionToEvent(transaction);
		} catch (error) {
			console.error(
				`Failed to get transaction details for ${signature}:`,
				error,
			);
			return null;
		}
	}

	validateAddress(address: string): boolean {
		try {
			new PublicKey(address);
			return true;
		} catch {
			return false;
		}
	}

	async estimateGas(): Promise<string> {
		return "5000";
	}

	private async setupTargetMonitoring(target: MonitoringTarget): Promise<void> {
		if (!this.connection || !this.monitoringActive) {
			return;
		}

		try {
			const publicKey = new PublicKey(target.address);

			if (target.eventTypes.includes(EventType.TRANSFER)) {
				await this.setupAccountChangeMonitoring(target, publicKey);
			}

			if (target.eventTypes.includes(EventType.TOKEN_MINT)) {
				await this.setupTokenMintMonitoring(target, publicKey);
			}
		} catch (error) {
			console.error(`Failed to setup monitoring for ${target.address}:`, error);
		}
	}

	private async setupAccountChangeMonitoring(
		target: MonitoringTarget,
		publicKey: PublicKey,
	): Promise<void> {
		if (!this.connection) return;

		const callback: AccountChangeCallback = async (accountInfo, context) => {
			try {
				await this.handleAccountChange(target, publicKey, accountInfo, context);
			} catch (error) {
				console.error("Error handling account change:", error);
			}
		};

		const subscriptionId = this.connection.onAccountChange(
			publicKey,
			callback,
			this.solanaConfig.commitment,
		);

		this.subscriptions.set(`account_${target.address}`, subscriptionId);
	}

	private async setupTokenMintMonitoring(
		target: MonitoringTarget,
		publicKey: PublicKey,
	): Promise<void> {
		if (!this.connection) return;

		try {
			const accountInfo = await this.connection.getAccountInfo(publicKey);
			
			// Check if it's a mint account
			if (accountInfo?.owner.equals(this.SPL_TOKEN_PROGRAM_ID) || 
					accountInfo?.owner.equals(this.TOKEN_2022_PROGRAM_ID)) {
				
				// Monitor mint account changes (supply changes indicate minting)
				const callback: AccountChangeCallback = async (
					accountInfo,
					context,
				) => {
					try {
						await this.handleMintAccountChange(
							target,
							publicKey,
							accountInfo,
							context,
						);
					} catch (error) {
						console.error("Error handling mint account change:", error);
					}
				};

				const subscriptionId = this.connection.onAccountChange(
					publicKey,
					callback,
					this.solanaConfig.commitment,
				);

				this.subscriptions.set(`mint_${target.address}`, subscriptionId);
			} else {
				// Monitor token account changes for transfers
				const callback: AccountChangeCallback = async (
					accountInfo,
					context,
				) => {
					try {
						await this.handleTokenAccountChange(
							target,
							publicKey,
							accountInfo,
							context,
						);
					} catch (error) {
						console.error("Error handling token account change:", error);
					}
				};

				const subscriptionId = this.connection.onAccountChange(
					publicKey,
					callback,
					this.solanaConfig.commitment,
				);

				this.subscriptions.set(`token_${target.address}`, subscriptionId);
			}
		} catch (error) {
			console.error(
				`Failed to setup token mint monitoring for ${target.address}:`,
				error,
			);
		}
	}

	private async setupProgramLogMonitoring(): Promise<void> {
		if (!this.connection) return;

		const callback: LogsCallback = async (logs, context) => {
			try {
				await this.handleProgramLogs(logs, context);
			} catch (error) {
				console.error("Error handling program logs:", error);
			}
		};

		const splTokenSubscription = this.connection.onLogs(
			new PublicKey(this.SPL_TOKEN_PROGRAM_ID),
			callback,
			this.solanaConfig.commitment,
		);

		this.subscriptions.set("spl_token_logs", splTokenSubscription);
	}

	private async handleAccountChange(
		target: MonitoringTarget,
		publicKey: PublicKey,
		accountInfo: any,
		context: Context,
	): Promise<void> {
		const event: BlockchainEvent = {
			id: this.generateEventId(`${context.slot}_${publicKey.toString()}`),
			chainType: this.chainType,
			eventType: EventType.TRANSFER,
			blockNumber: context.slot,
			transactionHash: `account_change_${publicKey.toString()}_${context.slot}`,
			timestamp: Date.now(),
			confirmed: true,
			confirmationCount: 1,
			data: {
				from: target.address,
				to: target.address,
				amount: accountInfo?.lamports?.toString() || "0",
				metadata: {
					publicKey: publicKey.toString(),
					owner: accountInfo?.owner?.toString(),
					executable: accountInfo?.executable,
					rentEpoch: accountInfo?.rentEpoch,
				},
			},
		};

		this.emit("blockchainEvent", event);
	}

	private async handleMintAccountChange(
		target: MonitoringTarget,
		mintPublicKey: PublicKey,
		accountInfo: any,
		context: Context,
	): Promise<void> {
		try {
			if (!accountInfo?.data || !this.connection) return;

			// Get previous and current mint info to detect supply changes
			const mintInfo = await this.getMintInfo(mintPublicKey);
			if (!mintInfo) return;

			// Get cached previous supply
			const cacheKey = mintPublicKey.toString();
			const previousMetadata = this.tokenMetadataCache.get(cacheKey);
			
			if (previousMetadata && mintInfo.supply > previousMetadata.supply) {
				// Supply increased - minting detected
				const mintedAmount = mintInfo.supply - previousMetadata.supply;
				
				const event: BlockchainEvent = {
					id: this.generateEventId(
						`${context.slot}_${mintPublicKey.toString()}_mint`,
					),
					chainType: this.chainType,
					eventType: EventType.TOKEN_MINT,
					blockNumber: context.slot,
					transactionHash: `mint_${mintPublicKey.toString()}_${context.slot}`,
					timestamp: Date.now(),
					confirmed: true,
					confirmationCount: 1,
					data: {
						tokenAddress: mintPublicKey.toString(),
						to: target.address,
						amount: this.formatTokenAmount(mintedAmount, mintInfo.decimals),
						tokenDecimals: mintInfo.decimals,
						minter: mintInfo.mintAuthority,
						metadata: {
							mint: mintPublicKey.toString(),
							previousSupply: previousMetadata.supply.toString(),
							newSupply: mintInfo.supply.toString(),
							mintedAmount: mintedAmount.toString(),
							programId: mintInfo.isInitialized ? this.SPL_TOKEN_PROGRAM_ID.toString() : this.TOKEN_2022_PROGRAM_ID.toString(),
						},
					},
				};

				this.emit("blockchainEvent", event);
			}

			// Update cache
			this.tokenMetadataCache.set(cacheKey, mintInfo);
		} catch (error) {
			console.error("Error handling mint account change:", error);
		}
	}

	private async handleTokenAccountChange(
		target: MonitoringTarget,
		publicKey: PublicKey,
		accountInfo: any,
		context: Context,
	): Promise<void> {
		try {
			if (!accountInfo?.data || !this.connection) return;

			// Parse token account data
			try {
				const tokenAccount = await getAccount(this.connection, publicKey);
				const mintInfo = await this.getMintInfo(tokenAccount.mint);
				
				if (!mintInfo) return;

				const event: BlockchainEvent = {
					id: this.generateEventId(
						`${context.slot}_${publicKey.toString()}_transfer`,
					),
					chainType: this.chainType,
					eventType: EventType.TRANSFER,
					blockNumber: context.slot,
					transactionHash: `transfer_${publicKey.toString()}_${context.slot}`,
					timestamp: Date.now(),
					confirmed: true,
					confirmationCount: 1,
					data: {
						tokenAddress: tokenAccount.mint.toString(),
						to: tokenAccount.owner.toString(),
						amount: this.formatTokenAmount(tokenAccount.amount, mintInfo.decimals),
						tokenDecimals: mintInfo.decimals,
						metadata: {
							tokenAccount: publicKey.toString(),
							mint: tokenAccount.mint.toString(),
							owner: tokenAccount.owner.toString(),
							balance: tokenAccount.amount.toString(),
							programId: this.SPL_TOKEN_PROGRAM_ID.toString(),
						},
					},
				};

				this.emit("blockchainEvent", event);
			} catch (parseError) {
				// Account might not be a token account, ignore
				console.debug("Failed to parse as token account:", parseError);
			}
		} catch (error) {
			console.error("Error handling token account change:", error);
		}
	}

	private async handleProgramLogs(logs: Logs, context: Context): Promise<void> {
		try {
			if (!logs.logs || logs.logs.length === 0) return;

			const transferLogs = logs.logs.filter(
				(log) =>
					log.includes("Transfer") ||
					log.includes("MintTo") ||
					log.includes("InitializeMint"),
			);

			for (const log of transferLogs) {
				const event = await this.parseLogToEvent(log, logs.signature, context);
				if (event) {
					this.emit("blockchainEvent", event);
				}
			}
		} catch (error) {
			console.error("Error handling program logs:", error);
		}
	}

	private async parseLogToEvent(
		log: string,
		signature: string,
		context: Context,
	): Promise<BlockchainEvent | null> {
		try {
			const eventType = this.determineEventTypeFromLog(log);

			return {
				id: this.generateEventId(signature),
				chainType: this.chainType,
				eventType,
				blockNumber: context.slot,
				transactionHash: signature,
				timestamp: Date.now(),
				confirmed: true,
				confirmationCount: 1,
				data: {
					metadata: {
						log,
						programId: this.SPL_TOKEN_PROGRAM_ID,
					},
				},
			};
		} catch (error) {
			console.error("Error parsing log to event:", error);
			return null;
		}
	}

	private determineEventTypeFromLog(log: string): EventType {
		if (log.includes("MintTo") || log.includes("InitializeMint")) {
			return EventType.TOKEN_MINT;
		}
		if (log.includes("Transfer")) {
			return EventType.TRANSFER;
		}
		return EventType.TRANSFER;
	}

	private async parseTransactionToEvent(
		transaction: ParsedTransactionWithMeta,
	): Promise<BlockchainEvent | null> {
		try {
			if (!transaction.meta || !transaction.transaction.message.instructions) {
				return null;
			}

			const instructions = transaction.transaction.message.instructions;
			const splTokenInstructions = instructions.filter((instruction) =>
				this.isSPLTokenInstruction(instruction),
			);

			if (splTokenInstructions.length === 0) {
				return null;
			}

			const instruction = splTokenInstructions[0];
			if (!instruction) {
				return null;
			}
			const eventType = this.getEventTypeFromInstruction(instruction);

			return {
				id: this.generateEventId(
					transaction.transaction.signatures[0] || "unknown",
				),
				chainType: this.chainType,
				eventType,
				blockNumber: transaction.slot || 0,
				transactionHash: transaction.transaction.signatures[0] || "unknown",
				timestamp: (transaction.blockTime || Date.now() / 1000) * 1000,
				confirmed: true,
				confirmationCount: 1,
				data: {
					fee: transaction.meta.fee.toString(),
					metadata: {
						slot: transaction.slot,
						computeUnitsConsumed: transaction.meta.computeUnitsConsumed,
					},
				},
			};
		} catch (error) {
			console.error("Error parsing transaction to event:", error);
			return null;
		}
	}

	private isSPLTokenInstruction(
		instruction: ParsedInstruction | PartiallyDecodedInstruction,
	): boolean {
		if ("programId" in instruction) {
			return instruction.programId.equals(
				new PublicKey(this.SPL_TOKEN_PROGRAM_ID),
			);
		}
		return false;
	}

	private getEventTypeFromInstruction(
		instruction: ParsedInstruction | PartiallyDecodedInstruction,
	): EventType {
		if ("parsed" in instruction && instruction.parsed) {
			const instructionType = instruction.parsed.type;

			switch (instructionType) {
				case "transfer":
				case "transferChecked":
					return EventType.TRANSFER;
				case "mintTo":
				case "mintToChecked":
					return EventType.TOKEN_MINT;
				case "initializeMint":
				case "initializeMint2":
					return EventType.TOKEN_MINT;
				default:
					return EventType.TRANSFER;
			}
		}

		return EventType.TRANSFER;
	}

	private async getMintInfo(mintPublicKey: PublicKey): Promise<TokenMetadata | null> {
		try {
			if (!this.connection) return null;

			// Try to get mint info from both token programs
			try {
				const mint = await getMint(this.connection, mintPublicKey, this.solanaConfig.commitment, this.SPL_TOKEN_PROGRAM_ID);
				return this.convertMintToMetadata(mint);
			} catch {
				// Try Token-2022 program
				try {
					const mint = await getMint(this.connection, mintPublicKey, this.solanaConfig.commitment, this.TOKEN_2022_PROGRAM_ID);
					return this.convertMintToMetadata(mint);
				} catch {
					return null;
				}
			}
		} catch (error) {
			console.error("Error getting mint info:", error);
			return null;
		}
	}

	private convertMintToMetadata(mint: Mint): TokenMetadata {
		return {
			mint: mint.address.toString(),
			decimals: mint.decimals,
			supply: mint.supply,
			mintAuthority: mint.mintAuthority?.toString() || null,
			freezeAuthority: mint.freezeAuthority?.toString() || null,
			isInitialized: mint.isInitialized,
		};
	}

	private formatTokenAmount(amount: bigint, decimals: number): string {
		const divisor = BigInt(10 ** decimals);
		const wholePart = amount / divisor;
		const fractionalPart = amount % divisor;
		
		if (fractionalPart === 0n) {
			return wholePart.toString();
		}
		
		const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
		const trimmedFractional = fractionalStr.replace(/0+$/, '');
		
		return `${wholePart}.${trimmedFractional}`;
	}

	private async removeTargetMonitoring(address: string): Promise<void> {
		if (!this.connection) return;

		const subscriptionKeys = [
			`account_${address}`,
			`token_${address}`,
			`mint_${address}`
		];

		for (const key of subscriptionKeys) {
			const subscription = this.subscriptions.get(key);
			if (subscription !== undefined) {
				await this.connection.removeAccountChangeListener(subscription);
				this.subscriptions.delete(key);
			}
		}
	}

	private async removeAllSubscriptions(): Promise<void> {
		if (!this.connection) return;

		const promises = Array.from(this.subscriptions.entries()).map(
			async ([key, subscriptionId]) => {
				try {
					if (key.includes("logs")) {
						await this.connection?.removeOnLogsListener(subscriptionId);
					} else {
						await this.connection?.removeAccountChangeListener(subscriptionId);
					}
				} catch (error) {
					console.error(`Failed to remove subscription ${key}:`, error);
				}
			},
		);

		await Promise.allSettled(promises);
		this.subscriptions.clear();
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(async () => {
			try {
				if (this.connection) {
					this.currentSlot = await this.connection.getSlot();
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
