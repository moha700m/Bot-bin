export type TradingMode = 'OFF' | 'MANAGE_ONLY' | 'APPROVAL' | 'FULL_AUTO';
export type Side = 'LONG' | 'SHORT';

export interface RiskSettings {
  mode: TradingMode;
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  maxAutoLeverage: number;
  maxNotionalPctOfEquity: number;
  tp1ClosePct: number;
  tp2ClosePct: number;
  minQuoteVolume24h: number;
}

export interface Signal {
  id: string;
  symbol: string;
  side: Side;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'EXPIRED' | 'FAILED';
  score: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  leverage: number;
  reason: string;
  createdAt: number;
  expiresAt: number;
}

export interface PositionPlan {
  id: string;
  symbol: string;
  side: Side;
  entry: number;
  initialQty: number;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp1Done: boolean;
  tp2Done: boolean;
  status: 'ACTIVE' | 'CLOSED' | 'ERROR';
  stopAlgoId?: string;
  finalTpAlgoId?: string;
  source: 'AUTO' | 'APPROVED_SIGNAL' | 'MANUAL' | 'EXTERNAL';
  updatedAt: number;
}

export interface BinancePosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  breakEvenPrice?: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  positionSide: 'BOTH' | 'LONG' | 'SHORT';
  notional?: string;
  updateTime?: number;
}
