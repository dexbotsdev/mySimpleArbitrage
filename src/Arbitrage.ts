import * as _ from "lodash";
import { BigNumber, Contract, Wallet } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { WETH_ADDRESS } from "./addresses";
import { EthMarket } from "./EthMarket";
import { ETHER, bigNumberToDecimal } from "./utils";
import { ethers } from "ethers";
import { BUNDLE_EXECUTOR_ABI } from "./abi";

export interface CrossedMarketDetails {
	profit: BigNumber;
	volume: BigNumber;
	tokenAddress: string;
	buyFromMarket: EthMarket;
	sellToMarket: EthMarket;
}

interface BinarySearchResults {
	profit: BigNumber;
	volume: BigNumber;
}

export type MarketsByToken = { [tokenAddress: string]: Array<EthMarket> };

// TODO: implement binary search (assuming linear/exponential global maximum profitability)
const TEST_VOLUMES = [
	ETHER.div(100),
	ETHER.div(10),
	ETHER.div(6),
	ETHER.div(4),
	ETHER.div(2),
	ETHER.div(1),
	ETHER.mul(2),
	ETHER.mul(5),
	ETHER.mul(10),
];

const BOUNDS = [ETHER.div(100), ETHER.mul(10)];

// the goal is not to get the best crossed market by changing the markets against each other but instead to get the best profits by changing the volume of the markets

export function getBestCrossedMarket(
	crossedMarkets: Array<EthMarket>[],
	tokenAddress: string
): CrossedMarketDetails | undefined {
	let bestCrossedMarket: CrossedMarketDetails | undefined = undefined;
	// let myMarket: CrossedMarketDetails | undefined = undefined;
	// crossed markets is gonna have a length of one or 0
	if (crossedMarkets.length !== 0) {
		for (const crossedMarket of crossedMarkets) {
			interface ProfitLog {
				profit: BigNumber;
				volume: BigNumber;
			}
			// sellToMarket will be selling WETH to market 0 from arbitrary token
			const sellToMarket = crossedMarket[0];
			// buyFromMarket will be buying WETH from market 1 with the arbitrary token
			const buyFromMarket = crossedMarket[1];
			// check to see if it gives the best possible profit

			const getProfitFromVolume = (volume: BigNumber): BigNumber => {
				const tokensOutFromBuyingSize = buyFromMarket.getTokensOut(
					WETH_ADDRESS,
					tokenAddress,
					volume
				);
				const proceedsFromSellingTokens = sellToMarket.getTokensOut(
					tokenAddress,
					WETH_ADDRESS,
					tokensOutFromBuyingSize
				);
				const profit = proceedsFromSellingTokens.sub(volume);
				return profit;
			};

			const profitLogs: ProfitLog[] = [];

			let counter = 0;

			const binarySearchProfit = (
				lowerBound: BigNumber,
				upperBound: BigNumber
			): BinarySearchResults => {
				const difference = upperBound.sub(lowerBound);
				const increments = difference.div(10);
				for (let i = 0; i < 10; i++) {
					const volume = lowerBound.add(increments.mul(i));
					const profit = getProfitFromVolume(volume);
					profitLogs.push({ profit, volume });
				}
				// sort the profitLogs by profit where the highest profit is at the beginning
				profitLogs.sort((a, b) => {
					return Number(b.profit.sub(a.profit));
				});

				// get the three highest profit values and their corresponding volumes
				const highestLogs = profitLogs.slice(0, 3);

				// sort the highestLog where the lowest volume is at the beginning
				highestLogs.sort((a, b) => {
					return Number(a.volume.sub(b.volume));
				});
				counter++;

				// check to see if the actual highest price si not in the middle of the three volumes
				if (counter <= 5) {
					return binarySearchProfit(highestLogs[0].volume, highestLogs[2].volume);
				} else {
					return profitLogs[0];
				}
			};

			for (const size of TEST_VOLUMES) {
				// returns the amountOut from the buying size
				const tokensOutFromBuyingSize = buyFromMarket.getTokensOut(
					WETH_ADDRESS,
					tokenAddress,
					size
				);
				// use the amountsOut from the buyingSize as the amountIn on the selling market to get the amount of WETH that will be received
				const proceedsFromSellingTokens = sellToMarket.getTokensOut(
					tokenAddress,
					WETH_ADDRESS,
					tokensOutFromBuyingSize
				);

				const profit = proceedsFromSellingTokens.sub(size);

				if (
					bestCrossedMarket !== undefined &&
					profit.lt(bestCrossedMarket.profit)
				) {
					// If the next size up lost value, meet halfway. TODO: replace with real binary search

					const trySize = size.add(bestCrossedMarket.volume).div(2);
					const tryTokensOutFromBuyingSize = buyFromMarket.getTokensOut(
						WETH_ADDRESS,
						tokenAddress,
						trySize
					);
					const tryProceedsFromSellingTokens = sellToMarket.getTokensOut(
						tokenAddress,
						WETH_ADDRESS,
						tryTokensOutFromBuyingSize
					);
					const tryProfit = tryProceedsFromSellingTokens.sub(trySize);

					if (tryProfit.gt(bestCrossedMarket.profit)) {
						bestCrossedMarket = {
							volume: trySize,
							profit: tryProfit,
							tokenAddress,
							sellToMarket,
							buyFromMarket,
						};
					}

					break;
				}
				bestCrossedMarket = {
					volume: size,
					profit: profit,
					tokenAddress,
					sellToMarket,
					buyFromMarket,
				};
			}
			const bestProfitLog = binarySearchProfit(BOUNDS[0], BOUNDS[1]);
			if (bestProfitLog?.profit.gt(0)) {
				bestCrossedMarket = {
					profit: bestProfitLog.profit,
					volume: bestProfitLog.volume,
					tokenAddress,
					buyFromMarket,
					sellToMarket,
				};
				// myMarket = {
				// 	profit: bestProfitLog.profit,
				// 	volume: bestProfitLog.volume,
				// 	tokenAddress,
				// 	buyFromMarket,
				// 	sellToMarket,
				// };
			}
		}

		// check which market has a greater profit
		return bestCrossedMarket;
	}
}

