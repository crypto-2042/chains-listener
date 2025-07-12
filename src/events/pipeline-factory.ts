import {
	LoggerNotifier,
	RedisNotifier,
	WebhookNotifier,
} from "@/notifications";
import { EventType } from "@/types/events";
import config from "@/config.toml";
type Config = typeof config;
import { EventPipeline } from "./event-processor.interface";
import {
	AddressFilter,
	AmountFilter,
	ConfirmationFilter,
	ContractFilter,
	EventTypeFilter,
	SelfTransferFilter,
} from "./filters";

export class PipelineFactory {
	private config = config;

	constructor() {
		// Config is now loaded directly from TOML import
	}

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
		selfTransferFilter?: boolean;
		confirmationFilter?: boolean;
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
			pipeline.addFilter(new AmountFilter());
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

		pipeline.addFilter(new AmountFilter());
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

				case "logger":
					const loggerNotifier = new LoggerNotifier();
					pipeline.addNotifier(loggerNotifier);
					break;
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
}
