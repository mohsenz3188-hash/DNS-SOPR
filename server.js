#!/usr/bin/env node
/**
 * DNS Panel — standalone server (zero dependencies, Node.js >= 18)
 * Serves the panel UI and a small REST API. Data is stored as JSON
 * in DATA_DIR (default: ./data next to this file, systemd sets /opt/dns-panel/data).
 *
 * API:
 *   GET    /api/panel            -> { zones, records, stats }
 *   POST   /api/zones            { name, description }
 *   PUT    /api/zones/:id        { name, description }
 *   DELETE /api/zones/:id
 *   POST   /api/records          { zoneId, name, type, content, ttl, priority }
 *   PUT    /api/records/:id      { name, type, content, ttl, priority }
 *   POST   /api/records/:id/toggle { enabled }
 *   DELETE /api/records/:id
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 2053);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");
const TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "PTR", "SOA"];

fs.mkdirSync(DATA_DIR, { recursive: true });
function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const db = JSON.parse(raw);
    if (Array.isArray(db.zones) && Array.isArray(db.records)) return db;
  } catch (_) { /* fresh start */ }
  return { zones: [], records: [], seq: 1 };
}
let db = load();
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function send(res, code, obj, type = "application/json; charset=utf-8") {
  const body = type.startsWith("application/json") ? JSON.stringify(obj) : obj;
  res.writeHead(code, { "content-type": type });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function panel() {
  const zones = db.zones.map((z) => {
    const zr = db.records.filter((r) => r.zoneId === z.id);
    return { ...z, recordCount: zr.length, activeCount: zr.filter((r) => r.enabled).length };
  });
  const records = db.records.map((r) => ({
    ...r, zoneName: (db.zones.find((z) => z.id === r.zoneId) || {}).name || "",
  }));
  return {
    zones, records,
    stats: {
      zoneCount: db.zones.length,
      recordCount: db.records.length,
      activeCount: db.records.filter((r) => r.enabled).length,
      disabledCount: db.records.filter((r) => !r.enabled).length,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    if (p === "/" || p === "/index.html") return send(res, 200, HTML, "text/html; charset=utf-8");
    if (p === "/api/panel" && req.method === "GET") return send(res, 200, panel());

    if (p === "/api/zones" && req.method === "POST") {
      const b = await readBody(req);
      const name = String(b.name || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!name.includes(".")) return send(res, 400, { error: "invalid domain" });
      if (db.zones.some((z) => z.name === name)) return send(res, 400, { error: "domain already exists" });
      const zone = { id: db.seq++, name, description: String(b.description || ""), createdAt: new Date().toISOString() };
      db.zones.push(zone); save();
      return send(res, 201, { id: zone.id });
    }
    const zm = p.match(/^\/api\/zones\/(\d+)$/);
    if (zm && req.method === "PUT") {
      const z = db.zones.find((x) => x.id === Number(zm[1]));
      if (!z) return send(res, 404, { error: "not found" });
      const b = await readBody(req);
      if (b.name) z.name = String(b.name).trim().toLowerCase();
      z.description = String(b.description ?? z.description);
      save(); return send(res, 200, { ok: true });
    }
    if (zm && req.method === "DELETE") {
      db.zones = db.zones.filter((x) => x.id !== Number(zm[1]));
      db.records = db.records.filter((r) => r.zoneId !== Number(zm[1]));
      save(); return send(res, 200, { ok: true });
    }

    if (p === "/api/records" && req.method === "POST") {
      const b = await readBody(req);
      if (!db.zones.some((z) => z.id === Number(b.zoneId))) return send(res, 400, { error: "zone not found" });
      if (!TYPES.includes(b.type)) return send(res, 400, { error: "invalid type" });
      const rec = {
        id: db.seq++, zoneId: Number(b.zoneId), name: String(b.name || "@").trim(),
        type: b.type, content: String(b.content || "").trim(),
        ttl: Math.min(604800, Math.max(60, Number(b.ttl) || 3600)),
        priority: b.type === "MX" || b.type === "SRV" ? Number(b.priority ?? 10) : null,
        enabled: true, updatedAt: new Date().toISOString(),
      };
      if (!rec.content) return send(res, 400, { error: "content required" });
      db.records.push(rec); save();
      return send(res, 201, { id: rec.id });
    }
    const rm = p.match(/^\/api\/records\/(\d+)$/);
    if (rm && req.method === "PUT") {
      const r = db.records.find((x) => x.id === Number(rm[1]));
      if (!r) return send(res, 404, { error: "not found" });
      const b = await readBody(req);
      Object.assign(r, {
        name: String(b.name ?? r.name), type: TYPES.includes(b.type) ? b.type : r.type,
        content: String(b.content ?? r.content), ttl: Number(b.ttl) || r.ttl,
        priority: b.type === "MX" || b.type === "SRV" ? Number(b.priority ?? 10) : null,
        updatedAt: new Date().toISOString(),
      });
      save(); return send(res, 200, { ok: true });
    }
    if (rm && req.method === "DELETE") {
      db.records = db.records.filter((x) => x.id !== Number(rm[1]));
      save(); return send(res, 200, { ok: true });
    }
    const tm = p.match(/^\/api\/records\/(\d+)\/toggle$/);
    if (tm && req.method === "POST") {
      const r = db.records.find((x) => x.id === Number(tm[1]));
      if (!r) return send(res, 404, { error: "not found" });
      const b = await readBody(req);
      r.enabled = !!b.enabled; r.updatedAt = new Date().toISOString();
      save(); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String(e && e.message || e) });
  }
});