export class Arbitrage {
	private flashbotsProvider: FlashbotsBundleProvider;
	private bundleExecutorContract: Contract;
	private executorWallet: Wallet;

	constructor(
		executorWallet: Wallet,
		flashbotsProvider: FlashbotsBundleProvider,
		bundleExecutorContract: Contract
	) {
		this.executorWallet = executorWallet;
		this.flashbotsProvider = flashbotsProvider;
		this.bundleExecutorContract = bundleExecutorContract;
	}

	static printCrossedMarket(crossedMarket: CrossedMarketDetails): void {
		const buyTokens = crossedMarket.buyFromMarket.tokens;
		const sellTokens = crossedMarket.sellToMarket.tokens;
		console.log(
			`Profit: ${bigNumberToDecimal(
				crossedMarket.profit
			)} Volume: ${bigNumberToDecimal(crossedMarket.volume)}\n` +
				`${crossedMarket.buyFromMarket.protocol} (${crossedMarket.buyFromMarket.marketAddress})\n` +
				`  ${buyTokens[0]} => ${buyTokens[1]}\n` +
				`${crossedMarket.sellToMarket.protocol} (${crossedMarket.sellToMarket.marketAddress})\n` +
				`  ${sellTokens[0]} => ${sellTokens[1]}\n` +
				`\n`
		);
	}

	// here is where you would look for markets to hop tokens
	async evaluateMarkets(
		marketsByToken: MarketsByToken
	): Promise<Array<CrossedMarketDetails>> {
		const bestCrossedMarkets = new Array<CrossedMarketDetails>();

		// for each token address in marketsByToken object
		for (const tokenAddress in marketsByToken) {
			// we will set the markets to be equal to the array of ethMarkets inside the marketsByToken object
			const markets = marketsByToken[tokenAddress];
			// now we will a new array of pricedMarkets where we will have the ethMarket itself, the buyTokenPrice, and the sellTokenPrice
			const pricedMarkets = _.map(markets, (ethMarket: EthMarket) => {
				return {
					ethMarket: ethMarket,
					// getTokensIn returns the amount of tokens needed to get out the amount of WETH = ETHER.div(100)
					buyTokenPrice: ethMarket.getTokensIn(
						tokenAddress,
						WETH_ADDRESS,
						ETHER.div(100)
					),
					// getTokensOut returns the amount of tokens you get from the amount of WETH = ETHER.div(100)
					sellTokenPrice: ethMarket.getTokensOut(
						WETH_ADDRESS,
						tokenAddress,
						ETHER.div(100)
					),
				};
			});

			// now that you have the priced markets you will want to compare the price within each market to see if you can sell the token for a higher price than you are buying it for
			// crossedMarkets will be an array of arrays of ethMarkets [
			// 	[ethMarket1, ethMarket2],
			// 	[ethMarket1, ethMarket3],
			// 	[ethMarket2, ethMarket3]
			// ]
			const crossedMarkets = new Array<Array<EthMarket>>();
			// for each pricedMarket in pricedMarkets
			for (const pricedMarket of pricedMarkets) {
				// going to search through the pricedMarkets array to see if there is a market that has a higher sellTokenPrice than the current pricedMarket
				_.forEach(pricedMarkets, (pm) => {
					// remember sellTokenPrice returns the amount of arb tokens you get from the amount of WETH = ETHER.div(100)
					if (pm.sellTokenPrice.gt(pricedMarket.buyTokenPrice)) {
						// crossedMarket will have the first index be the pricedMarket where you are buying from and the second index be the pricedMarket where you are selling to, ie buy usdc from market 1, sell usdc for more WETH on market 2
						crossedMarkets.push([pricedMarket.ethMarket, pm.ethMarket]);
					}
				});
			}

			// bestCrossedMarket will be the best crossed market of each token address
			const bestCrossedMarket = getBestCrossedMarket(crossedMarkets, tokenAddress);

			if (
				bestCrossedMarket !== undefined &&
				bestCrossedMarket.profit.gt(ETHER.div(1000))
			) {
				bestCrossedMarkets.push(bestCrossedMarket);
			}
		}
		bestCrossedMarkets.sort((a, b) =>
			a.profit.lt(b.profit) ? 1 : a.profit.gt(b.profit) ? -1 : 0
		);
		return bestCrossedMarkets;
	}

