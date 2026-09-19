import { createHmac } from 'node:crypto';
import { config, hasBinanceCredentials } from '../config.js';
import type { BinancePosition } from '../types.js';
import type { SymbolRules } from './filters.js';

export class BinanceApiError extends Error {
  constructor(public status: number, public code: number | undefined, message: string, public payload?: unknown) {
    super(message);
    this.name = 'BinanceApiError';
  }
}

type Params = Record<string, string | number | boolean | undefined>;

export class BinanceClient {
  private readonly base = config.BINANCE_BASE_URL.replace(/\/$/, '');
  private readonly apiKey = config.BINANCE_API_KEY;
  private readonly secret = config.BINANCE_API_SECRET;
  private rulesCache = new Map<string, SymbolRules>();
  private rulesLoadedAt = 0;
  private clockOffsetMs = 0;

  isConnected(): boolean { return hasBinanceCredentials; }

  private encode(params: Params): string {
    const q = new URLSearchParams();
    for (const [k,v] of Object.entries(params)) if (v !== undefined) q.append(k, String(v));
    return q.toString();
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let data: any = text;
    try { data = text ? JSON.parse(text) : {}; } catch { /* text response */ }
    if (!res.ok) throw new BinanceApiError(res.status, data?.code, data?.msg || data?.message || `Binance HTTP ${res.status}`, data);
    return data as T;
  }

  async publicGet<T>(path: string, params: Params = {}): Promise<T> {
    const qs = this.encode(params);
    const res = await fetch(`${this.base}${path}${qs ? `?${qs}` : ''}`, { signal: AbortSignal.timeout(10_000) });
    return this.parse<T>(res);
  }

