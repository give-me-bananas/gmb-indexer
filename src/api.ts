import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { normalizeL1ContractAddress } from "./utils";
import {
  AddressMappingRequestModel,
  DonationHistoryResponse,
  Erc20TokenDetail,
} from "./types";
import { BigNumber } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const supportedErc20TokenAddress =
  process.env.SUPPORTED_ERC20_TOKEN_ADDRESS!.split(",");
const supportedErc20TokenSymbol =
  process.env.SUPPORTED_ERC20_TOKEN_SYMBOL!.split(",");
const supportedErc20TokenDecimal =
  process.env.SUPPORTED_ERC20_TOKEN_DECIMAL!.split(",");

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

type DonationHistory = {
  id: number;
  donor: string;
  recipient: string;
  erc20TokenAddress: string;
  netDonation: bigint;
  commission: bigint;
  donorName: string;
  message: string;
};

const main = () => {
  const app = express();
  const db = new PrismaClient();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/donations", async (request, response) => {
    const queries = request.query;

    let streamer: string | null = null;
    if (queries["streamer"]) {
      streamer = queries["streamer"] as string;
    }

    const donationsDb = await getDonationsByStreamer(db, streamer);
    const donationHistories = donationMapping(donationsDb);

    return response.status(200).json(donationHistories);
  });

  app.post("/address-mapping", async (request, response) => {
    const model: AddressMappingRequestModel = request.body;

    const matches = await db.addressMapping.findFirst({
      where: {
        address: model.address,
      },
    })

    if(matches) {
      return response.status(200).json({ status: "Already Exists" });
    }

    await insertAddressMapping(db, model);

    return response.status(200).json({ status: "Success" });
  });

  app.get("/smart-account/:address", async (request, response) => {
    const address = request.params.address;
    const smartAccountAddress = await getSmartAccountAddressByAddress(
      db,
      address
    );

    if (!smartAccountAddress) {
      return response.status(201).json();
    }

    return response
      .status(200)
      .json({ smartAccountAddress: smartAccountAddress });
  });

  app.listen(3001, () => {
    console.log("Server started on port 3001");
  });
};

main();

async function getDonationsByStreamer(
  db: PrismaClient,
  streamer: string | null
): Promise<DonationHistory[]> {
  const donations = db.donationHistory.findMany({
    where: streamer
      ? {
          recipient: streamer,
        }
      : undefined,
  });

  return donations;
}

function donationMapping(donationHistories: DonationHistory[]) {
  const response = donationHistories.map((d) => {
    const erc20Detail = erc20TokenDetailMapping.get(
      normalizeL1ContractAddress(d.erc20TokenAddress)
    );

    const divisor = erc20Detail
      ? BigNumber.from(10).pow(erc20Detail.decimal)
      : BigNumber.from(1);

    const netDonation = BigNumber.from(d.netDonation).div(divisor);
    const commission = BigNumber.from(d.commission).div(divisor);

    const symbol = erc20Detail ? erc20Detail.symbol : "";

    return {
      streamer: d.recipient,
      donor: d.donor,
      donorName: d.donorName,
      erc20TokenAddress: d.erc20TokenAddress,
      message: d.message,
      netDonation: `${symbol}${netDonation.toString()}`,
      commission: `${symbol}${commission.toString()}`,
    } as DonationHistoryResponse;
  });

  return response;
}

async function getSmartAccountAddressByAddress(
  db: PrismaClient,
  address: string
) {
  const res = await db.addressMapping.findFirst({
    where: {
      address: address,
    },
  });

  return res ? res.smartAddress : null;
}

async function insertAddressMapping(
  db: PrismaClient,
  addressMappingRequest: AddressMappingRequestModel
) {
  await db.addressMapping.create({
    data: {
      smartAddress: addressMappingRequest.smartAccountAddress,
      address: addressMappingRequest.address,
    },
  });
}
