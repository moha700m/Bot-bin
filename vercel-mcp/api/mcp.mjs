import crypto from 'node:crypto';

const BASE='https://fapi.binance.com';
const TOOLS=[
  {name:'futures_balance',description:'Read USDⓈ-M Futures balances. Read-only.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
  {name:'futures_open_positions',description:'Read currently open USDⓈ-M Futures positions. Read-only.',inputSchema:{type:'object',properties:{symbol:{type:'string',description:'Optional symbol such as BTCUSDT'}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}},
  {name:'futures_account_summary',description:'Read USDⓈ-M Futures account summary. Read-only.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true}}
];

let timeOffset=0;
let timeSyncedAt=0;

function configured(){
  return Boolean(process.env.BINANCE_API_KEY&&process.env.BINANCE_API_SECRET&&process.env.MCP_BEARER_TOKEN);
}
function send(res,status,body){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8').setHeader('Cache-Control','no-store').end(JSON.stringify(body));
}
function bearerOk(req){
  const expected=process.env.MCP_BEARER_TOKEN||'';
  const value=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!expected||!value) return false;
  const a=Buffer.from(value),b=Buffer.from(expected);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function syncTime(){
  const now=Date.now();
  if(now-timeSyncedAt<60000) return;
  const r=await fetch(BASE+'/fapi/v1/time',{cache:'no-store'});
  if(!r.ok) throw new Error('Binance time sync failed');
  const j=await r.json();
  timeOffset=Number(j.serverTime)-Date.now();
  timeSyncedAt=now;
}
async function signedGet(path,params={}){
  const key=process.env.BINANCE_API_KEY;
  const secret=process.env.BINANCE_API_SECRET;
  if(!key||!secret) throw new Error('Binance credentials are not configured');
  await syncTime();
  const q=new URLSearchParams();
  for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null&&v!=='') q.set(k,String(v));
  q.set('recvWindow','5000');
  q.set('timestamp',String(Date.now()+timeOffset));
  const sig=crypto.createHmac('sha256',secret).update(q.toString()).digest('hex');
  q.set('signature',sig);
  const r=await fetch(BASE+path+'?'+q.toString(),{headers:{'X-MBX-APIKEY':key},cache:'no-store'});
  const raw=await r.text();
  let data;
  try{data=JSON.parse(raw)}catch{data={message:raw.slice(0,300)}}
  if(!r.ok){
    const code=data&&data.code!==undefined?' ['+data.code+']':'';
    throw new Error('Binance API error'+code+': '+(data?.msg||data?.message||r.statusText));
  }
  return data;
}
function safeSymbol(value){
  if(value===undefined||value===null||value==='') return undefined;
  const symbol=String(value).toUpperCase();
  if(!/^[A-Z0-9_]{3,30}$/.test(symbol)) throw new Error('Invalid symbol');
  return symbol;
}
async function runTool(name,args={}){
  if(name==='futures_balance'){
    const rows=await signedGet('/fapi/v3/balance');
    return rows.map(x=>({asset:x.asset,balance:x.balance,crossWalletBalance:x.crossWalletBalance,crossUnPnl:x.crossUnPnl,availableBalance:x.availableBalance,maxWithdrawAmount:x.maxWithdrawAmount})).filter(x=>Number(x.balance)!==0||Number(x.crossUnPnl)!==0);
  }
  if(name==='futures_open_positions'){
    const symbol=safeSymbol(args.symbol);
    const rows=await signedGet('/fapi/v3/positionRisk',symbol?{symbol}:{});
    return rows.filter(x=>Number(x.positionAmt)!==0).map(x=>({symbol:x.symbol,side:Number(x.positionAmt)>0?'LONG':'SHORT',positionAmt:x.positionAmt,entryPrice:x.entryPrice,breakEvenPrice:x.breakEvenPrice,markPrice:x.markPrice,unRealizedProfit:x.unRealizedProfit,liquidationPrice:x.liquidationPrice,leverage:x.leverage,marginType:x.marginType,isolatedMargin:x.isolatedMargin,notional:x.notional,positionSide:x.positionSide,updateTime:x.updateTime}));
  }
  if(name==='futures_account_summary'){
    const a=await signedGet('/fapi/v3/account');
    return {feeTier:a.feeTier,canTrade:a.canTrade,canDeposit:a.canDeposit,canWithdraw:a.canWithdraw,totalInitialMargin:a.totalInitialMargin,totalMaintMargin:a.totalMaintMargin,totalWalletBalance:a.totalWalletBalance,totalUnrealizedProfit:a.totalUnrealizedProfit,totalMarginBalance:a.totalMarginBalance,totalPositionInitialMargin:a.totalPositionInitialMargin,totalOpenOrderInitialMargin:a.totalOpenOrderInitialMargin,availableBalance:a.availableBalance,maxWithdrawAmount:a.maxWithdrawAmount,assets:(a.assets||[]).filter(x=>Number(x.walletBalance)!==0||Number(x.unrealizedProfit)!==0).map(x=>({asset:x.asset,walletBalance:x.walletBalance,unrealizedProfit:x.unrealizedProfit,marginBalance:x.marginBalance,availableBalance:x.availableBalance}))};
  }
  throw new Error('Unknown tool');
}
function result(id,data){
  return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}};
}
function rpcError(id,code,message){
  return {jsonrpc:'2.0',id,error:{code,message}};
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method==='GET') return send(res,200,{name:'binance-usdm-readonly',version:'1.0.0',transport:'streamable-http-stateless',configured:configured(),readOnly:true,tools:TOOLS.map(t=>t.name)});
  if(req.method!=='POST') return send(res,405,{error:'Method not allowed'});
  if(!bearerOk(req)) return send(res,401,{error:'Unauthorized'});
  let body={};
  try{body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});}catch{return send(res,400,{error:'Invalid JSON'});}
  const {id=null,method,params={}}=body;
  try{
    if(method==='initialize') return send(res,200,{jsonrpc:'2.0',id,result:{protocolVersion:params.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'binance-usdm-readonly',version:'1.0.0'}}});
    if(method==='notifications/initialized') return res.status(204).end();
    if(method==='ping') return send(res,200,{jsonrpc:'2.0',id,result:{}});
    if(method==='tools/list') return send(res,200,{jsonrpc:'2.0',id,result:{tools:TOOLS}});
    if(method==='tools/call'){
      const name=params.name;
      if(!TOOLS.some(t=>t.name===name)) return send(res,200,rpcError(id,-32602,'Unknown or non-read-only tool'));
      const data=await runTool(name,params.arguments||{});
      return send(res,200,result(id,data));
    }
    return send(res,200,rpcError(id,-32601,'Method not found'));
  }catch(e){
    return send(res,200,rpcError(id,-32000,e instanceof Error?e.message:'Request failed'));
  }
}