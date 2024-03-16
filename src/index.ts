import dotenv from "dotenv";
import * as BananaController from "./BananaController.json";
import { BigNumber, Contract, ethers } from "ethers";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const rpcUrl = process.env.RPC_URL!;
const bananaControllerAddress = process.env.BANANA_CONTROLLER_ADDRESS!;
const notificationBaseUrl = process.env.NOTIFICATION_BASE_URL!;
const supportedErc20TokenAddress =
  process.env.SUPPORTED_ERC20_TOKEN_ADDRESS!.split(",");
const sqliteFilePath = process.env.SQLITE_DB_FILE_PATH!;

const abi = BananaController.abi;

async function createTables(db: Database) {
  console.log("Creating tables if it does not exist");

  await db.exec(`CREATE TABLE IF NOT EXISTS donation_histories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donor text,
    recipient text,
    netDonation NUMERIC,
    commission NUMERIC);
  `);
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

  const eventFilter = bananaControllerContract.filters.Donate();

  // not practical in a production grade code
  // calling api and await will potentially slow down or causes block indexing to be missed
  provider.on(
    eventFilter,
    async (
      donor: string,
      recipient: string,
      erc20TokenAddress: string,
      netDonation: BigNumber,
      commission: BigNumber,
      event
    ) => {
      console.log(`donor : ${donor}`);
      console.log(`recipient : ${recipient}`);
      console.log(`erc20TokenAddress : ${erc20TokenAddress}`);

      // store to donation to db
      const donationHistory = await db.donationHistory.create({
        data: {
          donor: donor,
          recipient: recipient,
          erc20TokenAddress: erc20TokenAddress,
          netDonation: netDonation.toBigInt(),
          commission: commission.toBigInt(),
        },
      });

      // notify streamer of incoming alert
      await notifyStreamer();
    }
  );
}

async function notifyStreamer() {}

(async () => {
  //   const db = await open({
  //     filename: sqliteFilePath,
  //     driver: sqlite3.Database,
  //   });

  //   await createTables(db);

  const prisma = new PrismaClient();
  await main(prisma);
  console.log("Start indexing");
})();
