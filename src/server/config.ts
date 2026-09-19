import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TRUST_PROXY: z.string().default('false').transform(v => v === 'true'),
  DATABASE_PATH: z.string().default('./data/trading.db'),
  ADMIN_PASSWORD: z.string().min(10).default('change-this-long-password'),
  SESSION_SECRET: z.string().min(24).default('dev-session-secret-change-me-please'),
  BINANCE_API_KEY: z.string().optional().default(''),
  BINANCE_API_SECRET: z.string().optional().default(''),
  BINANCE_BASE_URL: z.string().url().default('https://fapi.binance.com'),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_CHAT_ID: z.string().optional().default(''),
  ALLOW_LIVE_TRADING: z.string().default('false').transform(v => v === 'true'),
  DRY_RUN: z.string().default('true').transform(v => v !== 'false'),
  POSITION_POLL_MS: z.coerce.number().int().min(1000).default(3000),
  SCAN_INTERVAL_MS: z.coerce.number().int().min(15000).default(60000),
  RISK_DAY_UTC_OFFSET_MINUTES: z.coerce.number().int().min(-720).max(840).default(180)
});

export const config = envSchema.parse(process.env);

export const hasBinanceCredentials = Boolean(config.BINANCE_API_KEY && config.BINANCE_API_SECRET);
export const liveTradingEnabled = hasBinanceCredentials && config.ALLOW_LIVE_TRADING && !config.DRY_RUN;
