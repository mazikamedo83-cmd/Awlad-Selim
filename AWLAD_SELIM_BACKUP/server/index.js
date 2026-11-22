import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.API_PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
const databaseFile = path.join(dataDir, 'database.json');
fs.mkdirSync(dataDir, { recursive: true });
app.use(cors({ origin: true, methods: ['GET','PUT','POST','OPTIONS'], allowedHeaders: ['Content-Type','X-AWLAD-SYNC-KEY'] }));
app.use(express.json({ limit: '50mb' }));

const syncKey = process.env.AWLAD_SYNC_KEY || '';
function authorize(req, res, next) {
  if (syncKey && req.get('X-AWLAD-SYNC-KEY') !== syncKey) return res.status(401).json({ ok:false, error:'مفتاح مزامنة غير صحيح' });
  next();
}
function readDatabase() {
  if (!fs.existsSync(databaseFile)) return null;
  try { return JSON.parse(fs.readFileSync(databaseFile, 'utf8')); } catch { return null; }
}
app.get('/api/health', (_req, res) => res.json({ ok:true, service:'AWLAD SELIM LAN Server', timestamp:new Date().toISOString(), mode:'persistent-json', database:fs.existsSync(databaseFile)?'ready':'empty' }));
app.get('/api/database', authorize, (_req, res) => {
  const database = readDatabase();
  if (!database) return res.status(404).json({ ok:false, error:'لا توجد قاعدة بيانات مركزية بعد' });
  res.json({ ok:true, database });
});
app.put('/api/database', authorize, (req, res) => {
  const db = req.body?.database;
  if (!db || !Array.isArray(db.users) || !Array.isArray(db.products) || !Array.isArray(db.invoices)) return res.status(400).json({ ok:false, error:'هيكل قاعدة البيانات غير صالح' });
  const tempFile = `${databaseFile}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify({ ...db, serverUpdatedAt:new Date().toISOString() }), 'utf8');
    fs.renameSync(tempFile, databaseFile);
    res.json({ ok:true, savedAt:new Date().toISOString() });
  } catch (error) { res.status(500).json({ ok:false, error:'تعذر حفظ قاعدة البيانات على السيرفر' }); }
});
app.listen(port, '0.0.0.0', () => console.log(`AWLAD SELIM LAN Server listening on 0.0.0.0:${port}`));
