import { config } from './config.js';

export function notificationsEnabled():boolean {
  return Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID);
}

export async function notify(text:string):Promise<void> {
  if(!notificationsEnabled()) return;
  const url=`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res=await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:config.TELEGRAM_CHAT_ID,text,disable_web_page_preview:true}),
    signal:AbortSignal.timeout(8_000)
  });
  if(!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
}

export function signalText(s:{symbol:string;side:string;entry:number;stop:number;tp1:number;tp2:number;tp3:number;score:number}):string {
  return [
    `${s.symbol} — ${s.side} — ${s.score}/100`,
    `Entry: ${s.entry}`,
    `SL: ${s.stop}`,
    `TP1: ${s.tp1}`,
    `TP2: ${s.tp2}`,
    `TP3: ${s.tp3}`
  ].join('\n');
}
