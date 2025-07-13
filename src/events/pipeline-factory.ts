import {
	LoggerNotifier,
	RedisNotifier,
	WebhookNotifier,
} from "../notifications";
import { EventType } from "../types/events";
import config from "@/config.toml";
type Config = typeof config;
import { EventPipeline } from "./event-processor.interface";
import {
	AddressFilter,
	AmountFilter,
	ConfirmationFilter,
	ContractFilter,
	CustomRulesFilter,
	EventTypeFilter,
	PriorityFilter,
	SelfTransferFilter,
	TargetAwareAmountFilter,
} from "./filters";

export class PipelineFactory {
	private config = config;

	public createDefaultPipeline(): EventPipeline {
		const pipeline = new EventPipeline();

		this.addDefaultFilters(pipeline);
		this.addDefaultNotifiers(pipeline);

		return pipeline;
	}

	public createTransferPipeline(): EventPipeline {
		const pipeline = new EventPipeline();

		pipeline.addFilter(
			new EventTypeFilter([EventType.TRANSFER, EventType.NATIVE_TRANSFER]),
		);

		this.addDefaultFilters(pipeline);
		this.addDefaultNotifiers(pipeline);

		return pipeline;
	}

	public createMintingPipeline(): EventPipeline {
		const pipeline = new EventPipeline();

		pipeline.addFilter(
			new EventTypeFilter([EventType.TOKEN_MINT, EventType.NFT_MINT]),
		);

		pipeline.addFilter(new ContractFilter());
		pipeline.addFilter(
			new ConfirmationFilter(
				this.config.monitoring.token_minting.confirmation_blocks,
			),
		);

		this.addDefaultNotifiers(pipeline);

		return pipeline;
	}

	public createHighValuePipeline(minAmount = 10000): EventPipeline {
		const pipeline = new EventPipeline();

		pipeline.addFilter(new AmountFilter());
		pipeline.addFilter(new AddressFilter());
		pipeline.addFilter(
			new EventTypeFilter([
				EventType.TRANSFER,
				EventType.NATIVE_TRANSFER,
				EventType.TOKEN_MINT,
			]),
		);

		const highValueFilter = new AmountFilter();
		highValueFilter.setMinAmount(minAmount);
		pipeline.addFilter(highValueFilter);

		this.addDefaultNotifiers(pipeline);

		return pipeline;
	}

	public createCustomPipeline(options: {
		eventTypes?: EventType[];
		addressFilter?: boolean;
		contractFilter?: boolean;
		amountFilter?: boolean;
		targetAwareFilters?: boolean; // NEW: Enable target-aware filtering
		selfTransferFilter?: boolean;
		confirmationFilter?: boolean;
		priorityFilter?: "low" | "medium" | "high";
		customRulesFilter?: boolean;
		notifications?: ("webhook" | "redis" | "logger")[];
	}): EventPipeline {
		const pipeline = new EventPipeline();

		if (options.eventTypes && options.eventTypes.length > 0) {
			pipeline.addFilter(new EventTypeFilter(options.eventTypes));
		}

		if (options.addressFilter) {
			pipeline.addFilter(new AddressFilter());
		}

		if (options.contractFilter) {
			pipeline.addFilter(new ContractFilter());
		}

		if (options.amountFilter) {
			// Use target-aware amount filter if enabled, otherwise use global filter
			if (options.targetAwareFilters) {
				pipeline.addFilter(new TargetAwareAmountFilter());
			} else {
				pipeline.addFilter(new AmountFilter());
			}
		}

		if (options.selfTransferFilter) {
			pipeline.addFilter(new SelfTransferFilter());
		}

		if (options.confirmationFilter) {
			pipeline.addFilter(
				new ConfirmationFilter(
					this.config.monitoring.transfers.confirmation_blocks,
				),
			);
		}

		// Add enhanced filters
		if (options.priorityFilter) {
			pipeline.addFilter(new PriorityFilter(options.priorityFilter));
		}

		if (options.customRulesFilter) {
			pipeline.addFilter(new CustomRulesFilter());
		}

		if (options.notifications) {
			this.addSelectiveNotifiers(pipeline, options.notifications);
		} else {
			this.addDefaultNotifiers(pipeline);
		}

		return pipeline;
	}

