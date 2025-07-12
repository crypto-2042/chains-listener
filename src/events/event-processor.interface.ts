import {
	type BlockchainEvent,
	ChainType,
	EventType,
	type ProcessedEvent,
} from "@/types/events";

export interface EventFilter {
	id: string;
	name: string;
	enabled: boolean;
	priority: number;

	apply(event: BlockchainEvent): Promise<boolean>;
}

export interface EventEnricher {
	id: string;
	name: string;
	enabled: boolean;

	enrich(event: BlockchainEvent): Promise<BlockchainEvent>;
}

export interface EventNotifier {
	id: string;
	name: string;
	enabled: boolean;

	notify(event: ProcessedEvent): Promise<void>;
}

export interface EventProcessor {
	id: string;
	name: string;
	enabled: boolean;

	process(event: BlockchainEvent): Promise<ProcessedEvent>;
}

export abstract class BaseEventFilter implements EventFilter {
	public readonly id: string;
	public readonly name: string;
	public enabled = true;
	public priority = 0;

	constructor(id: string, name: string, priority = 0) {
		this.id = id;
		this.name = name;
		this.priority = priority;
	}

	abstract apply(event: BlockchainEvent): Promise<boolean>;
}

export abstract class BaseEventEnricher implements EventEnricher {
	public readonly id: string;
	public readonly name: string;
	public enabled = true;

	constructor(id: string, name: string) {
		this.id = id;
		this.name = name;
	}

	abstract enrich(event: BlockchainEvent): Promise<BlockchainEvent>;
}

export abstract class BaseEventNotifier implements EventNotifier {
	public readonly id: string;
	public readonly name: string;
	public enabled = true;
	protected retryAttempts = 3;
	protected retryDelay = 1000;

	constructor(id: string, name: string) {
		this.id = id;
		this.name = name;
	}

	abstract notify(event: ProcessedEvent): Promise<void>;

	protected async retryOperation<T>(
		operation: () => Promise<T>,
		context: string,
	): Promise<T> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				if (attempt < this.retryAttempts - 1) {
					const delay = this.retryDelay * Math.pow(2, attempt);
					await this.sleep(delay);
				}
			}
		}

		throw new Error(
			`${context} failed after ${this.retryAttempts} attempts: ${lastError?.message}`,
		);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

export class EventPipeline {
	private filters: Map<string, EventFilter> = new Map();
	private enrichers: Map<string, EventEnricher> = new Map();
	private processors: Map<string, EventProcessor> = new Map();
	private notifiers: Map<string, EventNotifier> = new Map();

	public addFilter(filter: EventFilter): void {
		this.filters.set(filter.id, filter);
	}

	public removeFilter(filterId: string): void {
		this.filters.delete(filterId);
	}

	public addEnricher(enricher: EventEnricher): void {
		this.enrichers.set(enricher.id, enricher);
	}

	public removeEnricher(enricherId: string): void {
		this.enrichers.delete(enricherId);
	}

	public addProcessor(processor: EventProcessor): void {
		this.processors.set(processor.id, processor);
	}

	public removeProcessor(processorId: string): void {
		this.processors.delete(processorId);
	}

	public addNotifier(notifier: EventNotifier): void {
		this.notifiers.set(notifier.id, notifier);
	}

	public removeNotifier(notifierId: string): void {
		this.notifiers.delete(notifierId);
	}

	public async execute(event: BlockchainEvent): Promise<ProcessedEvent | null> {
		const startTime = Date.now();
		const correlationId = this.generateCorrelationId();

		try {
			const shouldProcess = await this.applyFilters(event);
			if (!shouldProcess) {
				return null;
			}

			const enrichedEvent = await this.applyEnrichments(event);
			const processedEvent = await this.processEvent(
				enrichedEvent,
				correlationId,
				startTime,
			);

			await this.sendNotifications(processedEvent);

			return processedEvent;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			throw new Error(`Event pipeline execution failed: ${errorMessage}`);
		}
	}

	private async applyFilters(event: BlockchainEvent): Promise<boolean> {
		const activeFilters = Array.from(this.filters.values())
			.filter((filter) => filter.enabled)
			.sort((a, b) => b.priority - a.priority);

		for (const filter of activeFilters) {
			try {
				const result = await filter.apply(event);
				if (!result) {
					return false;
				}
			} catch (error) {
				console.error(`Filter ${filter.id} failed:`, error);
				return false;
			}
		}

		return true;
	}

	private async applyEnrichments(
		event: BlockchainEvent,
	): Promise<BlockchainEvent> {
		let enrichedEvent = { ...event };

		const activeEnrichers = Array.from(this.enrichers.values()).filter(
			(enricher) => enricher.enabled,
		);

		for (const enricher of activeEnrichers) {
			try {
				enrichedEvent = await enricher.enrich(enrichedEvent);
			} catch (error) {
				console.error(`Enricher ${enricher.id} failed:`, error);
			}
		}

		return enrichedEvent;
	}

	private async processEvent(
		event: BlockchainEvent,
		correlationId: string,
		startTime: number,
	): Promise<ProcessedEvent> {
		const activeProcessors = Array.from(this.processors.values()).filter(
			(processor) => processor.enabled,
		);

		if (activeProcessors.length === 0) {
			return this.createDefaultProcessedEvent(event, correlationId, startTime);
		}

		let processedEvent: ProcessedEvent | null = null;

		for (const processor of activeProcessors) {
			try {
				processedEvent = await processor.process(event);
				break;
			} catch (error) {
				console.error(`Processor ${processor.id} failed:`, error);
			}
		}

		return (
			processedEvent ||
			this.createDefaultProcessedEvent(event, correlationId, startTime)
		);
	}

	private async sendNotifications(event: ProcessedEvent): Promise<void> {
		const activeNotifiers = Array.from(this.notifiers.values()).filter(
			(notifier) => notifier.enabled,
		);

		const notificationPromises = activeNotifiers.map(async (notifier) => {
			try {
				await notifier.notify(event);
				event.notifications.push({
					channel: notifier.id,
					success: true,
					timestamp: Date.now(),
					retryCount: 0,
				});
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				event.notifications.push({
					channel: notifier.id,
					success: false,
					timestamp: Date.now(),
					error: errorMessage,
					retryCount: 0,
				});
			}
		});

		await Promise.allSettled(notificationPromises);
	}

	private createDefaultProcessedEvent(
		event: BlockchainEvent,
		correlationId: string,
		startTime: number,
	): ProcessedEvent {
		return {
			id: `processed_${event.id}`,
			originalEvent: event,
			processed: true,
			processedAt: Date.now(),
			notifications: [],
			metadata: {
				correlationId,
				processingDuration: Date.now() - startTime,
				filters: Array.from(this.filters.keys()),
				enrichments: {},
				classification: {
					category: "medium_value",
					confidence: 0.5,
					tags: [],
				},
			},
		};
	}

	private generateCorrelationId(): string {
		return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	public getStats(): {
		filters: number;
		enrichers: number;
		processors: number;
		notifiers: number;
	} {
		return {
			filters: this.filters.size,
			enrichers: this.enrichers.size,
			processors: this.processors.size,
			notifiers: this.notifiers.size,
		};
	}
}
