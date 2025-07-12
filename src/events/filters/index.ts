import type { BlockchainEvent, EventType } from "@/types/events";
import config from "@/config.toml";
import { BaseEventFilter } from "../event-processor.interface";

export class AddressFilter extends BaseEventFilter {
	private watchAddresses: Set<string>;

	constructor() {
		super("address_filter", "Wallet Address Filter", 10);
		this.watchAddresses = new Set(
			config.targets.addresses.watch_addresses.map((addr) =>
				addr.toLowerCase(),
			),
		);
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		if (!event.data.from && !event.data.to) {
			return false;
		}

		const fromMatch = event.data.from
			? this.watchAddresses.has(event.data.from.toLowerCase())
			: false;
		const toMatch = event.data.to
			? this.watchAddresses.has(event.data.to.toLowerCase())
			: false;

		return fromMatch || toMatch;
	}

	public addAddress(address: string): void {
		this.watchAddresses.add(address.toLowerCase());
	}

	public removeAddress(address: string): void {
		this.watchAddresses.delete(address.toLowerCase());
	}

	public getWatchedAddresses(): string[] {
		return Array.from(this.watchAddresses);
	}
}

export class ContractFilter extends BaseEventFilter {
	private erc20Contracts: Set<string>;
	private erc721Contracts: Set<string>;

	constructor() {
		super("contract_filter", "Smart Contract Filter", 9);
		this.erc20Contracts = new Set(
			config.targets.contracts.erc20_contracts.map((addr) =>
				addr.toLowerCase(),
			),
		);
		this.erc721Contracts = new Set(
			config.targets.contracts.erc721_contracts.map((addr) =>
				addr.toLowerCase(),
			),
		);
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		if (!event.data.tokenAddress && !event.data.contractAddress) {
			return false;
		}

		const tokenAddress = (
			event.data.tokenAddress || event.data.contractAddress
		)?.toLowerCase();
		if (!tokenAddress) {
			return false;
		}

		return (
			this.erc20Contracts.has(tokenAddress) ||
			this.erc721Contracts.has(tokenAddress)
		);
	}

	public addERC20Contract(address: string): void {
		this.erc20Contracts.add(address.toLowerCase());
	}

	public addERC721Contract(address: string): void {
		this.erc721Contracts.add(address.toLowerCase());
	}

	public removeContract(address: string): void {
		const lowerAddress = address.toLowerCase();
		this.erc20Contracts.delete(lowerAddress);
		this.erc721Contracts.delete(lowerAddress);
	}
}

export class AmountFilter extends BaseEventFilter {
	private minAmount: number;
	private maxAmount: number;

	constructor() {
		super("amount_filter", "Transfer Amount Filter", 8);
		this.minAmount = Number.parseFloat(config.filters.transfer.min_amount);
		this.maxAmount = Number.parseFloat(config.filters.transfer.max_amount);
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		if (!event.data.amount) {
			return true;
		}

		try {
			const amount = Number.parseFloat(event.data.amount);
			if (isNaN(amount)) {
				return true;
			}

			return amount >= this.minAmount && amount <= this.maxAmount;
		} catch {
			return true;
		}
	}

	public setMinAmount(amount: number): void {
		this.minAmount = amount;
	}

	public setMaxAmount(amount: number): void {
		this.maxAmount = amount;
	}
}

export class EventTypeFilter extends BaseEventFilter {
	private allowedEventTypes: Set<EventType>;

	constructor(allowedTypes: EventType[]) {
		super("event_type_filter", "Event Type Filter", 7);
		this.allowedEventTypes = new Set(allowedTypes);
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		return this.allowedEventTypes.has(event.eventType);
	}

	public addEventType(eventType: EventType): void {
		this.allowedEventTypes.add(eventType);
	}

	public removeEventType(eventType: EventType): void {
		this.allowedEventTypes.delete(eventType);
	}

	public getAllowedTypes(): EventType[] {
		return Array.from(this.allowedEventTypes);
	}
}

export class SelfTransferFilter extends BaseEventFilter {
	private excludeSelfTransfers: boolean;

	constructor() {
		super("self_transfer_filter", "Self Transfer Filter", 6);
		this.excludeSelfTransfers = config.filters.transfer.exclude_self_transfers;
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		if (!this.excludeSelfTransfers) {
			return true;
		}

		if (!event.data.from || !event.data.to) {
			return true;
		}

		return event.data.from.toLowerCase() !== event.data.to.toLowerCase();
	}

	public setExcludeSelfTransfers(exclude: boolean): void {
		this.excludeSelfTransfers = exclude;
	}
}

export class ConfirmationFilter extends BaseEventFilter {
	private requiredConfirmations: number;

	constructor(requiredConfirmations = 6) {
		super("confirmation_filter", "Block Confirmation Filter", 5);
		this.requiredConfirmations = requiredConfirmations;
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		return event.confirmationCount >= this.requiredConfirmations;
	}

	public setRequiredConfirmations(count: number): void {
		this.requiredConfirmations = count;
	}
}

export class TimestampFilter extends BaseEventFilter {
	private minTimestamp?: number;
	private maxTimestamp?: number;

	constructor(minTimestamp?: number, maxTimestamp?: number) {
		super("timestamp_filter", "Timestamp Range Filter", 4);
		this.minTimestamp = minTimestamp;
		this.maxTimestamp = maxTimestamp;
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		if (this.minTimestamp && event.timestamp < this.minTimestamp) {
			return false;
		}

		if (this.maxTimestamp && event.timestamp > this.maxTimestamp) {
			return false;
		}

		return true;
	}

	public setTimeRange(minTimestamp?: number, maxTimestamp?: number): void {
		this.minTimestamp = minTimestamp;
		this.maxTimestamp = maxTimestamp;
	}
}
