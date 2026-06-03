import { CryptoAsset, CryptoMarketType } from "../../config/assets";

export interface CryptoMarketCandidate {
  externalId: string;
  title: string;
  asset: CryptoAsset;
  marketType: CryptoMarketType;
  liquidityUsd: number;
  spread: number;
  yesPrice?: number;
  noPrice?: number;
  closesAt?: Date;
}
