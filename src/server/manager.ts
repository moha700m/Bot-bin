import { binance } from './binance/client.js';
import { config, liveTradingEnabled } from './config.js';
import { audit, getRiskSettings, listPlans, savePlan } from './db.js';
import { closePosition, executeSignal, moveStop, reconcilePlanProtection } from './execution.js';
import { scanMarket } from './strategy.js';
import type { PositionPlan } from './types.js';
import { notify, signalText } from './notify.js';

let positionTimer: NodeJS.Timeout | undefined;
let scanTimer: NodeJS.Timeout | undefined;
let managing=false;
let scanning=false;
let lastProtectionReconcile=0;

function reached(side:'LONG'|'SHORT', price:number, level:number):boolean {
  return side==='LONG' ? price>=level : price<=level;
}

export async function manageOnce():Promise<void> {
  if (managing || !binance.isConnected()) return;
  const settings=getRiskSettings();
  if (settings.mode==='OFF') return;
  managing=true;
  try {
    const positions=await binance.positions();
    const activePositions=new Map(positions.filter(p=>Math.abs(Number(p.positionAmt))>0).map(p=>[p.symbol,p]));
    const plans=listPlans(true);
    const shouldReconcile=liveTradingEnabled && Date.now()-lastProtectionReconcile>=15_000;
    for (const plan of plans) {
      const pos=activePositions.get(plan.symbol);
      if (!pos) {
        if(liveTradingEnabled){
          try { if(plan.stopAlgoId) await binance.cancelAlgo(plan.stopAlgoId); } catch { /* likely already consumed */ }
          try { if(plan.finalTpAlgoId) await binance.cancelAlgo(plan.finalTpAlgoId); } catch { /* likely already consumed */ }
        }
        plan.status='CLOSED'; plan.stopAlgoId=undefined; plan.finalTpAlgoId=undefined; plan.updatedAt=Date.now(); savePlan(plan);
        audit('INFO','PLAN_CLOSED_NO_POSITION',{},plan.symbol); continue;
      }
      if (!liveTradingEnabled) continue;
      if(shouldReconcile){
        try { await reconcilePlanProtection(plan); }
        catch(error){ audit('ERROR','PROTECTION_RECONCILE_FAILED',{message:(error as Error).message},plan.symbol); }
      }
      const price=Number(pos.markPrice);
      await managePlan(plan,price,settings.tp1ClosePct,settings.tp2ClosePct);
    }
    if(shouldReconcile) lastProtectionReconcile=Date.now();
  } catch(error) {
    audit('ERROR','POSITION_MANAGER_FAILED',{message:(error as Error).message});
  } finally { managing=false; }
}

async function managePlan(plan:PositionPlan, price:number, tp1Pct:number, tp2Pct:number):Promise<void> {
  if (!plan.tp1Done && reached(plan.side,price,plan.tp1)) {
    await closePosition(plan.symbol,tp1Pct/100);
    plan.tp1Done=true; plan.updatedAt=Date.now(); savePlan(plan);
    try { await moveStop(plan.symbol,plan.entry); } catch(error) { audit('ERROR','BREAKEVEN_MOVE_FAILED',{message:(error as Error).message},plan.symbol); }
    audit('INFO','TP1_MANAGED',{price,tp1:plan.tp1,closedPct:tp1Pct},plan.symbol);
    void notify(`${plan.symbol}: TP1 reached. Closed ${tp1Pct}% and moved stop to breakeven.`).catch(()=>undefined);
    return;
  }
  if (plan.tp1Done && !plan.tp2Done && reached(plan.side,price,plan.tp2)) {
    const remainingAfterTp1=Math.max(1,100-tp1Pct);
    const fraction=Math.min(1,tp2Pct/remainingAfterTp1);
    await closePosition(plan.symbol,fraction);
    plan.tp2Done=true; plan.updatedAt=Date.now(); savePlan(plan);
    try { await moveStop(plan.symbol,plan.tp1); } catch(error) { audit('ERROR','TP1_STOP_MOVE_FAILED',{message:(error as Error).message},plan.symbol); }
    audit('INFO','TP2_MANAGED',{price,tp2:plan.tp2,closedPctOfInitial:tp2Pct},plan.symbol);
    void notify(`${plan.symbol}: TP2 reached. Closed another ${tp2Pct}% of initial size and moved stop to TP1.`).catch(()=>undefined);
  }
}

export async function scanOnce():Promise<void> {
  if (scanning) return;
  const settings=getRiskSettings();
  if (settings.mode==='OFF' || settings.mode==='MANAGE_ONLY') return;
  scanning=true;
  try {
    const signals=await scanMarket();
    if (signals.length) {
      const best=[...signals].sort((a,b)=>b.score-a.score)[0];
      if(settings.mode==='APPROVAL') void notify(`Pending approval\n${signalText(best)}`).catch(()=>undefined);
      if (settings.mode==='FULL_AUTO') {
        try {
          const result=await executeSignal(best,'AUTO');
          void notify(`Auto execution ${result.dryRun?'DRY RUN':'LIVE'}\n${signalText(best)}`).catch(()=>undefined);
        } catch(error) { audit('ERROR','AUTO_EXECUTION_REJECTED',{message:(error as Error).message,signalId:best.id},best.symbol); }
      }
    }
  } catch(error) { audit('ERROR','MARKET_SCAN_FAILED',{message:(error as Error).message}); }
  finally { scanning=false; }
}

export function startWorkers():void {
  if (positionTimer || scanTimer) return;
  void manageOnce(); void scanOnce();
  positionTimer=setInterval(()=>void manageOnce(),config.POSITION_POLL_MS);
  scanTimer=setInterval(()=>void scanOnce(),config.SCAN_INTERVAL_MS);
}

export function stopWorkers():void {
  if(positionTimer) clearInterval(positionTimer);
  if(scanTimer) clearInterval(scanTimer);
  positionTimer=undefined; scanTimer=undefined;
}
