import { Logger } from "../logger/logger";
import { MarketDataService } from "../market-data/marketDataService";
import { RiskService } from "../risk/riskService";
import { SignalService } from "../signals/signalService";
import { SimulationService } from "../simulations/simulationService";

export class ScannerJob {
  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly signalService: SignalService,
    private readonly riskService: RiskService,
    private readonly simulationService: SimulationService,
    private readonly logger: Logger
  ) {}

  async runOnce(): Promise<void> {
    const markets = await this.marketDataService.getEligibleCryptoMarkets();
    const signals = this.signalService.generateSignals(markets);
    const approvedSignals = signals.filter((signal) => this.riskService.approveSimulation(signal));
    const decisions = approvedSignals.map((signal) => this.simulationService.createDecision(signal));

    this.logger.info("Scan completed", {
      eligibleMarkets: markets.length,
      signals: signals.length,
      simulatedDecisions: decisions.length
    });
  }
}
