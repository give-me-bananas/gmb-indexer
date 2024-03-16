import { BigNumber, utils } from "ethers";

export function normalizeL1ContractAddress(address: string) {
  return utils.hexZeroPad(
    BigNumber.from(address).toHexString().toLowerCase(),
    20
  );
}