	private addDefaultFilters(pipeline: EventPipeline): void {
		if (this.config.targets.addresses.watch_addresses.length > 0) {
			pipeline.addFilter(new AddressFilter());
		}

		if (
			this.config.targets.contracts.erc20_contracts.length > 0 ||
			this.config.targets.contracts.erc721_contracts.length > 0
		) {
			pipeline.addFilter(new ContractFilter());
		}

		// Use target-aware amount filter if enhanced targets are configured
		if (this.hasEnhancedTargets()) {
			pipeline.addFilter(new TargetAwareAmountFilter());
			pipeline.addFilter(new CustomRulesFilter());
		} else {
			pipeline.addFilter(new AmountFilter());
		}

		pipeline.addFilter(new SelfTransferFilter());
		pipeline.addFilter(
			new ConfirmationFilter(
				this.config.monitoring.transfers.confirmation_blocks,
			),
		);
	}

	private addDefaultNotifiers(pipeline: EventPipeline): void {
		if (!this.config.notifications.enabled) {
			return;
		}

		const enabledChannels = this.config.notifications.channels.map((channel) =>
			channel === "redis_pubsub" ? "redis" : channel,
		) as ("webhook" | "redis" | "logger")[];

		this.addSelectiveNotifiers(pipeline, enabledChannels);
	}

	private addSelectiveNotifiers(
		pipeline: EventPipeline,
		channels: ("webhook" | "redis" | "logger")[],
	): void {
		for (const channel of channels) {
			switch (channel) {
				case "webhook":
					if (this.config.notifications.webhook_url) {
						const webhookNotifier = new WebhookNotifier();
						pipeline.addNotifier(webhookNotifier);
					}
					break;

				case "redis":
					if (this.config.notifications.redis_channel) {
						const redisNotifier = new RedisNotifier();
						pipeline.addNotifier(redisNotifier);
					}
					break;

				case "logger": {
					const loggerNotifier = new LoggerNotifier();
					pipeline.addNotifier(loggerNotifier);
					break;
				}
			}
		}
	}

	public static createStandardPipelines(config?: Config): {
		default: EventPipeline;
		transfers: EventPipeline;
		minting: EventPipeline;
		highValue: EventPipeline;
	} {
		const factory = new PipelineFactory();

		return {
			default: factory.createDefaultPipeline(),
			transfers: factory.createTransferPipeline(),
			minting: factory.createMintingPipeline(),
			highValue: factory.createHighValuePipeline(),
		};
	}

	public updateConfig(config: Config): void {
		this.config = config;
	}

	public getConfig(): Readonly<Config> {
		return this.config;
	}

	/**
	 * Creates an enhanced pipeline with target-aware filtering
	 */
	public createEnhancedPipeline(options?: {
		eventTypes?: EventType[];
		priorityFilter?: "low" | "medium" | "high";
		customRulesEnabled?: boolean;
		notifications?: ("webhook" | "redis" | "logger")[];
	}): EventPipeline {
		const pipeline = new EventPipeline();

		// Add event type filter if specified
		if (options?.eventTypes && options.eventTypes.length > 0) {
			pipeline.addFilter(new EventTypeFilter(options.eventTypes));
		}

		// Add enhanced filters
		pipeline.addFilter(new AddressFilter());
		pipeline.addFilter(new ContractFilter());
		pipeline.addFilter(new TargetAwareAmountFilter());
		pipeline.addFilter(new SelfTransferFilter());

		// Add priority filter if specified
		if (options?.priorityFilter) {
			pipeline.addFilter(new PriorityFilter(options.priorityFilter));
		}

		// Add custom rules filter if enabled
		if (options?.customRulesEnabled !== false) {
			pipeline.addFilter(new CustomRulesFilter());
		}

		pipeline.addFilter(
			new ConfirmationFilter(
				this.config.monitoring.transfers.confirmation_blocks,
			),
		);

		// Add notifiers
		if (options?.notifications) {
			this.addSelectiveNotifiers(pipeline, options.notifications);
		} else {
			this.addDefaultNotifiers(pipeline);
		}

		return pipeline;
	}

	/**
	 * Checks if enhanced targets are configured
	 */
	private hasEnhancedTargets(): boolean {
		return Boolean(
			this.config.targets.enhanced_targets &&
				this.config.targets.enhanced_targets.length > 0,
		);
	}
}
