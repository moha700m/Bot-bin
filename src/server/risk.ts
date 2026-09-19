import { Decimal } from 'decimal.js';
import { binance } from './binance/client.js';
import { floorToStep } from './binance/filters.js';
import { getRiskSettings } from './db.js';
import { config } from './config.js';
import type { BinancePosition, Side } from './types.js';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  quantity?: string;
  equity?: number;
  dailyPnl?: number;
  riskUsdt?: number;
  notional?: number;
}

export async function getEquity(): Promise<number> {
  const account = await binance.account();
  return Number(account.totalMarginBalance ?? account.totalWalletBalance ?? 0);
}

export async function getDailyRealizedPnl(): Promise<number> {
  const offsetMs = config.RISK_DAY_UTC_OFFSET_MINUTES * 60_000;
  const shifted = new Date(Date.now() + offsetMs);
  const localMidnightAsUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const start = localMidnightAsUtc - offsetMs;
  const income = await binance.income(start, 'REALIZED_PNL');
  return income.reduce((sum, x) => sum + Number(x.income ?? 0), 0);
}

export async function validateNewTrade(input: {
  symbol: string;
  side: Side;
  entry: number;
  stop: number;
  leverage: number;
  positions?: BinancePosition[];
}): Promise<RiskCheckResult> {
  const settings = getRiskSettings();
  if (settings.mode === 'OFF' || settings.mode === 'MANAGE_ONLY') return { allowed:false, reason:'وضع النظام لا يسمح بفتح صفقات جديدة' };
  if (!Number.isFinite(input.entry) || !Number.isFinite(input.stop) || input.entry <= 0 || input.stop <= 0) return { allowed:false, reason:'أسعار غير صالحة' };
  const correctStop = input.side === 'LONG' ? input.stop < input.entry : input.stop > input.entry;
  if (!correctStop) return { allowed:false, reason:'وقف الخسارة على الجهة الخاطئة من سعر الدخول' };
  if (input.leverage < 1 || input.leverage > settings.maxAutoLeverage) return { allowed:false, reason:`الرافعة تتجاوز الحد ${settings.maxAutoLeverage}x` };

  const positions = input.positions ?? await binance.positions();
  const open = positions.filter(p => Math.abs(Number(p.positionAmt)) > 0);
  if (open.length >= settings.maxOpenPositions) return { allowed:false, reason:'تم الوصول للحد الأقصى للصفقات المفتوحة' };
  if (open.some(p => p.symbol === input.symbol)) return { allowed:false, reason:'يوجد مركز مفتوح بالفعل على الرمز' };

  const equity = await getEquity();
  if (!(equity > 0)) return { allowed:false, reason:'تعذر تحديد رصيد الهامش' };
  const dailyPnl = await getDailyRealizedPnl();
  if (dailyPnl < 0 && Math.abs(dailyPnl) >= equity * settings.maxDailyLossPct / 100) {
    return { allowed:false, reason:'تم تفعيل حد الخسارة اليومية', equity, dailyPnl };
  }

  const distance = new Decimal(input.entry).minus(input.stop).abs();
  const riskUsdt = equity * settings.maxRiskPerTradePct / 100;
  let qty = new Decimal(riskUsdt).div(distance);
  const maxNotional = equity * settings.maxNotionalPctOfEquity / 100;
  const notional = qty.mul(input.entry);
  if (notional.gt(maxNotional)) qty = new Decimal(maxNotional).div(input.entry);

  const rules = await binance.symbolRules(input.symbol);
  const quantity = floorToStep(qty.toString(), rules.stepSize);
  const q = new Decimal(quantity || 0);
  const finalNotional = q.mul(input.entry);
  if (q.lte(0) || q.lt(rules.minQty)) return { allowed:false, reason:'الكمية الناتجة أقل من الحد الأدنى', equity, dailyPnl };
  if (finalNotional.lt(rules.minNotional)) return { allowed:false, reason:'القيمة الاسمية أقل من الحد الأدنى للمنصة', equity, dailyPnl };

  return { allowed:true, quantity, equity, dailyPnl, riskUsdt, notional:Number(finalNotional) };
}
