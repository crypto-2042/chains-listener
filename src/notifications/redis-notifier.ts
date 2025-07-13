import { BaseEventNotifier } from "../events/event-processor.interface";
import type { ProcessedEvent } from "../types/events";
import { type RedisClientType, createClient } from "redis";
import config from "@/config.toml";

export interface RedisNotifierConfig {
	url: string;
	channel: string;
	maxRetries?: number;
	retryDelay?: number;
	connectionTimeout?: number;
}

export class RedisNotifier extends BaseEventNotifier {
	private client: RedisClientType | null = null;
	private config: RedisNotifierConfig;
	private isConnected = false;

	constructor(customConfig?: Partial<RedisNotifierConfig>) {
		super("redis_notifier", "Redis Pub/Sub Event Notifier");

		this.config = {
			url: customConfig?.url || config.database.redis_url,
			channel:
				customConfig?.channel ||
				config.notifications.redis_channel ||
				"blockchain_events",
			maxRetries: customConfig?.maxRetries || 3,
			retryDelay: customConfig?.retryDelay || 1000,
			connectionTimeout: customConfig?.connectionTimeout || 10000,
		};

		this.retryAttempts = this.config.maxRetries!;
		this.retryDelay = this.config.retryDelay!;
	}

	async notify(event: ProcessedEvent): Promise<void> {
		if (!this.enabled) {
			return;
		}

		await this.ensureConnection();

		const payload = this.createRedisPayload(event);

		await this.retryOperation(
			() => this.publishToRedis(payload),
			`Redis notification for event ${event.id}`,
		);
	}

	private async ensureConnection(): Promise<void> {
		if (this.isConnected && this.client?.isReady) {
			return;
		}

		await this.connect();
	}

	private async connect(): Promise<void> {
		try {
			if (this.client) {
				await this.disconnect();
			}

			this.client = createClient({
				url: this.config.url,
				socket: {
					connectTimeout: this.config.connectionTimeout,
				},
			});

			this.client.on("error", (error) => {
				console.error("Redis client error:", error);
				this.isConnected = false;
			});

			this.client.on("connect", () => {
				this.isConnected = true;
			});

			this.client.on("disconnect", () => {
				this.isConnected = false;
			});

			await this.client.connect();
			this.isConnected = true;
		} catch (error) {
			this.isConnected = false;
			throw new Error(`Failed to connect to Redis: ${error}`);
		}
	}

	private async disconnect(): Promise<void> {
		if (this.client) {
			try {
				await this.client.quit();
			} catch (error) {
				console.error("Error disconnecting from Redis:", error);
			} finally {
				this.client = null;
				this.isConnected = false;
			}
		}
	}

	private createRedisPayload(event: ProcessedEvent): string {
		const payload = {
			id: event.id,
			timestamp: event.processedAt,
			event: {
				id: event.originalEvent.id,
				chainType: event.originalEvent.chainType,
				eventType: event.originalEvent.eventType,
				blockNumber: event.originalEvent.blockNumber,
				transactionHash: event.originalEvent.transactionHash,
				timestamp: event.originalEvent.timestamp,
				confirmed: event.originalEvent.confirmed,
				data: event.originalEvent.data,
			},
			metadata: event.metadata,
			processed: event.processed,
			errors: event.errors || [],
		};

		return JSON.stringify(payload);
	}

	private async publishToRedis(payload: string): Promise<void> {
		if (!this.client || !this.isConnected) {
			throw new Error("Redis client not connected");
		}

		try {
			const result = await this.client.publish(this.config.channel, payload);

			if (result === 0) {
				console.warn(
					`No subscribers listening on channel: ${this.config.channel}`,
				);
			}
		} catch (error) {
			throw new Error(`Failed to publish to Redis: ${error}`);
		}
	}

	public async updateConfig(
		config: Partial<RedisNotifierConfig>,
	): Promise<void> {
		const shouldReconnect = config.url && config.url !== this.config.url;

		this.config = { ...this.config, ...config };

		if (config.maxRetries !== undefined) {
			this.retryAttempts = config.maxRetries;
		}

		if (config.retryDelay !== undefined) {
			this.retryDelay = config.retryDelay;
		}

		if (shouldReconnect && this.isConnected) {
			await this.disconnect();
			await this.connect();
		}
	}

	public getConfig(): Readonly<RedisNotifierConfig> {
		return { ...this.config };
	}

	public async testConnection(): Promise<boolean> {
		try {
			await this.ensureConnection();

			if (!this.client) {
				return false;
			}

			const testMessage = JSON.stringify({
				test: true,
				timestamp: Date.now(),
				message: "Redis connection test from chains-listener",
			});

			await this.client.publish(`${this.config.channel}_test`, testMessage);
			return true;
		} catch (error) {
			console.error("Redis connection test failed:", error);
			return false;
		}
	}

	public isReady(): boolean {
		return this.isConnected && Boolean(this.client?.isReady);
	}

	public async shutdown(): Promise<void> {
		this.enabled = false;
		await this.disconnect();
	}

	public async getSubscriberCount(): Promise<number> {
		try {
			await this.ensureConnection();

			if (!this.client) {
				return 0;
			}

			const result = await this.client.pubSubNumSub(this.config.channel);
			return result[this.config.channel] || 0;
		} catch (error) {
			console.error("Failed to get subscriber count:", error);
			return 0;
		}
	}
}
