import { randomUUID } from 'node:crypto';
import { binance } from './binance/client.js';
import { audit, expireSignals, getRiskSettings, listSignals, saveSignal } from './db.js';
import type { Side, Signal } from './types.js';

function n(v: unknown): number { return Number(v ?? 0); }
function avg(xs: number[]): number { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0; }
function atr(klines: any[][], period=14): number {
  const trs:number[] = [];
  for (let i=1;i<klines.length;i++) {
    const high=n(klines[i][2]), low=n(klines[i][3]), prevClose=n(klines[i-1][4]);
    trs.push(Math.max(high-low, Math.abs(high-prevClose), Math.abs(low-prevClose)));
  }
  return avg(trs.slice(-period));
}

async function mapLimit<T,R>(items:T[], limit:number, fn:(item:T)=>Promise<R>):Promise<R[]> {
  const out:R[]=[]; let cursor=0;
  const workers = Array.from({length:Math.min(limit,items.length)}, async()=>{
    while (cursor < items.length) { const i=cursor++; out[i]=await fn(items[i]); }
  });
  await Promise.all(workers); return out;
}

interface Candidate { symbol:string; quoteVolume:number; change:number; last:number; }

export async function scanMarket(): Promise<Signal[]> {
  const settings = getRiskSettings();
  expireSignals();
  if (settings.mode === 'OFF' || settings.mode === 'MANAGE_ONLY') return [];
  const tickers = await binance.tickers24h();
  const candidates:Candidate[] = tickers
    .filter(t => typeof t.symbol === 'string' && t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
    .map(t => ({ symbol:t.symbol, quoteVolume:n(t.quoteVolume), change:n(t.priceChangePercent), last:n(t.lastPrice) }))
    .filter(t => t.quoteVolume >= settings.minQuoteVolume24h && Math.abs(t.change) <= 20 && t.last > 0)
    .sort((a,b)=>b.quoteVolume-a.quoteVolume)
    .slice(0,35);

  const existing = listSignals(100).filter(s => s.status === 'PENDING');
  const found = (await mapLimit(candidates, 5, async c => {
    try { return await evaluate(c); }
    catch (error) { audit('WARN','SCAN_SYMBOL_FAILED',{message:(error as Error).message},c.symbol); return undefined; }
  })).filter(Boolean) as Signal[];

  const deduped = found.filter(s => !existing.some(e => e.symbol===s.symbol && e.side===s.side && Date.now()-e.createdAt < 20*60_000));
  for (const s of deduped) { saveSignal(s); audit('INFO','SIGNAL_CREATED',s,s.symbol); }
  return deduped;
}

async function evaluate(c:Candidate): Promise<Signal|undefined> {
  const [k5,k15,taker] = await Promise.all([
    binance.klines(c.symbol,'5m',32),
    binance.klines(c.symbol,'15m',24),
    binance.takerVolume(c.symbol,'5m',8)
  ]);
  if (k5.length < 25 || k15.length < 12 || taker.length < 3) return;

  // Use only completed candles: the newest item may still be open.
  const closed = k5.slice(0,-1);
  const last = closed.at(-1)!;
  const previous = closed.slice(-21,-1);
  const close=n(last[4]), high=n(last[2]), low=n(last[3]), volume=n(last[5]);
  const prevHigh=Math.max(...previous.map(k=>n(k[2]))), prevLow=Math.min(...previous.map(k=>n(k[3])));
  const prevVolumes=previous.slice(-12).map(k=>n(k[5]));
  const volumeRatio=avg(prevVolumes)>0 ? volume/avg(prevVolumes) : 0;
  const latestTaker=taker.at(-2) ?? taker.at(-1);
  const buySellRatio=n(latestTaker?.buySellRatio || (n(latestTaker?.buyVol)/Math.max(n(latestTaker?.sellVol),1)));
  const a=atr(closed,14);
  if (!(a>0)) return;

  const c15 = k15.slice(0,-1).slice(-8).map(k=>n(k[4]));
  const trend15 = c15.at(-1)! - c15[0];
  const longBreak = close > prevHigh && volumeRatio >= 1.7 && buySellRatio >= 1.25 && trend15 > 0;
  const shortBreak = close < prevLow && volumeRatio >= 1.7 && buySellRatio <= 0.80 && trend15 < 0;
  if (!longBreak && !shortBreak) return;

  const side:Side = longBreak ? 'LONG' : 'SHORT';
  const breakout = longBreak ? prevHigh : prevLow;
  const extension = Math.abs(close-breakout)/a;
  if (extension > 0.85) return; // avoid chasing

  const stop = side==='LONG' ? Math.min(low, close-1.35*a) : Math.max(high, close+1.35*a);
  const risk=Math.abs(close-stop);
  const tp1=side==='LONG'?close+risk:close-risk;
  const tp2=side==='LONG'?close+2*risk:close-2*risk;
  const tp3=side==='LONG'?close+3*risk:close-3*risk;
  const score = Math.min(99, Math.round(65 + Math.min(15,(volumeRatio-1.7)*10) + Math.min(10,Math.abs(trend15)/close*600) + Math.min(9,Math.abs(buySellRatio-1)*8)));
  if (score < 75) return;
  const leverage = Math.min(5, getRiskSettings().maxAutoLeverage);
  const reason = `${side==='LONG'?'اختراق':'كسر'} 5m مؤكد، حجم ${volumeRatio.toFixed(1)}x، Taker ${buySellRatio.toFixed(2)}، اتجاه 15m داعم`;
  return { id:randomUUID(),symbol:c.symbol,side,status:'PENDING',score,entry:close,stop,tp1,tp2,tp3,leverage,reason,createdAt:Date.now(),expiresAt:Date.now()+15*60_000 };
}
