import config from "@/config.toml";
import type { CustomFilterRule } from "../../chains/base/chain-adapter.interface";
import { ConfigManager } from "../../config/config-manager";
import type { BlockchainEvent, EventType } from "../../types/events";
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
			if (Number.isNaN(amount)) {
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

// Enhanced target-aware filters for individual contract customization

/**
 * Target-aware amount filter that applies different thresholds based on contract/address
 */
export class TargetAwareAmountFilter extends BaseEventFilter {
	private configManager = ConfigManager.getInstance();

	constructor() {
		super("target_aware_amount_filter", "Target-Aware Amount Filter", 8);
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		if (!event.data.amount) {
			return true;
		}

		const contractAddress =
			event.data.tokenAddress || event.data.contractAddress;

		// If no contract address, use global filter
		if (!contractAddress) {
			return this.applyGlobalFilter(event);
		}

		try {
			const amount = Number.parseFloat(event.data.amount);
			if (Number.isNaN(amount)) {
				return true;
			}

			// Get target-specific or global configuration
			const targetConfig = this.configManager.getTargetConfig(
				contractAddress,
				event.chainType,
			);

			const minAmount = Number.parseFloat(
				targetConfig.filters.transfer.min_amount,
			);
			const maxAmount = Number.parseFloat(
				targetConfig.filters.transfer.max_amount,
			);

			return amount >= minAmount && amount <= maxAmount;
		} catch {
			return true;
		}
	}

	private applyGlobalFilter(event: BlockchainEvent): boolean {
		if (!event.data.amount) return true;

		try {
			const amount = Number.parseFloat(event.data.amount);
			if (Number.isNaN(amount)) return true;

			const minAmount = Number.parseFloat(config.filters.transfer.min_amount);
			const maxAmount = Number.parseFloat(config.filters.transfer.max_amount);

			return amount >= minAmount && amount <= maxAmount;
		} catch {
			return true;
		}
	}
}

/**
 * Custom rules filter that applies target-specific custom filtering rules
 */
export class CustomRulesFilter extends BaseEventFilter {
	private configManager = ConfigManager.getInstance();

	constructor() {
		super("custom_rules_filter", "Custom Rules Filter", 3);
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		const contractAddress =
			event.data.tokenAddress || event.data.contractAddress;

		if (!contractAddress) {
			return true; // No custom rules for events without contract address
		}

		const enhancedTarget =
			this.configManager.getEnhancedTarget(contractAddress);
		if (!enhancedTarget?.filters?.customRules) {
			return true; // No custom rules defined
		}

		// Apply all custom rules (all must pass)
		for (const rule of enhancedTarget.filters.customRules) {
			if (!(await this.applyCustomRule(event, rule))) {
				return false;
			}
		}

		return true;
	}

	private async applyCustomRule(
		event: BlockchainEvent,
		rule: CustomFilterRule,
	): Promise<boolean> {
		const fieldValue = this.getFieldValue(event, rule.field);
		if (fieldValue === undefined) {
			return true; // Field not present, rule doesn't apply
		}

		switch (rule.operator) {
			case "equals":
				return fieldValue === rule.value;
			case "not_equals":
				return fieldValue !== rule.value;
			case "greater_than":
				return Number(fieldValue) > Number(rule.value);
			case "less_than":
				return Number(fieldValue) < Number(rule.value);
			case "contains":
				return String(fieldValue)
					.toLowerCase()
					.includes(String(rule.value).toLowerCase());
			case "regex":
				try {
					const regex = new RegExp(String(rule.value));
					return regex.test(String(fieldValue));
				} catch {
					return false;
				}
			default:
				return true;
		}
	}

	private getFieldValue(
		event: BlockchainEvent,
		field: string,
	): string | number | undefined {
		switch (field) {
			case "from":
				return event.data.from;
			case "to":
				return event.data.to;
			case "amount":
				return event.data.amount;
			case "tokenAddress":
				return event.data.tokenAddress;
			case "tokenSymbol":
				return event.data.tokenSymbol;
			case "contractAddress":
				return event.data.contractAddress;
			case "tokenId":
				return event.data.tokenId;
			case "gasUsed":
				return event.data.gasUsed;
			case "gasPrice":
				return event.data.gasPrice;
			case "blockNumber":
				return event.blockNumber;
			case "chainType":
				return event.chainType;
			case "eventType":
				return event.eventType;
			default:
				// Support nested field access via dot notation
				if (field.includes(".")) {
					const parts = field.split(".", 2);
					const parent = parts[0];
					const child = parts[1];
					if (parent && child) {
						const parentValue = this.getFieldValue(event, parent);
						if (typeof parentValue === "object" && parentValue !== null) {
							return (parentValue as any)[child];
						}
					}
				}
				return undefined;
		}
	}
}

/**
 * Priority filter that handles events based on target priority
 */
export class PriorityFilter extends BaseEventFilter {
	private configManager = ConfigManager.getInstance();
	private minimumPriority: "low" | "medium" | "high";

	constructor(minimumPriority: "low" | "medium" | "high" = "low") {
		super("priority_filter", "Priority Filter", 2);
		this.minimumPriority = minimumPriority;
	}

	async apply(event: BlockchainEvent): Promise<boolean> {
		const contractAddress =
			event.data.tokenAddress || event.data.contractAddress;

		if (!contractAddress) {
			return true; // No priority filtering for events without contract address
		}

		const targetConfig = this.configManager.getTargetConfig(
			contractAddress,
			event.chainType,
		);

		return this.isPriorityAtLeast(targetConfig.priority, this.minimumPriority);
	}

	private isPriorityAtLeast(
		eventPriority: "low" | "medium" | "high",
		minimumPriority: "low" | "medium" | "high",
	): boolean {
		const priorityLevels = { low: 1, medium: 2, high: 3 };
		return priorityLevels[eventPriority] >= priorityLevels[minimumPriority];
	}

	public setMinimumPriority(priority: "low" | "medium" | "high"): void {
		this.minimumPriority = priority;
	}
}
