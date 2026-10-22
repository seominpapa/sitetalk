import handler from '../worker/src/handler.ts';

export function dailyScheduler(env) {
  let running=false;
  const ready=env.DB.prepare('CREATE TABLE IF NOT EXISTS _sitetalk_schedule (id INTEGER PRIMARY KEY CHECK(id=1), completed_day TEXT NOT NULL)').run();
  return async function tick(now=new Date()) {
    await ready;
    const day=now.toISOString().slice(0,10);
    if(running||now.toISOString().slice(11,16)<'14:50') return false;
    running=true;
    try {
      const done=await env.DB.prepare('SELECT completed_day FROM _sitetalk_schedule WHERE id=1').first();
      if(done?.completed_day>=day) return false;
      await handler.scheduled(null,env);
      await env.DB.prepare('INSERT INTO _sitetalk_schedule(id,completed_day) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET completed_day=excluded.completed_day').bind(day).run();
      return true;
    } finally {running=false;}
  };
}
