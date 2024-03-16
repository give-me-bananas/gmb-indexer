export type DonationHistoryResponse = {
  streamer: string;
  donor: string;
  donorName: string | null;
  message: string | null;
  netDonation: string;
  commission: string;
};

export type Erc20TokenDetail = {
  symbol: string;
  decimal: number;
};

export type AddressMappingRequestModel = {
  address: string;
  smartAccountAddress: string;
};
