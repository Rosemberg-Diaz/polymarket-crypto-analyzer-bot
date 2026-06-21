import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const today = new Date('2026-06-19T00:00:00.000Z');

  const shadows = await prisma.mlOutcomeShadowExecution.findMany({
    where: { createdAt: { gte: today } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`=== SHADOW EXECUTIONS TODAY: ${shadows.length} ===`);
  
  const summary: Record<string, { total: number; wins: number; losses: number; skippedSlippage: number; skippedEv: number; skippedOther: number; pending: number; totalProfit: number; totalCost: number; byCheckpoint: Record<number, { total: number; wins: number; losses: number; profit: number; cost: number }> }> = {};
  
  for (const s of shadows) {
    const key = `${s.assetSymbol}:${s.timeframe}`;
    if (!summary[key]) summary[key] = { total: 0, wins: 0, losses: 0, skippedSlippage: 0, skippedEv: 0, skippedOther: 0, pending: 0, totalProfit: 0, totalCost: 0, byCheckpoint: {} };
    const sum = summary[key];
    sum.total++;
    
    const cpKey = s.checkpointSeconds;
    if (!sum.byCheckpoint[cpKey]) sum.byCheckpoint[cpKey] = { total: 0, wins: 0, losses: 0, profit: 0, cost: 0 };
    const cpSum = sum.byCheckpoint[cpKey];
    cpSum.total++;
    
    if (s.status.includes('SKIPPED_SLIPPAGE')) { sum.skippedSlippage++; continue; }
    if (s.status.includes('SKIPPED_NON_POSITIVE_EV') || s.status.includes('NON_POSITIVE_EV')) { sum.skippedEv++; continue; }
    if (s.status.includes('SKIPPED')) { sum.skippedOther++; continue; }
    if (s.status === 'PENDING') { sum.pending++; continue; }
    
    // RESOLVED
    const isWin = s.isWin === true;
    const profit = Number(s.profit || 0);
    const cost = Number(s.totalCost || 0);
    if (isWin) sum.wins++; else sum.losses++;
    sum.totalProfit += profit;
    sum.totalCost += cost;
    if (isWin) cpSum.wins++; else cpSum.losses++;
    cpSum.profit += profit;
    cpSum.cost += cost;
  }
  
  for (const [key, sum] of Object.entries(summary)) {
    const resolved = sum.wins + sum.losses;
    const wr = resolved > 0 ? ((sum.wins / resolved) * 100).toFixed(1) : 'N/A';
    console.log(`\n${key}: total=${sum.total} wins=${sum.wins} losses=${sum.losses} skipped(slippage=${sum.skippedSlippage},ev=${sum.skippedEv},other=${sum.skippedOther}) pending=${sum.pending} profit=$${sum.totalProfit.toFixed(2)} cost=$${sum.totalCost.toFixed(2)} WR=${wr}%`);
    for (const [cp, cpSum] of Object.entries(sum.byCheckpoint)) {
      const cpWr = (cpSum.wins + cpSum.losses) > 0 ? ((cpSum.wins / (cpSum.wins + cpSum.losses)) * 100).toFixed(1) : 'N/A';
      console.log(`  cp=${cp}s: total=${cpSum.total} wins=${cpSum.wins} losses=${cpSum.losses} profit=$${cpSum.profit.toFixed(2)} WR=${cpWr}%`);
    }
  }
  
  console.log(`\n=== LIVE ORDERS TODAY ===`);
  const liveTrades = await prisma.liveOutcomeCheckpointTrade.findMany({
    where: { createdAt: { gte: today } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Total live trades: ${liveTrades.length}`);
  for (const t of liveTrades) {
    const ts = t.createdAt.toISOString().substring(11, 19);
    console.log(`${ts} ${t.assetSymbol.padEnd(4)} ${t.timeframe.padEnd(4)} ${t.predictedOutcome.padEnd(4)} cp=${t.checkpointSeconds}s status=${t.status} budget=$${t.budget} filled=${t.filledShares || 0} winner=${t.officialWinner || 'pending'}`);
  }

  console.log(`\n=== HTF OBSERVATIONS ===`);
  const htfPredictions = await prisma.botPrediction.findMany({
    where: { createdAt: { gte: today }, strategyName: { contains: 'HIGHER_TIMEFRAME' } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, assetSymbol: true, strategyName: true, predictedOutcome: true,
      mlProbabilityUp: true, entryPrice: true, createdAt: true,
    }
  });
  console.log(`Total HTF predictions: ${htfPredictions.length}`);
  
  console.log(`\n=== TODAY DAILY P&L ===`);
  const wallet = await prisma.walletDailyPnl.findFirst({
    where: { dayKey: '2026-06-19' },
  });
  if (wallet) {
    console.log(`Opening cash: $${wallet.openingCashUsd}`);
    console.log(`Closing cash: $${wallet.closingCashUsd}`);
    console.log(`Equity change: $${wallet.equityChange}`);
    console.log(`Buy: $${wallet.buyUsdc} Sell: $${wallet.sellUsdc} Redeem: $${wallet.redeemUsdc}`);
    console.log(`Realized PnL: $${wallet.realizedTradingPnl}`);
  } else {
    console.log('No wallet daily PnL for today');
  }

  await prisma.$disconnect();
})();
