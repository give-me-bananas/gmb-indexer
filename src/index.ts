import dotenv from "dotenv";
import * as BananaController from "./BananaController.json";
import { BigNumber, Contract, ethers } from "ethers";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { PrismaClient } from "@prisma/client";
import { normalizeL1ContractAddress } from "./utils";
import { AbiCoder } from "ethers/lib/utils";
import { Erc20TokenDetail } from "./types";

dotenv.config();

const rpcUrl = process.env.RPC_URL!;
const bananaControllerAddress = process.env.BANANA_CONTROLLER_ADDRESS!;
const notificationBaseUrl = process.env.NOTIFICATION_BASE_URL!;
const supportedErc20TokenAddress =
  process.env.SUPPORTED_ERC20_TOKEN_ADDRESS!.split(",");
const supportedErc20TokenSymbol =
  process.env.SUPPORTED_ERC20_TOKEN_SYMBOL!.split(",");
const supportedErc20TokenDecimal =
  process.env.SUPPORTED_ERC20_TOKEN_DECIMAL!.split(",");
const startBlockNumber = parseInt(process.env.START_BLOCK_NUMBER!);
const numOfBlocksToIndex = 1000;

const abi = BananaController.abi;

const erc20TokenDetailMapping: Map<string, Erc20TokenDetail> = new Map();
for (let i = 0; i < supportedErc20TokenAddress.length; i++) {
  erc20TokenDetailMapping.set(
    normalizeL1ContractAddress(supportedErc20TokenAddress[i]),
    {
      symbol: supportedErc20TokenSymbol[i],
      decimal: parseInt(supportedErc20TokenDecimal[i]),
    }
  );
}

async function main(db: PrismaClient) {
  // only be reading latest events on stream

  // init provider and contract
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const bananaControllerContract = new Contract(
    bananaControllerAddress,
    abi,
    provider
  );

  const donationFilter = bananaControllerContract.filters.Donate();

  while (true) {
    const latestBlockNumber = await getLatestBlockNumber(db);
    const fromBlockNumber = latestBlockNumber
      ? latestBlockNumber.blockNumber + 1
      : startBlockNumber;
    const toBlockNumber = fromBlockNumber + numOfBlocksToIndex;

    const filter = {
      ...donationFilter,
      fromBlock: fromBlockNumber,
      toBlock: toBlockNumber,
    };
    const logs = await provider.getLogs(filter);

    for (const log of logs) {
      const donor = normalizeL1ContractAddress(log.topics[1]);
      const recipient = normalizeL1ContractAddress(log.topics[2]);
      const erc20TokenAddress = normalizeL1ContractAddress(log.topics[2]);

      const values = new AbiCoder().decode(
        ["uint256", "uint256", "string", "string"],
        log.data
      );
      const netDonation = BigNumber.from(values[0]);
      const commission = BigNumber.from(values[1]);
      const donorName: string = values[2];
      const message: string = values[3];

      await db.donationHistory.create({
        data: {
          donor: donor,
          recipient: recipient,
          erc20TokenAddress: erc20TokenAddress,
          netDonation: netDonation.toBigInt(),
          commission: commission.toBigInt(),
          donorName,
          message,
        },
      });

      // notify streamer of incoming alert
      await notifyStreamer(
        erc20TokenAddress,
        recipient,
        donorName,
        message,
        netDonation.add(commission)
      );
    }

    // store latest block to db
    await insertLatestBlockNumber(db, toBlockNumber);
  }
}

async function notifyStreamer(
  erc20TokenAddress: string,
  streamerAddress: string,
  donorName: string,
  message: string,
  amount: BigNumber
) {
  // /users/:userId/alerts
  const url = new URL(`users/${streamerAddress}/alerts`, notificationBaseUrl);

  const erc20Detail = erc20TokenDetailMapping.get(
    normalizeL1ContractAddress(erc20TokenAddress)
  )!;
  if(erc20Detail === undefined) {
    // Do nothing if not tracking it.
    return;  
  }

  const divisor = BigNumber.from(10).pow(erc20Detail.decimal);
  const normalizedAmount = amount.div(divisor);

  const data = {
    senderName: donorName,
    message,
    tipAmount: `${erc20Detail.symbol}${normalizedAmount}`,
  };

  const customHeaders = {
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method: "POST",
    headers: customHeaders,
    body: JSON.stringify(data),
  });
}

(async () => {
  console.log("Start indexing");
  const prisma = new PrismaClient();
  await main(prisma);
})();

async function getLatestBlockNumber(db: PrismaClient) {
  const latestBlockNumber = await db.latestBlockNumber.findFirst({
    orderBy: {
      blockNumber: "desc",
    },
  });

  return latestBlockNumber;
}

async function insertLatestBlockNumber(
  db: PrismaClient,
  latestBlockNumber: number
) {
  await db.latestBlockNumber.create({
    data: {
      blockNumber: latestBlockNumber,
    },
  });
}
