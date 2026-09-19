import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { audit, closeDb } from './db.js';
import { registerRoutes } from './routes.js';
import { startWorkers, stopWorkers } from './manager.js';

if(config.NODE_ENV==='production'){
  if(config.ADMIN_PASSWORD==='change-this-long-password') throw new Error('ADMIN_PASSWORD must be changed in production');
  if(config.SESSION_SECRET==='dev-session-secret-change-me-please') throw new Error('SESSION_SECRET must be changed in production');
}

const app=Fastify({logger:true,trustProxy:config.TRUST_PROXY,bodyLimit:128*1024});
await app.register(cookie);
await app.register(rateLimit,{global:false});
await registerRoutes(app);

if(config.NODE_ENV==='production'){
  const here=path.dirname(fileURLToPath(import.meta.url));
  const webRoot=path.resolve(here,'../web');
  await app.register(fastifyStatic,{root:webRoot,prefix:'/'});
  app.setNotFoundHandler((req,reply)=>{
    if(req.url.startsWith('/api/')) return reply.code(404).send({error:'NOT_FOUND'});
    return reply.sendFile('index.html');
  });
}

app.setErrorHandler((error,_req,reply)=>{
  app.log.error(error);
  const status=(error as any).statusCode && (error as any).statusCode<500 ? (error as any).statusCode : 400;
  reply.code(status).send({error:'REQUEST_FAILED',message:(error as Error).message});
});

const shutdown=async(signal:string)=>{
  audit('INFO','SERVER_SHUTDOWN',{signal});stopWorkers();await app.close();closeDb();process.exit(0);
};
process.on('SIGTERM',()=>void shutdown('SIGTERM'));
process.on('SIGINT',()=>void shutdown('SIGINT'));

await app.listen({host:config.HOST,port:config.PORT});
audit('INFO','SERVER_STARTED',{port:config.PORT,dryRun:config.DRY_RUN,allowLive:config.ALLOW_LIVE_TRADING});
startWorkers();
