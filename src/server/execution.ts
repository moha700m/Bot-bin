import { randomUUID } from 'node:crypto';
import { binance } from './binance/client.js';
import { floorToStep, roundToTick } from './binance/filters.js';
import { audit, getPlan, savePlan, setSignalStatus } from './db.js';
import { config, liveTradingEnabled } from './config.js';
import { validateNewTrade } from './risk.js';
import type { BinancePosition, PositionPlan, Side, Signal } from './types.js';

export function executionState() {
  return { dryRun: config.DRY_RUN, allowLiveTrading: config.ALLOW_LIVE_TRADING, liveTradingEnabled };
}

function opposite(side:Side):'BUY'|'SELL' { return side==='LONG'?'SELL':'BUY'; }
function entryOrderSide(side:Side):'BUY'|'SELL' { return side==='LONG'?'BUY':'SELL'; }

async function ensureOneWayMode(): Promise<void> {
  const mode = await binance.getDualSide();
  if (mode.dualSidePosition) throw new Error('الإصدار الحالي يتطلب One-way Mode في Binance Futures. عطّل Hedge Mode قبل تفعيل التداول الآلي.');
}

export async function executeSignal(signal:Signal, source:'AUTO'|'APPROVED_SIGNAL'='APPROVED_SIGNAL'):Promise<{dryRun:boolean;plan?:PositionPlan;order?:any;risk:any}> {
  if (Date.now() > signal.expiresAt) { setSignalStatus(signal.id,'EXPIRED'); throw new Error('الإشارة انتهت صلاحيتها'); }
  if (!binance.isConnected()) throw new Error('مفاتيح Binance غير مضبوطة');
  await ensureOneWayMode();
  const positions=await binance.positions();
  const risk=await validateNewTrade({symbol:signal.symbol,side:signal.side,entry:signal.entry,stop:signal.stop,leverage:signal.leverage,positions});
  if (!risk.allowed || !risk.quantity) throw new Error(risk.reason || 'رفض محرك المخاطر الصفقة');

  if (!liveTradingEnabled) {
    audit('INFO','DRY_RUN_SIGNAL_EXECUTION',{signal,risk},signal.symbol);
    return {dryRun:true,risk};
  }

  await binance.changeLeverage(signal.symbol,signal.leverage);
  const order=await binance.marketOrder(signal.symbol,entryOrderSide(signal.side),risk.quantity,false);
  const fillPrice=Number(order.avgPrice || signal.entry);
  const plan:PositionPlan={id:randomUUID(),symbol:signal.symbol,side:signal.side,entry:fillPrice,initialQty:Number(risk.quantity),stop:signal.stop,tp1:signal.tp1,tp2:signal.tp2,tp3:signal.tp3,tp1Done:false,tp2Done:false,status:'ACTIVE',source,updatedAt:Date.now()};
  savePlan(plan);
  try {
    await installProtection(plan);
  } catch (error) {
    audit('ERROR','ENTRY_PROTECTION_FAILED',{message:(error as Error).message,orderId:order.orderId},signal.symbol);
    try { if(plan.stopAlgoId) await binance.cancelAlgo(plan.stopAlgoId); } catch { /* best effort */ }
    try { if(plan.finalTpAlgoId) await binance.cancelAlgo(plan.finalTpAlgoId); } catch { /* best effort */ }
    try { await closePosition(signal.symbol,1); }
    catch (closeError) { audit('ERROR','EMERGENCY_ENTRY_CLOSE_FAILED',{message:(closeError as Error).message},signal.symbol); }
    plan.status='ERROR'; plan.updatedAt=Date.now(); savePlan(plan);
    throw new Error(`تم فتح المركز لكن تعذر تثبيت الحماية؛ حاول النظام إغلاقه فورًا: ${(error as Error).message}`);
  }
  setSignalStatus(signal.id,'EXECUTED');
  audit('INFO','SIGNAL_EXECUTED',{order,plan},signal.symbol);
  return {dryRun:false,plan:getPlan(signal.symbol),order,risk};
}

export async function manualEntry(input:{symbol:string;side:Side;leverage:number;stop:number;tp1:number;tp2:number;tp3:number}):Promise<any> {
  const symbol=input.symbol.toUpperCase();
  const mark=await binance.markPrice(symbol);
  const entry=Number(mark.markPrice || mark.indexPrice);
  const signal:Signal={id:randomUUID(),symbol,side:input.side,status:'APPROVED',score:100,entry,stop:input.stop,tp1:input.tp1,tp2:input.tp2,tp3:input.tp3,leverage:input.leverage,reason:'Manual dashboard entry',createdAt:Date.now(),expiresAt:Date.now()+5*60_000};
  return executeSignal(signal,'APPROVED_SIGNAL');
}

