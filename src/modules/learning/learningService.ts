import { config } from "../../config/env";

export class LearningService {
  isEnabled(): boolean {
    return config.mlEnabled;
  }

  getMinimumResolvedTrades(): number {
    return config.mlMinResolvedTrades;
  }
}
