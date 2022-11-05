import { BigNumber, Wallet, ethers } from "ethers";
import * as dotenv from "dotenv";
import { BUNDLE_EXECUTOR_ABI } from "./abi";

export const ETHER = BigNumber.from(10).pow(18);

dotenv.config();

export function bigNumberToDecimal(value: BigNumber, base = 18): number {
	const divisor = BigNumber.from(10).pow(base);
	return value.mul(10000).div(divisor).toNumber() / 10000;
}

export function getDefaultRelaySigningKey(): string {
	console.warn(
		"You have not specified an explicity FLASHBOTS_RELAY_SIGNING_KEY environment variable. Creating random signing key, this searcher will not be building a reputation for next run"
	);
	return Wallet.createRandom().privateKey;
}

export async function testContract(): Promise<void> {
	// volume: BigNumber,
	// minerReward: BigNumber,
	// targets: string[],
	// payloads: string[]
	let nonce;

	const testProvider = new ethers.providers.JsonRpcProvider(
		"http://127.0.0.1:8545/"
	);

	const wallet = new ethers.Wallet(
		"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
		testProvider
	);

	const testContract = new ethers.Contract(
		"0xc0Bb1650A8eA5dDF81998f17B5319afD656f4c11",
		BUNDLE_EXECUTOR_ABI,
		testProvider
	);

	nonce = await testProvider.getTransactionCount(wallet.address);

	let tx = await wallet.sendTransaction({
		to: "0xc0Bb1650A8eA5dDF81998f17B5319afD656f4c11",
		value: ethers.utils.parseEther("10"),
		gasLimit: 1000000,
		gasPrice: 100000000000,
		nonce,
	});

	const to = wallet.address;

	const value = ethers.utils.parseEther("1");

	const beforeBalance = await testProvider.getBalance(to);

	nonce = await testProvider.getTransactionCount(wallet.address);
	// testing the ability to withdraw if I send eth to the contract
	tx = await testContract.connect(wallet).call(to, value, [], {
		gasLimit: BigNumber.from(1000000),
		gasPrice: BigNumber.from(100000000000),
		nonce,
	});

	await tx.wait(1);

	const afterBalance = await testProvider.getBalance(to);

	console.log(
		"before balance: ",
		ethers.utils.formatEther(beforeBalance.toString()).toString(),
		"\n"
	);
	console.log(
		"after balance: ",
		ethers.utils.formatEther(afterBalance.toString()).toString(),
		"\n"
	);

	// try {
	// 	nonce = await wallet.getTransactionCount();

	// 	console.log(`wallet nonce: ${nonce} \n`);

	// 	let tx = await wallet.sendTransaction({
	// 		to: "0xc0Bb1650A8eA5dDF81998f17B5319afD656f4c11",
	// 		value: ethers.utils.parseEther("10"),
	// 		gasLimit: 1000000,
	// 		gasPrice: 100000000000,
	// 		nonce,
	// 	});

	// 	let txReceipt = await tx.wait(1);

	// 	nonce = await wallet.getTransactionCount();

	// 	const testTransaction = await testContract.populateTransaction.uniswapWeth(
	// 		volume,
	// 		minerReward,
	// 		targets,
	// 		payloads,
	// 		{
	// 			gasPrice: BigNumber.from(100000000000),
	// 			gasLimit: BigNumber.from(1000000),
	// 			nonce,
	// 		}
	// 	);

	// 	const signedTransaction = await wallet.signTransaction(testTransaction);

	// 	tx = await testProvider.sendTransaction(signedTransaction);

	// 	txReceipt = await tx.wait(1);

	// 	console.log("Transaction receipt", txReceipt);
	// } catch (e) {
	// 	console.log(e);
	// }
}

export async function withdrawFromContract(): Promise<void> {
	const provider = new ethers.providers.JsonRpcProvider(
		process.env.ETHEREUM_RPC_URL
	);
	const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || "", provider);

	const BundleContract = new ethers.Contract(
		process.env.BUNDLE_EXECUTOR_ADDRESS || "",
		BUNDLE_EXECUTOR_ABI,
		provider
	);

	try {
		const value = await provider.getBalance(BundleContract.address);

		const balanceBefore = await provider.getBalance(wallet.address);

		console.log(
			"balance before: ",
			ethers.utils.formatEther(balanceBefore.toString()).toString(),
			"\n"
		);

		const tx = await BundleContract.connect(wallet).call(
			wallet.address,
			value,
			[]
		);

		await tx.wait(1);

		const balanceAfter = await provider.getBalance(wallet.address);

		console.log(
			"balance after: ",
			ethers.utils.formatEther(balanceAfter.toString()).toString(),
			"\n"
		);
	} catch (e) {
		console.log(e);
	}
}

// withdrawFromContract();