export async function closePosition(symbol:string, fraction=1):Promise<any> {
  if (!binance.isConnected()) throw new Error('مفاتيح Binance غير مضبوطة');
  const pos=(await binance.positions()).find(p=>p.symbol===symbol && Math.abs(Number(p.positionAmt))>0);
  if (!pos) throw new Error('لا يوجد مركز مفتوح');
  const qtyAbs=Math.abs(Number(pos.positionAmt))*Math.max(0.01,Math.min(1,fraction));
  const rules=await binance.symbolRules(symbol);
  const quantity=floorToStep(qtyAbs,rules.stepSize);
  const side:NumberSide = Number(pos.positionAmt)>0?'SELL':'BUY';
  if (!liveTradingEnabled) { audit('INFO','DRY_RUN_CLOSE',{symbol,fraction,quantity}); return {dryRun:true,quantity}; }
  const order=await binance.marketOrder(symbol,side,quantity,true);
  audit('INFO','POSITION_REDUCED',{fraction,order},symbol);
  return {dryRun:false,order};
}
type NumberSide='BUY'|'SELL';

export async function protectExisting(input:{symbol:string;stop:number;tp1:number;tp2:number;tp3:number}):Promise<PositionPlan> {
  const symbol=input.symbol.toUpperCase();
  const pos=(await binance.positions()).find(p=>p.symbol===symbol && Math.abs(Number(p.positionAmt))>0);
  if (!pos) throw new Error('لا يوجد مركز مفتوح');
  if (pos.positionSide !== 'BOTH') throw new Error('إدارة المراكز الخارجية تدعم One-way Mode فقط حاليًا');
  const side:Side=Number(pos.positionAmt)>0?'LONG':'SHORT';
  const entry=Number(pos.entryPrice);
  const mark=Number(pos.markPrice);
  const valid=side==='LONG'
    ? input.stop<mark && input.tp1>mark && input.tp2>=input.tp1 && input.tp3>=input.tp2
    : input.stop>mark && input.tp1<mark && input.tp2<=input.tp1 && input.tp3<=input.tp2;
  if (!valid) throw new Error('الوقف يجب أن يكون خلف السعر الحالي والأهداف أمامه وبترتيب صحيح');
  const previous=getPlan(symbol);
  const plan:PositionPlan={id:previous?.id??randomUUID(),symbol,side,entry,initialQty:Math.abs(Number(pos.positionAmt)),stop:input.stop,tp1:input.tp1,tp2:input.tp2,tp3:input.tp3,tp1Done:false,tp2Done:false,status:'ACTIVE',source:'EXTERNAL',updatedAt:Date.now()};
  try {
    await installProtection(plan);
    savePlan(plan);
  } catch (error) {
    if(liveTradingEnabled){
      try { if(plan.stopAlgoId) await binance.cancelAlgo(plan.stopAlgoId); } catch { /* best effort */ }
      try { if(plan.finalTpAlgoId) await binance.cancelAlgo(plan.finalTpAlgoId); } catch { /* best effort */ }
    }
    if(previous) savePlan(previous);
    throw error;
  }
  // Replacement orders are installed before old ones are removed so the position is never intentionally unprotected.
  if (liveTradingEnabled) {
    if (previous?.stopAlgoId && previous.stopAlgoId!==plan.stopAlgoId) { try { await binance.cancelAlgo(previous.stopAlgoId); } catch { /* may already be gone */ } }
    if (previous?.finalTpAlgoId && previous.finalTpAlgoId!==plan.finalTpAlgoId) { try { await binance.cancelAlgo(previous.finalTpAlgoId); } catch { /* may already be gone */ } }
  }
  audit('INFO','EXTERNAL_POSITION_PROTECTED',plan,symbol); return getPlan(symbol)!;
}

