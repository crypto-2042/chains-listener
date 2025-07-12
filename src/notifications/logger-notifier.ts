import { BaseEventNotifier } from "@/events/event-processor.interface";
import type { ProcessedEvent } from "@/types/events";
import config from "@/config.toml";
import winston from "winston";

export interface LoggerNotifierConfig {
	level: "debug" | "info" | "warn" | "error";
	format: "json" | "simple" | "text";
	includeMetadata: boolean;
	includeEventData: boolean;
}

export class LoggerNotifier extends BaseEventNotifier {
	private logger: winston.Logger;
	private config: LoggerNotifierConfig;

	constructor(customConfig?: Partial<LoggerNotifierConfig>) {
		super("logger_notifier", "Winston Logger Event Notifier");

		this.config = {
			level: customConfig?.level || config.logging.level || "info",
			format: customConfig?.format || config.logging.format || "json",
			includeMetadata: customConfig?.includeMetadata ?? true,
			includeEventData: customConfig?.includeEventData ?? true,
		};

		this.logger = this.createLogger();
	}

	async notify(event: ProcessedEvent): Promise<void> {
		if (!this.enabled) {
			return;
		}

		const logData = this.createLogData(event);

		try {
			this.logger.log(this.config.level, "Blockchain event processed", logData);
		} catch (error) {
			console.error("Failed to log event:", error);
			throw new Error(`Logger notification failed: ${error}`);
		}
	}

	private createLogger(): winston.Logger {
		const formats: winston.Logform.Format[] = [
			winston.format.timestamp(),
			winston.format.errors({ stack: true }),
		];

		if (this.config.format === "json") {
			formats.push(winston.format.json());
		} else {
			formats.push(
				winston.format.printf(({ timestamp, level, message, ...meta }) => {
					const metaStr = Object.keys(meta).length
						? `\n${JSON.stringify(meta, null, 2)}`
						: "";
					return `${timestamp} [${level.toUpperCase()}]: ${message}${metaStr}`;
				}),
			);
		}

		return winston.createLogger({
			level: this.config.level,
			format: winston.format.combine(...formats),
			transports: [
				new winston.transports.Console({
					handleExceptions: true,
					handleRejections: true,
				}),
				new winston.transports.File({
					filename: "logs/blockchain-events.log",
					handleExceptions: true,
					handleRejections: true,
					maxsize: 10 * 1024 * 1024, // 10MB
					maxFiles: 5,
				}),
				new winston.transports.File({
					filename: "logs/blockchain-events-error.log",
					level: "error",
					handleExceptions: true,
					handleRejections: true,
					maxsize: 10 * 1024 * 1024, // 10MB
					maxFiles: 5,
				}),
			],
			exitOnError: false,
		});
	}

	private createLogData(event: ProcessedEvent): object {
		const logData: any = {
			eventId: event.id,
			processedAt: event.processedAt,
			processingDuration: event.metadata.processingDuration,
			chainType: event.originalEvent.chainType,
			eventType: event.originalEvent.eventType,
			blockNumber: event.originalEvent.blockNumber,
			transactionHash: event.originalEvent.transactionHash,
			confirmed: event.originalEvent.confirmed,
			notificationCount: event.notifications.length,
			successful: event.processed,
		};

		if (this.config.includeMetadata) {
			logData.metadata = {
				correlationId: event.metadata.correlationId,
				classification: event.metadata.classification,
				filters: event.metadata.filters,
				usdValue: event.metadata.usdValue,
			};
		}

		if (this.config.includeEventData) {
			logData.eventData = event.originalEvent.data;
		}

		if (event.errors && event.errors.length > 0) {
			logData.errors = event.errors;
		}

		if (event.notifications.length > 0) {
			logData.notifications = event.notifications.map((notification) => ({
				channel: notification.channel,
				success: notification.success,
				retryCount: notification.retryCount,
				error: notification.error,
			}));
		}

		return logData;
	}

	public updateConfig(config: Partial<LoggerNotifierConfig>): void {
		this.config = { ...this.config, ...config };

		this.logger.close();
		this.logger = this.createLogger();
	}

	public getConfig(): Readonly<LoggerNotifierConfig> {
		return { ...this.config };
	}

	public getLogger(): winston.Logger {
		return this.logger;
	}

	public async testConnection(): Promise<boolean> {
		try {
			this.logger.info("Logger notifier test message", {
				test: true,
				timestamp: Date.now(),
			});
			return true;
		} catch (error) {
			console.error("Logger test failed:", error);
			return false;
		}
	}

	public async shutdown(): Promise<void> {
		this.enabled = false;

		return new Promise<void>((resolve) => {
			this.logger.on("finish", () => {
				resolve();
			});

			this.logger.close();
		});
	}
}