  async signed<T>(method: 'GET'|'POST'|'PUT'|'DELETE', path: string, params: Params = {}, retryClock=true): Promise<T> {
    if (!this.apiKey || !this.secret) throw new Error('Binance API credentials are not configured');
    const bodyParams: Params = { ...params, timestamp: Date.now()+this.clockOffsetMs, recvWindow: 5000 };
    const raw = this.encode(bodyParams);
    const sig = createHmac('sha256', this.secret).update(raw).digest('hex');
    const signed = `${raw}&signature=${sig}`;
    const headers = { 'X-MBX-APIKEY': this.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' };
    const url = `${this.base}${path}`;
    try {
      const res = method === 'GET' || method === 'DELETE'
        ? await fetch(`${url}?${signed}`, { method, headers, signal: AbortSignal.timeout(12_000) })
        : await fetch(url, { method, headers, body: signed, signal: AbortSignal.timeout(12_000) });
      return await this.parse<T>(res);
    } catch (error) {
      if(retryClock && error instanceof BinanceApiError && error.code===-1021){
        await this.syncClock();
        return this.signed<T>(method,path,params,false);
      }
      throw error;
    }
  }

  async syncClock():Promise<number> {
    const before=Date.now();
    const {serverTime}=await this.serverTime();
    const after=Date.now();
    const midpoint=Math.round((before+after)/2);
    this.clockOffsetMs=serverTime-midpoint;
    return this.clockOffsetMs;
  }

  ping(): Promise<unknown> { return this.publicGet('/fapi/v1/ping'); }
  serverTime(): Promise<{serverTime:number}> { return this.publicGet('/fapi/v1/time'); }
  markPrice(symbol: string): Promise<any> { return this.publicGet('/fapi/v1/premiumIndex', { symbol }); }
  tickers24h(): Promise<any[]> { return this.publicGet('/fapi/v1/ticker/24hr'); }
  klines(symbol: string, interval: '5m'|'15m'|'1h', limit: number): Promise<any[][]> { return this.publicGet('/fapi/v1/klines', { symbol, interval, limit }); }
  openInterest(symbol: string): Promise<{openInterest:string}> { return this.publicGet('/fapi/v1/openInterest', { symbol }); }
  takerVolume(symbol: string, period: '5m'|'15m'='5m', limit=12): Promise<any[]> { return this.publicGet('/futures/data/takerlongshortRatio', { symbol, period, limit }); }

  account(): Promise<any> { return this.signed('GET', '/fapi/v3/account'); }
  balance(): Promise<any[]> { return this.signed('GET', '/fapi/v3/balance'); }
  positions(): Promise<BinancePosition[]> { return this.signed('GET', '/fapi/v3/positionRisk'); }
  openOrders(symbol?: string): Promise<any[]> { return this.signed('GET', '/fapi/v1/openOrders', { symbol }); }
  openAlgoOrders(symbol?: string): Promise<any[]> { return this.signed('GET', '/fapi/v1/openAlgoOrders', { symbol }); }
  income(startTime: number, incomeType='REALIZED_PNL'): Promise<any[]> { return this.signed('GET', '/fapi/v1/income', { startTime, incomeType, limit: 1000 }); }
  getDualSide(): Promise<{dualSidePosition:boolean}> { return this.signed('GET', '/fapi/v1/positionSide/dual'); }

  changeLeverage(symbol: string, leverage: number): Promise<any> {
    return this.signed('POST', '/fapi/v1/leverage', { symbol, leverage });
  }

  marketOrder(symbol: string, side: 'BUY'|'SELL', quantity: string, reduceOnly=false): Promise<any> {
    return this.signed('POST', '/fapi/v1/order', {
      symbol, side, type: 'MARKET', quantity, reduceOnly, newOrderRespType: 'RESULT'
    });
  }

  limitOrder(symbol: string, side: 'BUY'|'SELL', quantity: string, price: string, reduceOnly=false): Promise<any> {
    return this.signed('POST', '/fapi/v1/order', {
      symbol, side, type: 'LIMIT', timeInForce: 'GTC', quantity, price, reduceOnly, newOrderRespType: 'RESULT'
    });
  }

  placeAlgo(params: {
    symbol:string; side:'BUY'|'SELL'; type:'STOP_MARKET'|'TAKE_PROFIT_MARKET'|'TRAILING_STOP_MARKET';
    triggerPrice?:string; quantity?:string; closePosition?:boolean; reduceOnly?:boolean;
    workingType?:'MARK_PRICE'|'CONTRACT_PRICE'; priceProtect?:boolean; activatePrice?:string; callbackRate?:number;
  }): Promise<any> {
    return this.signed('POST', '/fapi/v1/algoOrder', {
      algoType: 'CONDITIONAL',
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      triggerPrice: params.triggerPrice,
      quantity: params.quantity,
      closePosition: params.closePosition,
      reduceOnly: params.reduceOnly,
      workingType: params.workingType ?? 'MARK_PRICE',
      priceProtect: params.priceProtect ?? false,
      activatePrice: params.activatePrice,
      callbackRate: params.callbackRate
    });
  }

  cancelAlgo(algoId: string | number): Promise<any> {
    return this.signed('DELETE', '/fapi/v1/algoOrder', { algoId });
  }

  cancelAllOpenOrders(symbol: string): Promise<any> { return this.signed('DELETE', '/fapi/v1/allOpenOrders', { symbol }); }
  cancelAllAlgoOrders(symbol: string): Promise<any> { return this.signed('DELETE', '/fapi/v1/algoOpenOrders', { symbol }); }

  async symbolRules(symbol: string): Promise<SymbolRules> {
    if (Date.now() - this.rulesLoadedAt > 15 * 60_000 || !this.rulesCache.has(symbol)) await this.loadRules();
    const rules = this.rulesCache.get(symbol);
    if (!rules) throw new Error(`No exchange rules for ${symbol}`);
    return rules;
  }

  private async loadRules(): Promise<void> {
    const info = await this.publicGet<any>('/fapi/v1/exchangeInfo');
    const next = new Map<string, SymbolRules>();
    for (const s of info.symbols ?? []) {
      const price = s.filters?.find((f:any) => f.filterType === 'PRICE_FILTER');
      const lot = s.filters?.find((f:any) => f.filterType === 'MARKET_LOT_SIZE') ?? s.filters?.find((f:any) => f.filterType === 'LOT_SIZE');
      const minNotional = s.filters?.find((f:any) => f.filterType === 'MIN_NOTIONAL');
      if (price && lot) next.set(s.symbol, {
        symbol:s.symbol, tickSize:price.tickSize, stepSize:lot.stepSize, minQty:lot.minQty, minNotional:minNotional?.notional ?? '5'
      });
    }
    this.rulesCache = next;
    this.rulesLoadedAt = Date.now();
  }
}

export const binance = new BinanceClient();
