import Decimal from 'decimal.js';

export interface SymbolRules {
  symbol: string;
  tickSize: string;
  stepSize: string;
  minQty: string;
  minNotional: string;
}

export function floorToStep(value: number | string, step: number | string): string {
  const v = new Decimal(value);
  const s = new Decimal(step);
  if (s.lte(0)) return v.toString();
  return v.div(s).floor().mul(s).toFixed(decimalPlaces(step));
}

export function roundToTick(value: number | string, tick: number | string): string {
  const v = new Decimal(value);
  const t = new Decimal(tick);
  if (t.lte(0)) return v.toString();
  return v.div(t).toNearest(1).mul(t).toFixed(decimalPlaces(tick));
}

function decimalPlaces(value: number | string): number {
  const s = String(value).toLowerCase();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const dot = s.indexOf('.');
  if (dot === -1) return 0;
  return s.length - dot - 1;
}
