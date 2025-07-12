#!/usr/bin/env node

import { ChainsListener, type ChainsListenerConfig } from "./chains-listener";
import { ChainType, EventType } from "./types/events";
import config from "@/config.toml";

async function main() {
	try {
		console.log("🔗 Starting Chains-Listener...");

		console.log("✅ Configuration loaded successfully");

		const listener = new ChainsListener({
			autoStart: true,
			enabledChains: [ChainType.ETHEREUM, ChainType.BSC, ChainType.SOLANA, ChainType.SUI, ChainType.TRX],
		});

		listener.on("starting", () => {
			console.log("🚀 Initializing blockchain connections...");
		});

		listener.on("started", () => {
			console.log("✅ Chains-Listener started successfully");
			console.log(
				`📊 Monitoring chains: ${listener.getSupportedChains().join(", ")}`,
			);
			logConfiguration(config);
		});

		listener.on("eventProcessed", (event) => {
			const { chainType, eventType, transactionHash, data } =
				event.originalEvent;
			console.log(`🔔 Event processed: ${eventType} on ${chainType}`);
			console.log(`   📝 TX: ${transactionHash}`);
			if (data.from && data.to) {
				console.log(`   💸 ${data.from} → ${data.to}: ${data.amount || "N/A"}`);
			}
		});

		listener.on("eventProcessingError", (originalEvent, error) => {
			console.error(`❌ Event processing failed: ${error.message}`);
			console.error(`   📝 TX: ${originalEvent.transactionHash}`);
		});

		listener.on("chainStatusUpdate", (chainType, status) => {
			if (status.connected) {
				console.log(`🔗 ${chainType} connected (Block: ${status.blockHeight})`);
			} else {
				console.log(`🔌 ${chainType} disconnected`);
			}
		});

		listener.on("chainError", (chainType, error) => {
			console.error(`❌ ${chainType} error: ${error.message}`);
		});

		listener.on("error", (error) => {
			console.error(`❌ Chains-Listener error: ${error.message}`);
		});

		process.on("SIGINT", async () => {
			console.log("\n🛑 Received SIGINT, shutting down gracefully...");
			await listener.stop();
			console.log("👋 Chains-Listener stopped");
			process.exit(0);
		});

		process.on("SIGTERM", async () => {
			console.log("\n🛑 Received SIGTERM, shutting down gracefully...");
			await listener.stop();
			console.log("👋 Chains-Listener stopped");
			process.exit(0);
		});

		await listener.start();

		setInterval(() => {
			const stats = listener.getStats();
			console.log(
				`📊 Stats - Uptime: ${Math.floor(stats.uptime / 1000)}s, Events: ${stats.totalEvents}, Processed: ${stats.processedEvents}, Failed: ${stats.failedEvents}`,
			);
		}, 30000);
	} catch (error) {
		console.error("❌ Failed to start Chains-Listener:", error);
		process.exit(1);
	}
}

function logConfiguration(config: any) {
	console.log("\n📋 Configuration Summary:");
	console.log(
		`   🎯 Watch addresses: ${config.targets.addresses.watch_addresses.length}`,
	);
	console.log(
		`   🏪 ERC20 contracts: ${config.targets.contracts.erc20_contracts.length}`,
	);
	console.log(
		`   🖼️ ERC721 contracts: ${config.targets.contracts.erc721_contracts.length}`,
	);
	console.log(
		`   🔔 Notifications: ${config.notifications.enabled ? config.notifications.channels.join(", ") : "disabled"}`,
	);
	console.log(
		`   ⚡ Performance: ${config.performance.worker_pool_size} workers, ${config.performance.max_concurrent_requests} max requests`,
	);
	console.log("");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	main().catch(console.error);
}

export { ChainsListener, type ChainsListenerConfig };
export { ChainType, EventType };
export { config };
export type Config = typeof config;
export type {
	BlockchainEvent,
	ProcessedEvent,
	TransferEvent,
	TokenMintEvent,
} from "./types/events";
