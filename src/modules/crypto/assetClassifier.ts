import {
  CryptoAsset,
  CryptoMarketType,
  SUPPORTED_CRYPTO_ASSETS
} from "../../config/assets";
import { inferAssetSymbol, inferCryptoMarketType } from "./crypto-market.utils";

export function classifyCryptoAsset(title: string): CryptoAsset {
  return inferAssetSymbol(title);
}

export function classifyCryptoMarketType(title: string): CryptoMarketType {
  return inferCryptoMarketType(title);
}

export function isSupportedCryptoAsset(asset: string): asset is CryptoAsset {
  return SUPPORTED_CRYPTO_ASSETS.includes(asset as CryptoAsset);
}
