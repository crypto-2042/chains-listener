import { ChainType } from "@/types/events";
import config from "@/config.toml";
import { EVMChainAdapter, type EVMChainAdapterConfig } from "../evm/evm-adapter";

export class TronAdapter extends EVMChainAdapter {
	constructor() {
		const tronConfig: EVMChainAdapterConfig = {
			rpcUrl: config.chains.trx.rpc_url,
			websocketUrl: config.chains.trx.websocket_url,
			maxRetryAttempts: config.chains.trx.max_retry_attempts,
			chainId: config.chains.trx.chain_id,
			blockConfirmationCount: config.chains.trx.block_confirmation_count,
			pollingInterval: config.monitoring.transfers.polling_interval_ms,
			batchSize: config.monitoring.transfers.batch_size,
		};

		super(ChainType.TRX, tronConfig);
	}

	validateAddress(address: string): boolean {
		// TRON addresses use Base58 encoding and start with 'T' for mainnet
		// They are 34 characters long
		if (!address || typeof address !== "string") {
			return false;
		}

		// Basic TRON address validation
		// Mainnet addresses start with 'T', testnet with 'D'
		// Length should be 34 characters
		const isValidFormat = /^[TD][A-HJ-NP-Za-km-z1-9]{33}$/.test(address);
		
		if (!isValidFormat) {
			// Fallback to parent EVM validation for hex addresses
			return super.validateAddress(address);
		}

		return isValidFormat;
	}

	private formatTronAddress(address: string): string {
		// TRON addresses are already in the correct format (Base58)
		// For hex addresses, they should be handled by the parent EVM adapter
		return address;
	}

	private getTronEventTopics(): Record<string, string> {
		// TRON uses the same event signatures as Ethereum for TRC-20/TRC-721
		return {
			// TRC-20 Transfer event: Transfer(address,address,uint256)
			TRANSFER: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
			// TRC-721 Transfer event: Transfer(address,address,uint256)
			NFT_TRANSFER: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
			// Mint event (common pattern)
			MINT: "0x0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d4121396885",
		};
	}

	public async estimateGas(transaction: unknown): Promise<string> {
		// TRON uses energy/bandwidth model instead of gas
		// Return a reasonable default for compatibility
		try {
			const result = await super.estimateGas(transaction);
			return result;
		} catch (error) {
			// Fallback to a reasonable default for TRON
			return "100000"; // Default energy estimate
		}
	}
}