# Polymarket Crypto Analyzer Bot

Bot local, gratuito y modular para analizar y simular mercados crypto de Polymarket.

El modo inicial obligatorio es:

```env
APP_MODE=SIMULATION_ONLY
ENABLE_REAL_TRADING=false
```

Este proyecto no incluye wallet, claves privadas, ejecucion de ordenes reales ni trading con dinero real. La arquitectura esta limitada a mercados crypto y no incluye deportes, politica ni elecciones.

## Activos soportados

- BTC
- ETH
- SOL
- XRP
- DOGE
- AVAX
- BNB
- OTHER

## Tipos de mercado crypto

- UP_DOWN_SHORT_TERM
- PRICE_TARGET
- ABOVE_BELOW
- RANGE_MARKET
- CRYPTO_OTHER

## Stack

- Node.js
- TypeScript
- Prisma ORM
- SQLite
- dotenv
- PM2

## Instalacion

```bash
npm install
```

```bash
npm run prisma:migrate
```

## Desarrollo

```bash
npm run dev
```

## Produccion local

```bash
npm run build
npm run start
```

## PM2

```bash
npm run build
npm run pm2:start
npm run pm2:logs
npm run pm2:stop
```

## Reporte local

```bash
npm run report
```

## Scripts disponibles

- `npm run dev`: inicia el bot con `tsx watch`.
- `npm run build`: compila TypeScript en `dist/`.
- `npm run start`: ejecuta `dist/main.js`.
- `npm run prisma:migrate`: crea/aplica migraciones Prisma.
- `npm run prisma:studio`: abre Prisma Studio.
- `npm run pm2:start`: inicia el proceso con PM2.
- `npm run pm2:stop`: detiene el proceso PM2.
- `npm run pm2:logs`: muestra logs PM2.
- `npm run report`: imprime un reporte local basico.

## Estructura

```text
src/
  config/
  database/
  modules/
    polymarket/
    crypto/
    market-data/
    signals/
      strategies/
    simulations/
    learning/
    risk/
    reports/
    backup/
    logger/
    jobs/
  utils/
  main.ts

prisma/
  schema.prisma
```

## Variables iniciales

El archivo `.env.example` contiene la configuracion inicial recomendada:

```env
DATABASE_URL="file:./dev.db"
APP_MODE=SIMULATION_ONLY
ENABLE_REAL_TRADING=false
SCAN_INTERVAL_SECONDS=10
SIMULATED_STAKE_USD=5
MAX_SPREAD=0.05
MIN_LIQUIDITY=100
MARKET_CATEGORY=CRYPTO
PRIORITY_ASSETS=BTC,ETH,SOL
PRIORITIZE_SHORT_TERM_UP_DOWN=true
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=24
LOG_LEVEL=info
ML_ENABLED=false
ML_MIN_RESOLVED_TRADES=1000
```

## Prioridad inicial

El bot prioriza mercados crypto de corto plazo tipo BTC Up/Down, pero la arquitectura permite extender el analisis a ETH, SOL, XRP, DOGE, AVAX, BNB y otros mercados crypto.
