import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { binance } from './binance/client.js';
import { clearSessionCookie, passwordMatches, setSessionCookie, verifySession } from './auth.js';
import { config, hasBinanceCredentials, liveTradingEnabled } from './config.js';
import { audit, getPlan, getRiskSettings, getSignal, listPlans, listSignals, recentAudit, setSignalStatus, updateRiskSettings } from './db.js';
import { closePosition, executeSignal, executionState, manualEntry, moveStop, moveStopToBreakeven, protectExisting } from './execution.js';
import { scanOnce } from './manager.js';
import { suggestProtection } from './protection.js';

const riskPatch=z.object({
  mode:z.enum(['OFF','MANAGE_ONLY','APPROVAL','FULL_AUTO']).optional(),
  maxRiskPerTradePct:z.number().min(0.05).max(5).optional(),
  maxDailyLossPct:z.number().min(0.5).max(20).optional(),
  maxOpenPositions:z.number().int().min(1).max(20).optional(),
  maxAutoLeverage:z.number().int().min(1).max(20).optional(),
  maxNotionalPctOfEquity:z.number().min(5).max(300).optional(),
  tp1ClosePct:z.number().min(5).max(80).optional(),
  tp2ClosePct:z.number().min(5).max(80).optional(),
  minQuoteVolume24h:z.number().min(1_000_000).max(1_000_000_000).optional()
});

export async function registerRoutes(app:FastifyInstance):Promise<void> {
  app.get('/api/health',async()=>({ok:true,binanceConfigured:hasBinanceCredentials,liveTradingEnabled,dryRun:config.DRY_RUN}));
  app.post('/api/auth/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
    const body=z.object({password:z.string().min(1)}).parse(req.body);
    if(!passwordMatches(body.password)) return reply.code(401).send({error:'INVALID_CREDENTIALS'});
    setSessionCookie(reply); return {ok:true};
  });
  app.post('/api/auth/logout',async(_req,reply)=>{clearSessionCookie(reply);return {ok:true};});
  app.get('/api/auth/me',async(req)=>({authenticated:verifySession(req.cookies.trader_session)}));

  app.addHook('preHandler',async(req,reply)=>{
    if(!req.url.startsWith('/api/')) return;
    const isPublic=['/api/health','/api/auth/login','/api/auth/logout','/api/auth/me'].some(p=>req.url.startsWith(p));
    if(!isPublic && !verifySession(req.cookies.trader_session)) return reply.code(401).send({error:'UNAUTHORIZED'});
    if(req.method!=='GET' && req.headers['x-trading-console']!=='1') return reply.code(403).send({error:'CSRF_GUARD'});
  });

  app.get('/api/state',async()=>{
    const settings=getRiskSettings();
    let positions:any[]=[]; let account:any=null; let connectionError:string|undefined;
    if(hasBinanceCredentials){
      try {
        [positions,account]=await Promise.all([binance.positions(),binance.account()]);
        positions=positions.filter(p=>Math.abs(Number(p.positionAmt))>0);
      } catch(error){connectionError=(error as Error).message;}
    }
    return {
      now:Date.now(),settings,execution:executionState(),connection:{configured:hasBinanceCredentials,error:connectionError},
      account:account?{totalWalletBalance:account.totalWalletBalance,totalMarginBalance:account.totalMarginBalance,availableBalance:account.availableBalance,totalUnrealizedProfit:account.totalUnrealizedProfit}:null,
      positions,plans:listPlans(false),signals:listSignals(30),audit:recentAudit(60)
    };
  });

  app.patch('/api/settings',async(req)=>{
    const patch=riskPatch.parse(req.body);
    if(patch.mode==='FULL_AUTO' && !config.ALLOW_LIVE_TRADING) throw new Error('FULL_AUTO محجوب من متغير البيئة ALLOW_LIVE_TRADING');
    const next=updateRiskSettings(patch);audit('INFO','SETTINGS_UPDATED',patch);return next;
  });

  app.post('/api/scan',async()=>{await scanOnce();return {ok:true};});

  app.post('/api/signals/:id/approve',async(req)=>{
    const {id}=req.params as {id:string};const signal=getSignal(id);if(!signal) throw new Error('الإشارة غير موجودة');
    setSignalStatus(id,'APPROVED');
    try{return await executeSignal({...signal,status:'APPROVED'},'APPROVED_SIGNAL');}
    catch(error){setSignalStatus(id,'FAILED');throw error;}
  });
  app.post('/api/signals/:id/reject',async(req)=>{const {id}=req.params as {id:string};setSignalStatus(id,'REJECTED');audit('INFO','SIGNAL_REJECTED',{id});return {ok:true};});

  app.post('/api/manual-entry',async(req)=>{
    const body=z.object({symbol:z.string().regex(/^[A-Z0-9]{3,20}USDT$/),side:z.enum(['LONG','SHORT']),leverage:z.number().int().min(1).max(20),stop:z.number().positive(),tp1:z.number().positive(),tp2:z.number().positive(),tp3:z.number().positive()}).parse(req.body);
    return manualEntry(body);
  });

  app.get('/api/positions/:symbol/suggest',async(req)=>suggestProtection((req.params as {symbol:string}).symbol.toUpperCase()));
  app.post('/api/positions/:symbol/protect',async(req)=>{
    const symbol=(req.params as {symbol:string}).symbol.toUpperCase();
    const body=z.object({stop:z.number().positive(),tp1:z.number().positive(),tp2:z.number().positive(),tp3:z.number().positive()}).parse(req.body);
    return protectExisting({symbol,...body});
  });
  app.post('/api/positions/:symbol/breakeven',async(req)=>moveStopToBreakeven((req.params as {symbol:string}).symbol.toUpperCase()));
  app.post('/api/positions/:symbol/stop',async(req)=>{const symbol=(req.params as {symbol:string}).symbol.toUpperCase();const {stop}=z.object({stop:z.number().positive()}).parse(req.body);return moveStop(symbol,stop);});
  app.post('/api/positions/:symbol/close',async(req)=>{const symbol=(req.params as {symbol:string}).symbol.toUpperCase();const {fraction}=z.object({fraction:z.number().min(0.01).max(1)}).parse(req.body);return closePosition(symbol,fraction);});

  app.post('/api/kill-switch',async()=>{const settings=updateRiskSettings({mode:'OFF'});audit('WARN','KILL_SWITCH',{});return settings;});
  app.post('/api/panic-close-all',async(req)=>{
    const {confirm}=z.object({confirm:z.literal('CLOSE_ALL')}).parse(req.body);
    void confirm;
    if(!liveTradingEnabled) return {dryRun:true,message:'Live trading disabled; no positions were changed'};
    const positions=(await binance.positions()).filter(p=>Math.abs(Number(p.positionAmt))>0);
    const results=[];
    for(const p of positions){
      try{results.push({symbol:p.symbol,result:await closePosition(p.symbol,1)});await binance.cancelAllOpenOrders(p.symbol).catch(()=>undefined);await binance.cancelAllAlgoOrders(p.symbol).catch(()=>undefined);}
      catch(error){results.push({symbol:p.symbol,error:(error as Error).message});}
    }
    updateRiskSettings({mode:'OFF'});audit('WARN','PANIC_CLOSE_ALL',{count:positions.length});return {dryRun:false,results};
  });

  app.get('/api/plans/:symbol',async(req)=>getPlan((req.params as {symbol:string}).symbol.toUpperCase())??null);
}
