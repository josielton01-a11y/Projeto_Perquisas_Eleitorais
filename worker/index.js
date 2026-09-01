const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const hash = async (value, pepper = "") => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pepper}:${value}`)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const bearer = request => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
async function schema(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS agent_accesses (login TEXT PRIMARY KEY, password_hash TEXT NOT NULL, research_id INTEGER NOT NULL, agent_id TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0)"),
  ]);
}
async function isAdmin(request, env) {
  const token = bearer(request); if (!token) return false;
  const row = await env.DB.prepare("SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?").bind(await hash(token), Date.now()).first();
  return !!row;
}
async function api(request, env, path) {
  await schema(env.DB);
  if (path === "/api/admin/login" && request.method === "POST") {
    const { username, password } = await request.json();
    if (username !== env.ADMIN_USERNAME || await hash(password, env.PASSWORD_PEPPER) !== env.ADMIN_PASSWORD_HASH) return json({error:"invalid"},401);
    const token = crypto.randomUUID()+crypto.randomUUID();
    await env.DB.prepare("INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)").bind(await hash(token),Date.now()+2592000000).run();
    return json({token});
  }
  if (path === "/api/admin/state") {
    if (!await isAdmin(request,env)) return json({error:"unauthorized"},401);
    if (request.method === "GET") {
      const rows = await env.DB.prepare("SELECT key,value FROM app_state").all(); const out={}; for(const r of rows.results) out[r.key]=JSON.parse(r.value); return json(out);
    }
    if (request.method === "PUT") {
      const body=await request.json(), researches=body.researches||[], questions=body.questions||[];
      const sanitized=researches.map(r=>({...r,agents:(r.agents||[]).map(a=>{const {password,...safe}=a;return safe;})}));
      const statements=[env.DB.prepare("DELETE FROM agent_accesses"),env.DB.prepare("INSERT INTO app_state(key,value,updated_at) VALUES('researches',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(sanitized),Date.now()),env.DB.prepare("INSERT INTO app_state(key,value,updated_at) VALUES('questions',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(questions),Date.now())];
      for(const r of researches) for(const a of (r.agents||[])) if(a.login&&a.password) statements.push(env.DB.prepare("INSERT INTO agent_accesses(login,password_hash,research_id,agent_id,blocked) VALUES(?,?,?,?,?)").bind(a.login,await hash(a.password,env.PASSWORD_PEPPER),r.id,a.id,a.blocked?1:0));
      await env.DB.batch(statements); return json({ok:true});
    }
  }
  if (path === "/api/agent/login" && request.method === "POST") {
    const {login,password}=await request.json(); const access=await env.DB.prepare("SELECT * FROM agent_accesses WHERE login=? AND password_hash=?").bind(String(login||"").trim(),await hash(password,env.PASSWORD_PEPPER)).first();
    if(!access||access.blocked) return json({error:"invalid"},401);
    const rows=await env.DB.prepare("SELECT key,value FROM app_state WHERE key IN ('researches','questions')").all(), state=Object.fromEntries(rows.results.map(r=>[r.key,JSON.parse(r.value)]));
    const research=(state.researches||[]).find(r=>r.id===access.research_id), agent=research?.agents?.find(a=>a.id===access.agent_id); if(!research||!agent)return json({error:"invalid"},401);
    return json({research,agent,questions:state.questions||[]});
  }
  return json({error:"not_found"},404);
}
export default { async fetch(request, env) { const url=new URL(request.url); if(url.pathname.startsWith("/api/")) return api(request,env,url.pathname); const response=await env.ASSETS.fetch(request); if(response.status!==404)return response; url.pathname="/index.html"; return env.ASSETS.fetch(new Request(url,request)); } };
