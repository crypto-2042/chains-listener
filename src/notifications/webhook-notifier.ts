import config from "@/config.toml";
import axios, { type AxiosResponse } from "axios";
import { BaseEventNotifier } from "../events/event-processor.interface";
import type { ProcessedEvent } from "../types/events";

export interface WebhookConfig {
	url: string;
	headers?: Record<string, string>;
	timeout: number;
	retryAttempts: number;
	retryDelay: number;
}

export class WebhookNotifier extends BaseEventNotifier {
	private config: WebhookConfig;

	constructor(customConfig?: Partial<WebhookConfig>) {
		super("webhook_notifier", "Webhook Event Notifier");

		this.config = {
			url: customConfig?.url || config.notifications.webhook_url || "",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "chains-listener/1.0",
				...customConfig?.headers,
			},
			timeout: customConfig?.timeout || 30000,
			retryAttempts: customConfig?.retryAttempts || 3,
			retryDelay: customConfig?.retryDelay || 1000,
		};

		this.retryAttempts = this.config.retryAttempts;
		this.retryDelay = this.config.retryDelay;

		if (!this.config.url) {
			console.warn(
				"WebhookNotifier: No webhook URL configured, notifications will be skipped",
			);
			this.enabled = false;
		}
	}

	async notify(event: ProcessedEvent): Promise<void> {
		if (!this.enabled || !this.config.url) {
			return;
		}

		const payload = this.createWebhookPayload(event);

		await this.retryOperation(
			() => this.sendWebhook(payload),
			`webhook notification for event ${event.id}`,
		);
	}

	private createWebhookPayload(event: ProcessedEvent): object {
		return {
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
			notifications: event.notifications,
			processed: event.processed,
			errors: event.errors || [],
		};
	}

	private async sendWebhook(payload: object): Promise<AxiosResponse> {
		try {
			const response = await axios.post(this.config.url, payload, {
				headers: this.config.headers,
				timeout: this.config.timeout,
				validateStatus: (status) => status >= 200 && status < 300,
			});

			return response;
		} catch (error) {
			if (axios.isAxiosError(error)) {
				const status = error.response?.status;
				const statusText = error.response?.statusText;
				const data = error.response?.data;

				throw new Error(
					`Webhook request failed: ${status} ${statusText}. Response: ${JSON.stringify(data)}`,
				);
			}

			throw new Error(`Webhook request failed: ${error}`);
		}
	}

	public updateConfig(config: Partial<WebhookConfig>): void {
		this.config = { ...this.config, ...config };

		if (config.retryAttempts !== undefined) {
			this.retryAttempts = config.retryAttempts;
		}

		if (config.retryDelay !== undefined) {
			this.retryDelay = config.retryDelay;
		}

		this.enabled = Boolean(this.config.url);
	}

	public getConfig(): Readonly<WebhookConfig> {
		return { ...this.config };
	}

	public async testConnection(): Promise<boolean> {
		if (!this.config.url) {
			return false;
		}

		try {
			const testPayload = {
				test: true,
				timestamp: Date.now(),
				message: "Webhook connection test from chains-listener",
			};

			await this.sendWebhook(testPayload);
			return true;
		} catch (error) {
			console.error("Webhook connection test failed:", error);
			return false;
		}
	}
}