	// amount of ETH before the transaction 0.976572232417622417

	// TODO: take more than 1
	async takeCrossedMarkets(
		bestCrossedMarkets: CrossedMarketDetails[],
		blockNumber: number,
		minerRewardPercentage: number
	): Promise<void> {
		for (const bestCrossedMarket of bestCrossedMarkets) {
			console.log(
				"Send this much WETH",
				bestCrossedMarket.volume.toString(),
				"get this much profit",
				bestCrossedMarket.profit.toString(),
				"\n"
			);

			// buy calls generates byte code data, payloads carry info for what to do with the data
			const buyCalls =
				await bestCrossedMarket.buyFromMarket.sellTokensToNextMarket(
					WETH_ADDRESS,
					bestCrossedMarket.volume,
					bestCrossedMarket.sellToMarket
				);

			const inter = bestCrossedMarket.buyFromMarket.getTokensOut(
				WETH_ADDRESS,
				bestCrossedMarket.tokenAddress,
				bestCrossedMarket.volume
			);

			const sellCallData = await bestCrossedMarket.sellToMarket.sellTokens(
				bestCrossedMarket.tokenAddress,
				inter,
				this.bundleExecutorContract.address
			);

			const targets: Array<string> = [
				...buyCalls.targets,
				bestCrossedMarket.sellToMarket.marketAddress,
			];

			const payloads: Array<string> = [...buyCalls.data, sellCallData];

			console.log({ targets, payloads }, "\n");

			const minerReward = bestCrossedMarket.profit
				.mul(minerRewardPercentage)
				.div(100);

			// construct the transaction
			const transaction =
				await this.bundleExecutorContract.populateTransaction.uniswapWeth(
					bestCrossedMarket.volume,
					minerReward,
					targets,
					payloads,
					{
						gasPrice: BigNumber.from(0),
						gasLimit: BigNumber.from(1000000),
					}
				);

			// simulating a transaction if it fails to estimate gas then it will throw an error
			try {
				const estimateGas = await this.bundleExecutorContract.provider.estimateGas({
					...transaction,
					from: this.executorWallet.address,
				});

				if (estimateGas.gt(1400000)) {
					console.log(
						"EstimateGas succeeded, but suspiciously large: " + estimateGas.toString()
					);
					continue;
				}
				transaction.gasLimit = estimateGas.mul(2);
			} catch (e) {
				console.warn(
					`Estimate gas failure for ${JSON.stringify(bestCrossedMarket)} \n`
				);
				continue;
			}

			// create a flashbots bundle array, could add multiple transactions to the bundle array, all the transactions in a bundle need to be executed in the order they are presented in the array.
			// you could snipe a signed transaction from the mempool and add it to the bundle array
			// ie you could input the oracle update signed transaction into the bundle array and then liquidate a loan as you are the very next

			console.log("Creating bundledTransactions");

			const bundledTransactions = [
				{
					signer: this.executorWallet,
					transaction: transaction,
				},
			];

			console.log(bundledTransactions);
			// flashbots also takes signed bundles with a privateKey
			const signedBundle = await this.flashbotsProvider.signBundle(
				bundledTransactions
			);

			// simulates the bundle to make sure there are no errors
			const simulation = await this.flashbotsProvider.simulate(
				signedBundle,
				blockNumber + 1
			);

			if ("error" in simulation || simulation.firstRevert !== undefined) {
				console.log(
					`Simulation Error on token ${bestCrossedMarket.tokenAddress}, skipping`
				);
				continue;
			}

			console.log(
				`Submitting bundle, profit sent to miner: ${bigNumberToDecimal(
					simulation.coinbaseDiff
				)}, effective gas price: ${bigNumberToDecimal(
					simulation.coinbaseDiff.div(simulation.totalGasUsed),
					9
				)} GWEI`
			);

			// submits the bundle to flashbots for this block and the next block
			const bundlePromises = _.map(
				[blockNumber + 1, blockNumber + 2],
				(targetBlockNumber) =>
					this.flashbotsProvider.sendRawBundle(signedBundle, targetBlockNumber)
			);
			await Promise.all(bundlePromises);
			return;
		}
		throw new Error("No arbitrage submitted to relay");
	}
}
