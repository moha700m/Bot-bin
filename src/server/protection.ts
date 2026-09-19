import { binance } from './binance/client.js';

function n(v:unknown):number { return Number(v??0); }
function avg(xs:number[]):number { return xs.reduce((a,b)=>a+b,0)/Math.max(1,xs.length); }
function atr(ks:any[][]):number {
  const tr:number[]=[];
  for(let i=1;i<ks.length;i++){
    const h=n(ks[i][2]),l=n(ks[i][3]),pc=n(ks[i-1][4]);
    tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
  }
  return avg(tr.slice(-14));
}

export async function suggestProtection(symbol:string):Promise<{symbol:string;side:'LONG'|'SHORT';entry:number;mark:number;stop:number;tp1:number;tp2:number;tp3:number}> {
  const positions=await binance.positions();
  const pos=positions.find(p=>p.symbol===symbol && Math.abs(Number(p.positionAmt))>0);
  if(!pos) throw new Error('لا يوجد مركز مفتوح');
  const side=Number(pos.positionAmt)>0?'LONG':'SHORT';
  const ks=await binance.klines(symbol,'5m',30);
  const a=atr(ks.slice(0,-1));
  const entry=Number(pos.entryPrice), mark=Number(pos.markPrice);
  if(!(a>0)) throw new Error('تعذر حساب ATR');
  const rawStop=side==='LONG' ? mark-1.35*a : mark+1.35*a;
  const stop=side==='LONG' ? (mark>entry+0.8*a?Math.max(entry,rawStop):rawStop) : (mark<entry-0.8*a?Math.min(entry,rawStop):rawStop);
  const risk=Math.max(a*1.35,Math.abs(entry-stop));
  return {
    symbol,side,entry,mark,stop,
    tp1:side==='LONG'?entry+risk:entry-risk,
    tp2:side==='LONG'?entry+2*risk:entry-2*risk,
    tp3:side==='LONG'?entry+3*risk:entry-3*risk
  };
}