export async function moveStop(symbol:string,newStop:number):Promise<PositionPlan> {
  const plan=getPlan(symbol); if(!plan||plan.status!=='ACTIVE') throw new Error('لا توجد خطة نشطة');
  const mark=await binance.markPrice(symbol); const price=Number(mark.markPrice);
  if (plan.side==='LONG' && newStop>=price) throw new Error('وقف اللونغ يجب أن يكون أسفل السعر الحالي');
  if (plan.side==='SHORT' && newStop<=price) throw new Error('وقف الشورت يجب أن يكون أعلى السعر الحالي');
  if (plan.side==='LONG' && newStop<plan.stop) throw new Error('رفض توسيع وقف اللونغ؛ يمكن فقط إبقاؤه أو رفعه');
  if (plan.side==='SHORT' && newStop>plan.stop) throw new Error('رفض توسيع وقف الشورت؛ يمكن فقط إبقاؤه أو خفضه');
  const oldStopAlgoId=plan.stopAlgoId;
  const next:PositionPlan={...plan,stop:newStop,stopAlgoId:undefined,updatedAt:Date.now()};
  if(liveTradingEnabled){
    // Place the tighter replacement first, then remove the old order.
    await installStop(next);
    if(oldStopAlgoId && oldStopAlgoId!==next.stopAlgoId){ try { await binance.cancelAlgo(oldStopAlgoId); } catch { /* stale */ } }
  } else {
    savePlan(next);
    await installStop(next);
  }
  audit('INFO','STOP_MOVED',{from:plan.stop,to:newStop},symbol); return getPlan(symbol)!;
}

export async function moveStopToBreakeven(symbol:string):Promise<PositionPlan> {
  const plan=getPlan(symbol); if(!plan) throw new Error('لا توجد خطة');
  return moveStop(symbol,plan.entry);
}

export async function installProtection(plan:PositionPlan):Promise<void> {
  await installStop(plan);
  await installFinalTp(plan);
}

async function installStop(plan:PositionPlan):Promise<void> {
  const rules=await binance.symbolRules(plan.symbol);
  const triggerPrice=roundToTick(plan.stop,rules.tickSize);
  if (!liveTradingEnabled) { audit('INFO','DRY_RUN_STOP',{triggerPrice},plan.symbol); return; }
  const result=await binance.placeAlgo({symbol:plan.symbol,side:opposite(plan.side),type:'STOP_MARKET',triggerPrice,closePosition:true,workingType:'MARK_PRICE',priceProtect:false});
  plan.stopAlgoId=String(result.algoId ?? result.strategyId ?? ''); plan.updatedAt=Date.now(); savePlan(plan);
}

async function installFinalTp(plan:PositionPlan):Promise<void> {
  const rules=await binance.symbolRules(plan.symbol);
  const triggerPrice=roundToTick(plan.tp3,rules.tickSize);
  if (!liveTradingEnabled) { audit('INFO','DRY_RUN_FINAL_TP',{triggerPrice},plan.symbol); return; }
  const result=await binance.placeAlgo({symbol:plan.symbol,side:opposite(plan.side),type:'TAKE_PROFIT_MARKET',triggerPrice,closePosition:true,workingType:'MARK_PRICE',priceProtect:false});
  plan.finalTpAlgoId=String(result.algoId ?? result.strategyId ?? ''); plan.updatedAt=Date.now(); savePlan(plan);
}

export async function reconcilePlanProtection(plan:PositionPlan):Promise<PositionPlan> {
  if(!liveTradingEnabled || plan.status!=='ACTIVE') return plan;
  const orders=await binance.openAlgoOrders(plan.symbol);
  const ids=new Set(orders.map((o:any)=>String(o.algoId ?? o.strategyId ?? o.orderId ?? '')));
  let changed=false;
  if(!plan.stopAlgoId || !ids.has(String(plan.stopAlgoId))){
    plan.stopAlgoId=undefined;
    await installStop(plan);
    changed=true;
    audit('WARN','STOP_PROTECTION_RESTORED',{stop:plan.stop},plan.symbol);
  }
  if(!plan.finalTpAlgoId || !ids.has(String(plan.finalTpAlgoId))){
    plan.finalTpAlgoId=undefined;
    await installFinalTp(plan);
    changed=true;
    audit('WARN','FINAL_TP_PROTECTION_RESTORED',{tp3:plan.tp3},plan.symbol);
  }
  if(changed){ plan.updatedAt=Date.now(); savePlan(plan); }
  return getPlan(plan.symbol) ?? plan;
}

export async function syncExternalPositions():Promise<BinancePosition[]> {
  if(!binance.isConnected()) return [];
  return (await binance.positions()).filter(p=>Math.abs(Number(p.positionAmt))>0);
}