const HTML = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DNS Panel</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#f1f5f9;margin:0}
header{background:#111827;padding:14px 20px;display:flex;gap:10px;align-items:center}
.logo{width:36px;height:36px;border-radius:10px;background:#00b578;display:flex;align-items:center;justify-content:center;font-weight:800}
main{max-width:1000px;margin:0 auto;padding:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.card,.box{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:16px}
.num{font-size:28px;font-weight:800}
button{background:#00b578;color:#fff;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;font-weight:700}
button.ghost{background:#334155}button.danger{background:#7f1d1d}
input,select{background:#0f172a;color:#f1f5f9;border:1px solid #334155;border-radius:8px;padding:8px}
table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #334155;text-align:right}
.mono{font-family:ui-monospace,monospace;direction:ltr;unicode-bidi:embed}
.badge{background:#2563eb;border-radius:6px;padding:2px 8px;font-size:12px;color:#fff}
form{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
</style></head><body>
<header><div class="logo">D</div><strong>DNS Panel</strong><span style="opacity:.6">پنل مدیریت DNS</span></header>
<main>
<div class="cards">
<div class="card"><div class="num" id="sZones">0</div>زون (دامنه)</div>
<div class="card"><div class="num" id="sRecords">0</div>کل رکوردها</div>
<div class="card"><div class="num" id="sActive">0</div>رکورد فعال</div>
</div>
<div class="box" style="margin-top:16px"><h3>افزودن دامنه</h3>
<form id="zoneForm"><input id="zName" placeholder="example.com" class="mono" required>
<input id="zDesc" placeholder="توضیح (اختیاری)"><button>افزودن دامنه</button></form>
<div id="zones"></div></div>
<div class="box" style="margin-top:16px"><h3>افزودن رکورد</h3>
<form id="recForm"><select id="rZone"></select>
<select id="rType"></select>
<input id="rName" value="@" class="mono" size="8">
<input id="rContent" placeholder="مقدار (IP / دامنه / متن)" class="mono" required>
<select id="rTtl"><option>300</option><option selected>3600</option><option>14400</option><option>86400</option></select>
<input id="rPrio" type="number" value="10" size="4" style="display:none">
<button>افزودن رکورد</button></form>
<table><thead><tr><th>نام</th><th>نوع</th><th>مقدار</th><th>TTL</th><th>وضعیت</th><th></th></tr></thead>
<tbody id="rows"></tbody></table></div>
</main>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const TYPES=${JSON.stringify(TYPES)};
$("rType").innerHTML=TYPES.map(t=>'<option>'+t+'</option>').join("");
$("rType").onchange=()=>{$("rPrio").style.display=["MX","SRV"].includes($("rType").value)?"":"none"};
async function api(m,u,b){const r=await fetch(u,{method:m,headers:{"content-type":"application/json"},body:b?JSON.stringify(b):undefined});if(!r.ok)throw new Error((await r.json()).error||r.status);return r.json()}
async function load(){const d=await api("GET","/api/panel");
$("sZones").textContent=d.stats.zoneCount;$("sRecords").textContent=d.stats.recordCount;$("sActive").textContent=d.stats.activeCount;
$("rZone").innerHTML=d.zones.map(z=>'<option value="'+z.id+'">'+esc(z.name)+'</option>').join("");
$("zones").innerHTML=d.zones.map(z=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #334155"><span class="mono"><b>'+esc(z.name)+'</b></span><span>'+z.recordCount+' رکورد <button class="danger" onclick="delZone('+z.id+')">حذف</button></span></div>').join("")||'<p style="opacity:.6">هنوز دامنه‌ای نیست</p>';
$("rows").innerHTML=d.records.map(r=>'<tr'+(r.enabled?'':' style="opacity:.5"')+'><td class="mono">'+esc(r.name==="@"?r.zoneName:r.name+"."+r.zoneName)+'</td><td><span class="badge mono">'+esc(r.type)+'</span></td><td class="mono">'+(r.priority!=null?r.priority+" ":"")+esc(r.content)+'</td><td class="mono">'+r.ttl+'</td><td>'+(r.enabled?"فعال":"غیرفعال")+'</td><td><button class="ghost" onclick="toggleRec('+r.id+','+(!r.enabled)+')">'+(r.enabled?"غیرفعال":"فعال")+'</button> <button class="danger" onclick="delRec('+r.id+')">حذف</button></td></tr>').join("");}
$("zoneForm").onsubmit=async e=>{e.preventDefault();await api("POST","/api/zones",{name:$("zName").value,description:$("zDesc").value});e.target.reset();load()};
$("recForm").onsubmit=async e=>{e.preventDefault();await api("POST","/api/records",{zoneId:+$("rZone").value,type:$("rType").value,name:$("rName").value,content:$("rContent").value,ttl:+$("rTtl").value,priority:+$("rPrio").value});load()};
async function delZone(id){if(confirm("دامنه و همه رکوردهایش حذف شود؟")){await api("DELETE","/api/zones/"+id);load()}}
async function delRec(id){if(confirm("رکورد حذف شود؟")){await api("DELETE","/api/records/"+id);load()}}
async function toggleRec(id,en){await api("POST","/api/records/"+id+"/toggle",{enabled:en});load()}
load();
</script></body></html>`;

server.listen(PORT, () => {
  console.log(`DNS Panel running at http://0.0.0.0:${PORT} (data: ${DATA_FILE})`);
});
