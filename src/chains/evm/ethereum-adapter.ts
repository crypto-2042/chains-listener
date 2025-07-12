import { ChainType } from "@/types/events";
import config from "@/config.toml";
import { EVMChainAdapter, type EVMChainAdapterConfig } from "./evm-adapter";

export class EthereumAdapter extends EVMChainAdapter {
	constructor() {
		const ethereumConfig: EVMChainAdapterConfig = {
			rpcUrl: config.chains.ethereum.rpc_url,
			websocketUrl: config.chains.ethereum.websocket_url,
			maxRetryAttempts: config.chains.ethereum.max_retry_attempts,
			chainId: config.chains.ethereum.chain_id,
			blockConfirmationCount: config.chains.ethereum.block_confirmation_count,
			pollingInterval: config.monitoring.transfers.polling_interval_ms,
			batchSize: config.monitoring.transfers.batch_size,
		};

		super(ChainType.ETHEREUM, ethereumConfig);
	}

	validateAddress(address: string): boolean {
		if (!super.validateAddress(address)) {
			return false;
		}

		return address.length === 42 && address.startsWith("0x");
	}
}
