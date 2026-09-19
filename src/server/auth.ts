import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

const COOKIE='trader_session';
const TTL=12*60*60*1000;

function sign(payload:string):string { return createHmac('sha256',config.SESSION_SECRET).update(payload).digest('base64url'); }
function safeEqual(a:string,b:string):boolean {
  const aa=Buffer.from(a), bb=Buffer.from(b); return aa.length===bb.length && timingSafeEqual(aa,bb);
}

export function createSession():string {
  const payload=Buffer.from(JSON.stringify({exp:Date.now()+TTL,role:'admin'})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token?:string):boolean {
  if(!token) return false;
  const [payload,sig]=token.split('.');
  if(!payload||!sig||!safeEqual(sign(payload),sig)) return false;
  try { const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')); return data.role==='admin' && Number(data.exp)>Date.now(); }
  catch { return false; }
}

export function passwordMatches(value:string):boolean { return safeEqual(value,config.ADMIN_PASSWORD); }

export async function requireAuth(req:FastifyRequest, reply:FastifyReply):Promise<void> {
  if(!verifySession(req.cookies[COOKIE])) { reply.code(401).send({error:'UNAUTHORIZED'}); }
}

export function setSessionCookie(reply:FastifyReply):void {
  reply.setCookie(COOKIE,createSession(),{httpOnly:true,sameSite:'strict',secure:config.NODE_ENV==='production',path:'/',maxAge:TTL/1000});
}
export function clearSessionCookie(reply:FastifyReply):void { reply.clearCookie(COOKIE,{path:'/'}); }
