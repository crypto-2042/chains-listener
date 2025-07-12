export enum EventType {
	TRANSFER = "transfer",
	TOKEN_MINT = "token_mint",
	TOKEN_BURN = "token_burn",
	CONTRACT_CREATION = "contract_creation",
	NATIVE_TRANSFER = "native_transfer",
	NFT_TRANSFER = "nft_transfer",
	NFT_MINT = "nft_mint",
}

export enum ChainType {
	ETHEREUM = "ethereum",
	BSC = "bsc",
	SOLANA = "solana",
	SUI = "sui",
	BITCOIN = "bitcoin",
	TRX = "trx",
}

export interface BlockchainEvent {
	id: string;
	chainType: ChainType;
	eventType: EventType;
	blockNumber: number;
	transactionHash: string;
	timestamp: number;
	data: EventData;
	confirmed: boolean;
	confirmationCount: number;
}

export interface EventData {
	from?: string;
	to?: string;
	amount?: string;
	tokenAddress?: string;
	tokenSymbol?: string;
	tokenDecimals?: number;
	contractAddress?: string;
	tokenId?: string;
	minter?: string;
	metadata?: Record<string, unknown>;
	gasUsed?: string;
	gasPrice?: string;
	fee?: string;
}

export interface TransferEvent extends BlockchainEvent {
	eventType:
		| EventType.TRANSFER
		| EventType.NATIVE_TRANSFER
		| EventType.NFT_TRANSFER;
	data: EventData & {
		from: string;
		to: string;
		amount: string;
	};
}

export interface TokenMintEvent extends BlockchainEvent {
	eventType: EventType.TOKEN_MINT | EventType.NFT_MINT;
	data: EventData & {
		to: string;
		amount: string;
		tokenAddress: string;
		totalSupply?: string;
		minter?: string;
	};
}

export interface ProcessedEvent {
	id: string;
	originalEvent: BlockchainEvent;
	processed: boolean;
	processedAt: number;
	notifications: NotificationResult[];
	metadata: EventMetadata;
	errors?: ProcessingError[];
}

export interface NotificationResult {
	channel: string;
	success: boolean;
	timestamp: number;
	error?: string;
	retryCount: number;
}

export interface EventMetadata {
	correlationId: string;
	processingDuration: number;
	filters: string[];
	enrichments: Record<string, unknown>;
	usdValue?: number;
	classification: EventClassification;
}

export interface EventClassification {
	category: "high_value" | "medium_value" | "low_value" | "spam";
	confidence: number;
	tags: string[];
}

export interface ProcessingError {
	stage: string;
	error: string;
	timestamp: number;
	recoverable: boolean;
}
