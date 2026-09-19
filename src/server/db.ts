import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import type { PositionPlan, RiskSettings, Signal, TradingMode } from './types.js';

const defaults: RiskSettings = {
  mode: 'APPROVAL',
  maxRiskPerTradePct: 0.5,
  maxDailyLossPct: 3,
  maxOpenPositions: 5,
  maxAutoLeverage: 8,
  maxNotionalPctOfEquity: 50,
  tp1ClosePct: 35,
  tp2ClosePct: 35,
  minQuoteVolume24h: 10_000_000
};

const dbDir = path.dirname(config.DATABASE_PATH);
fs.mkdirSync(dbDir, { recursive: true });
const sqlite = new Database(config.DATABASE_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  status TEXT NOT NULL,
  score REAL NOT NULL,
  entry REAL NOT NULL,
  stop REAL NOT NULL,
  tp1 REAL NOT NULL,
  tp2 REAL NOT NULL,
  tp3 REAL NOT NULL,
  leverage INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_status_created ON signals(status, created_at DESC);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  side TEXT NOT NULL,
  entry REAL NOT NULL,
  initial_qty REAL NOT NULL,
  stop REAL NOT NULL,
  tp1 REAL NOT NULL,
  tp2 REAL NOT NULL,
  tp3 REAL NOT NULL,
  tp1_done INTEGER NOT NULL DEFAULT 0,
  tp2_done INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  stop_algo_id TEXT,
  final_tp_algo_id TEXT,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  symbol TEXT,
  details TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC);
`);

function setting<T>(key: string, fallback: T): T {
  const row = sqlite.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

export function getRiskSettings(): RiskSettings {
  return { ...defaults, ...setting<Partial<RiskSettings>>('risk', {}) };
}

export function updateRiskSettings(patch: Partial<RiskSettings>): RiskSettings {
  const current = getRiskSettings();
  const next = { ...current, ...patch };
  const validModes: TradingMode[] = ['OFF', 'MANAGE_ONLY', 'APPROVAL', 'FULL_AUTO'];
  if (!validModes.includes(next.mode)) throw new Error('Invalid mode');
  sqlite.prepare(`INSERT INTO settings(key,value,updated_at) VALUES('risk',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
    .run(JSON.stringify(next), Date.now());
  return next;
}

export function saveSignal(signal: Signal): void {
  sqlite.prepare(`INSERT INTO signals(id,symbol,side,status,score,entry,stop,tp1,tp2,tp3,leverage,reason,created_at,expires_at)
    VALUES(@id,@symbol,@side,@status,@score,@entry,@stop,@tp1,@tp2,@tp3,@leverage,@reason,@createdAt,@expiresAt)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,score=excluded.score,reason=excluded.reason`)
    .run(signal);
}

export function listSignals(limit = 30): Signal[] {
  const rows = sqlite.prepare('SELECT * FROM signals ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
  return rows.map(r => ({
    id:r.id,symbol:r.symbol,side:r.side,status:r.status,score:r.score,entry:r.entry,stop:r.stop,tp1:r.tp1,tp2:r.tp2,tp3:r.tp3,
    leverage:r.leverage,reason:r.reason,createdAt:r.created_at,expiresAt:r.expires_at
  }));
}

export function getSignal(id: string): Signal | undefined {
  const r = sqlite.prepare('SELECT * FROM signals WHERE id=?').get(id) as any;
  return r ? { id:r.id,symbol:r.symbol,side:r.side,status:r.status,score:r.score,entry:r.entry,stop:r.stop,tp1:r.tp1,tp2:r.tp2,tp3:r.tp3,leverage:r.leverage,reason:r.reason,createdAt:r.created_at,expiresAt:r.expires_at } : undefined;
}

export function setSignalStatus(id: string, status: Signal['status']): void {
  sqlite.prepare('UPDATE signals SET status=? WHERE id=?').run(status, id);
}

export function expireSignals(now = Date.now()): void {
  sqlite.prepare("UPDATE signals SET status='EXPIRED' WHERE status='PENDING' AND expires_at < ?").run(now);
}

export function savePlan(plan: PositionPlan): void {
  sqlite.prepare(`INSERT INTO plans(id,symbol,side,entry,initial_qty,stop,tp1,tp2,tp3,tp1_done,tp2_done,status,stop_algo_id,final_tp_algo_id,source,updated_at)
  VALUES(@id,@symbol,@side,@entry,@initialQty,@stop,@tp1,@tp2,@tp3,@tp1Done,@tp2Done,@status,@stopAlgoId,@finalTpAlgoId,@source,@updatedAt)
  ON CONFLICT(symbol) DO UPDATE SET
    id=excluded.id,side=excluded.side,entry=excluded.entry,initial_qty=excluded.initial_qty,stop=excluded.stop,tp1=excluded.tp1,tp2=excluded.tp2,tp3=excluded.tp3,
    tp1_done=excluded.tp1_done,tp2_done=excluded.tp2_done,status=excluded.status,stop_algo_id=excluded.stop_algo_id,final_tp_algo_id=excluded.final_tp_algo_id,
    source=excluded.source,updated_at=excluded.updated_at`).run({ ...plan, tp1Done: Number(plan.tp1Done), tp2Done: Number(plan.tp2Done), stopAlgoId: plan.stopAlgoId ?? null, finalTpAlgoId: plan.finalTpAlgoId ?? null });
}

export function listPlans(activeOnly = false): PositionPlan[] {
  const rows = sqlite.prepare(`SELECT * FROM plans ${activeOnly ? "WHERE status='ACTIVE'" : ''} ORDER BY updated_at DESC`).all() as any[];
  return rows.map(r => ({
    id:r.id,symbol:r.symbol,side:r.side,entry:r.entry,initialQty:r.initial_qty,stop:r.stop,tp1:r.tp1,tp2:r.tp2,tp3:r.tp3,
    tp1Done:Boolean(r.tp1_done),tp2Done:Boolean(r.tp2_done),status:r.status,stopAlgoId:r.stop_algo_id ?? undefined,finalTpAlgoId:r.final_tp_algo_id ?? undefined,
    source:r.source,updatedAt:r.updated_at
  }));
}

export function getPlan(symbol: string): PositionPlan | undefined {
  return listPlans(false).find(p => p.symbol === symbol);
}

export function deletePlan(symbol: string): void {
  sqlite.prepare('DELETE FROM plans WHERE symbol=?').run(symbol);
}

export function audit(level: 'INFO'|'WARN'|'ERROR', event: string, details: unknown, symbol?: string): void {
  sqlite.prepare('INSERT INTO audit(ts,level,event,symbol,details) VALUES(?,?,?,?,?)')
    .run(Date.now(), level, event, symbol ?? null, JSON.stringify(details));
}

export function recentAudit(limit = 100): Array<{id:number;ts:number;level:string;event:string;symbol?:string;details:any}> {
  const rows = sqlite.prepare('SELECT * FROM audit ORDER BY ts DESC LIMIT ?').all(limit) as any[];
  return rows.map(r => ({ id:r.id,ts:r.ts,level:r.level,event:r.event,symbol:r.symbol ?? undefined,details:safeJson(r.details) }));
}

function safeJson(v: string): unknown { try { return JSON.parse(v); } catch { return v; } }

export function closeDb(): void { sqlite.close(); }
