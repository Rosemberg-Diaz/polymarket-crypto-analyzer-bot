import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function analyze(data: any[]) {
  const wins = data.filter(s => s.isWin).length;
  const losses = data.filter(s => !s.isWin).length;
  const total = wins + losses;
  const wr = total > 0 ? ((wins / total) * 100).toFixed(1) : 'N/A';
  const profit = data.reduce((sum: number, s: any) => sum + Number(s.profit || 0), 0);
  return { total, wins, losses, wr, profit };
}

(async () => {
  const segments: [string, string, number, number][] = [
    ['BTC', 'DOWN', 180, 0.85],
    ['BTC', 'UP', 120, 0.85],
    ['ETH', 'DOWN', 120, 0.90],
    ['ETH', 'DOWN', 180, 0.85],
    ['ETH', 'UP', 60, 0.85],
    ['SOL', 'UP', 120, 0.85],
    ['SOL', 'UP', 180, 0.85],
    ['XRP', 'DOWN', 120, 0.85],
  ];

  for (const [asset, outcome, cp, currentThreshold] of segments) {
    const shadows = await prisma.mlOutcomeShadowExecution.findMany({
      where: {
        timeframe: '15m',
        assetSymbol: asset,
        predictedOutcome: outcome,
        checkpointSeconds: cp,
        status: { notIn: ['SKIPPED_SLIPPAGE', 'SKIPPED_NON_POSITIVE_EV', 'SKIPPED', 'PENDING'] },
      },
      select: { modelProbability: true, isWin: true, profit: true }
    });

    console.log(`\n=== ${asset}:15m:${outcome} cp=${cp}s (current: ${currentThreshold}) ===`);
    console.log(`Total trades: ${shadows.length}`);

    const thresholds = [0.75, 0.80, 0.85, 0.87, 0.90, 0.92, 0.95];
    
    console.log('Threshold | Trades | WR    | Profit | vs Current');
    console.log('-----------|--------|-------|--------|----------');
    
    let bestProfit = -Infinity;
    let bestThreshold = 0;
    let currentProfit = 0;
    
    for (const threshold of thresholds) {
      const filtered = shadows.filter(s => Number(s.modelProbability) >= threshold);
      if (filtered.length === 0) continue;
      const r = analyze(filtered);
      
      if (threshold === currentThreshold) currentProfit = r.profit;
      if (r.profit > bestProfit) { bestProfit = r.profit; bestThreshold = threshold; }
      
      const marker = threshold === currentThreshold ? ' ← CURRENT' : '';
      console.log(`${threshold.toFixed(2).padEnd(9)} | ${String(r.total).padEnd(6)} | ${r.wr.padStart(5)}% | $${r.profit.toFixed(2).padStart(8)} | ${marker}`);
    }
    
    const diff = currentProfit - bestProfit;
    const verdict = bestThreshold === currentThreshold ? '✅ OPTIMAL' : diff > 0 ? `✅ CURRENT IS BETTER (+$${diff.toFixed(2)})` : `⚠️ CHANGE TO ${bestThreshold} (+$${(-diff).toFixed(2)})`;
    console.log(`Best: ${bestThreshold} | Verdict: ${verdict}`);
  }

  // Check real orders for ETH:15m:DOWN:120
  console.log('\n\n=== REAL ORDERS: ETH:15m:DOWN cp=120s ===');
  const liveTrades = await prisma.liveOutcomeCheckpointTrade.findMany({
    where: {
      assetSymbol: 'ETH',
      predictedOutcome: 'DOWN',
      checkpointSeconds: 120,
    },
    include: {
      shadowExecution: {
        select: { modelProbability: true, slippage: true }
      }
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total real orders: ${liveTrades.length}\n`);
  
  for (const t of liveTrades) {
    const ts = t.createdAt.toISOString().substring(0, 16);
    const prob = t.shadowExecution?.modelProbability;
    const result = t.status === 'RESOLVED' ? (t.isWin ? 'WIN' : 'LOSS') : t.status;
    const p = Number(t.actualProfit || t.profit || 0);
    console.log(`${ts} ${result.padEnd(8)} $${p.toFixed(2).padStart(6)} prob=${prob} price=${t.averagePrice}`);
  }

  await prisma.$disconnect();
})();
