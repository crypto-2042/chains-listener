import config from "@/config.toml";
import { ChainType } from "../../types/events";
import { EVMChainAdapter, type EVMChainAdapterConfig } from "./evm-adapter";

export class BSCAdapter extends EVMChainAdapter {
	constructor() {
		const bscConfig: EVMChainAdapterConfig = {
			rpcUrl: config.chains.bsc.rpc_url,
			websocketUrl: config.chains.bsc.websocket_url,
			maxRetryAttempts: config.chains.bsc.max_retry_attempts,
			chainId: config.chains.bsc.chain_id,
			blockConfirmationCount: config.chains.bsc.block_confirmation_count,
			pollingInterval: config.monitoring.transfers.polling_interval_ms,
			batchSize: config.monitoring.transfers.batch_size,
		};

		super(ChainType.BSC, bscConfig);
	}

	validateAddress(address: string): boolean {
		if (!super.validateAddress(address)) {
			return false;
		}

		return address.length === 42 && address.startsWith("0x");
	}
}
