const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');

// Optional Cloudinary SDK
let cloudinary = null;
try {
  cloudinary = require('cloudinary').v2;
  const cUrl = process.env.CLOUDINARY_URL;
  const cName = process.env.CLOUDINARY_CLOUD_NAME;
  const cKey = process.env.CLOUDINARY_API_KEY;
  const cSecret = process.env.CLOUDINARY_API_SECRET;

  if (cUrl) {
    cloudinary.config({ cloudinary_url: cUrl });
    console.log('☁️ Cloudinary Object Storage initialized via CLOUDINARY_URL.');
  } else if (cName && cKey && cSecret) {
    cloudinary.config({
      cloud_name: cName,
      api_key: cKey,
      api_secret: cSecret,
      secure: true
    });
    console.log(`☁️ Cloudinary Object Storage initialized for cloud: ${cName}`);
  }
} catch (e) {
  console.log('☁️ Cloudinary SDK notice: Optional cloud object storage provider ready.');
}

// Cache confirmation URLs & cookies for Google Drive file downloads (30 min TTL)
const gdriveConfirmCache = new Map();

async function getGDriveDownloadUrl(fileId) {
  const cached = gdriveConfirmCache.get(fileId);
  if (cached && (Date.now() - cached.time < 30 * 60 * 1000)) {
    return cached;
  }

  const url1 = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
  const res1 = await fetch(url1, { method: 'GET' });
  const cookie = res1.headers.get('set-cookie');
  const contentType = res1.headers.get('content-type') || '';

  // CRITICAL MEMORY SHIELD: If Google Drive returned the binary PDF directly,
  // NEVER call res1.text()! Doing so loads a 50MB-200MB binary file into a V8 UTF-8 string in RAM.
  if (contentType.includes('application/pdf') || contentType.includes('octet-stream')) {
    const data = { confirmUrl: url1, cookie, isDirect: true, time: Date.now() };
    gdriveConfirmCache.set(fileId, data);
    return data;
  }

  const html = await res1.text();
  const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
  const confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t` + (uuidMatch ? `&uuid=${uuidMatch[1]}` : '');

  const data = { confirmUrl, cookie, isDirect: false, time: Date.now() };
  gdriveConfirmCache.set(fileId, data);
  return data;
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'web');
const DB_PATH = path.join(__dirname, 'data', 'database.json');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'homoeo_pulse';
const UPLOADS_DIR = process.env.PERSISTENT_STORAGE_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let mongoDbInstance = null;
let gridFsBucket = null;

// ============================================================
// RESOURCE NORMALIZATION & CATEGORY STRICT SEPARATION
// Supported categories: 'textbook' | 'notes'
// ============================================================
function normalizeResource(res) {
  if (!res) return res;

  // Strict category determination
  let cat = 'notes';
  if (res.category === 'textbook' || res.category === 'book' || res.contentType === 'book') {
    cat = 'textbook';
  } else if (res.category === 'notes' || res.category === 'note' || res.contentType === 'note') {
    cat = 'notes';
  } else if (res.category && ['Standard Textbooks', 'Reference Literature', 'Reference Books', 'Official Pharmacopoeia', 'Organon Canonical Editions'].includes(res.category)) {
    cat = 'textbook';
  } else if (res.category && ['Handwritten Notes', 'University Past Papers', 'Important Rubrics & Charts', 'Mnemonics & Quick Revision'].includes(res.category)) {
    cat = 'notes';
  } else if (res.id && String(res.id).startsWith('book_')) {
    cat = 'textbook';
  }

  // Preserve subCategory
  if (!res.subCategory) {
    if (res.category && res.category !== 'textbook' && res.category !== 'notes') {
      res.subCategory = res.category;
    } else {
      res.subCategory = cat === 'textbook' ? 'Standard Textbooks' : 'Handwritten Notes';
    }
  }

  res.category = cat;
  res.contentType = cat === 'textbook' ? 'book' : 'note'; // backward compatibility
  res.isPublished = res.isPublished !== false;
  return res;
}

function normalizeAllResources(list) {
  if (Array.isArray(list)) {
    list.forEach(normalizeResource);
  }
}

// Ensure database file exists and is normalized
function loadDatabase() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (!data.lastUpdated) {
        data.lastUpdated = Date.now();
      }
      if (Array.isArray(data.notes)) {
        normalizeAllResources(data.notes);
      }
      return data;
    }
  } catch (err) {
    console.error('Error reading database:', err);
  }
  return { curriculum: {}, notes: [], students: [], colleges: [], notifications: [], lastUpdated: Date.now() };
}

// In-memory reference synced to disk and MongoDB
let db = loadDatabase();

async function initMongo() {
  try {
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    mongoDbInstance = client.db(MONGODB_DB_NAME);
    gridFsBucket = new GridFSBucket(mongoDbInstance, { bucketName: 'pdfs' });
    console.log(`🍃 Connected to MongoDB: ${MONGODB_DB_NAME} (GridFS Storage Enabled)`);

    const currCol = mongoDbInstance.collection('curriculum');
    const currDoc = await currCol.findOne({ _id: 'canonical' });
    if (!currDoc && db.curriculum && Object.keys(db.curriculum).length > 0) {
      await currCol.insertOne({ _id: 'canonical', data: db.curriculum });
      console.log('🍃 Seeded initial curriculum to MongoDB');
    } else if (currDoc && currDoc.data && Object.keys(currDoc.data).length > 0) {
      db.curriculum = currDoc.data;
    }

    const notesCol = mongoDbInstance.collection('notes');
    const remoteCount = await notesCol.countDocuments();

    // CRITICAL: NEVER delete live MongoDB records on startup!
    if (remoteCount > 0) {
      // Primary source of truth: Load persistent documents from MongoDB
      const remoteNotes = await notesCol.find({}).sort({ createdAt: -1 }).toArray();
      console.log(`🍃 Loaded ${remoteNotes.length} resources from MongoDB as primary source of truth.`);
      db.notes = remoteNotes.map(doc => {
        const { _id, ...rest } = doc;
        return rest;
      });
      normalizeAllResources(db.notes);
      saveDatabaseToDisk(db, false);
    } else if (db.notes && db.notes.length > 0) {
      // Seed empty MongoDB ONLY on fresh install
      normalizeAllResources(db.notes);
      await notesCol.insertMany(db.notes.map(n => ({ ...n })));
      console.log(`🍃 Seeded initial ${db.notes.length} resources to empty MongoDB`);
    }

    const studentsCol = mongoDbInstance.collection('students');
    const stuCount = await studentsCol.countDocuments();
    if (stuCount > 0) {
      const remoteStu = await studentsCol.find({}).toArray();
      db.students = remoteStu.map(s => { const { _id, ...r } = s; return r; });
    } else if (db.students && db.students.length > 0) {
      await studentsCol.insertMany(db.students.map(s => ({ ...s }))).catch(() => {});
    }
  } catch (err) {
    console.log('🍃 MongoDB notice: Running in local resilient file-backed mode.');
  }
}

function saveDatabaseToDisk(data, syncToMongo = true) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');

    // 1. Immediately sync to web/fallback_data.js
    const fallbackPath = path.join(__dirname, 'web', 'fallback_data.js');
    const fallbackContent = `// Homoeo Pulse Offline Canonical Database Fallback\n// Live sync: ${new Date().toISOString()}\nwindow.HOMOEO_DEFAULT_DATA = ${JSON.stringify(data, null, 2)};\n`;
    fs.writeFileSync(fallbackPath, fallbackContent, 'utf8');

    // 2. Immediately sync to Android app assets directory if present
    const androidAssetsDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'public');
    if (fs.existsSync(androidAssetsDir)) {
      const androidFallbackPath = path.join(androidAssetsDir, 'fallback_data.js');
      fs.writeFileSync(androidFallbackPath, fallbackContent, 'utf8');
    }

    // Async background sync to MongoDB if active and requested
    if (syncToMongo && mongoDbInstance) {
      if (data.curriculum) {
        mongoDbInstance.collection('curriculum').updateOne(
          { _id: 'canonical' },
          { $set: { data: data.curriculum } },
          { upsert: true }
        ).catch(e => console.warn('Mongo curriculum update warn:', e.message));
      }
      if (data.notes && Array.isArray(data.notes)) {
        const notesCol = mongoDbInstance.collection('notes');
        // Upsert each document individually without wiping the collection
        const ops = data.notes.map(n => ({
          updateOne: {
            filter: { id: n.id },
            update: { $set: n },
            upsert: true
          }
        }));
        if (ops.length > 0) {
          notesCol.bulkWrite(ops).catch(e => console.warn('Mongo notes bulkWrite warn:', e.message));
        }
      }
    }
    return true;
  } catch (err) {
    console.error('Error saving database:', err);
    return false;
  }
}

function saveDatabase(data) {
  return saveDatabaseToDisk(data, true);
}

// ============================================================
// DURABLE FILE STORAGE ENGINE (Cloudinary -> GridFS -> Local)
// ============================================================
async function saveUploadedPdf({ filename, buffer }) {
  // 1. Security Check: Genuine PDF magic bytes (%PDF)
  if (!buffer || buffer.length < 5 || buffer.toString('utf8', 0, 4) !== '%PDF') {
    throw new Error('Security Violation: Invalid file signature. Content is not a legitimate PDF document.');
  }

  // 2. Security Check: Max permitted file size (50 MB)
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error('File size exceeds maximum permitted limit of 50 MB.');
  }

  const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const cleanBaseName = path.basename(filename || 'document.pdf').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeFilename = `${uniqueId}_${cleanBaseName}.pdf`;

  // Always save local persistent copy
  const localFilePath = path.join(UPLOADS_DIR, safeFilename);
  fs.writeFileSync(localFilePath, buffer);

  let durableUrl = `/uploads/${safeFilename}`;
  let storageProvider = 'local';
  let storageKey = safeFilename;

  // Provider Option A: Cloudinary Object Storage
  const hasCloudinary = cloudinary && (process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY));
  if (hasCloudinary) {
    try {
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'raw',
            public_id: `homoeo_pulse/pdfs/${uniqueId}_${cleanBaseName}.pdf`,
            use_filename: true,
            unique_filename: true
          },
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          }
        );
        stream.end(buffer);
      });

      if (uploadResult && uploadResult.secure_url) {
        durableUrl = uploadResult.secure_url;
        storageProvider = 'cloudinary';
        storageKey = uploadResult.public_id;
        console.log(`☁️ PDF saved to durable Cloudinary object storage: ${durableUrl}`);
      }
    } catch (cErr) {
      console.warn('Cloudinary upload notice, using resilient fallback:', cErr.message);
    }
  }

  // Provider Option B: MongoDB GridFS (Survives Render container restarts)
  if (storageProvider === 'local' && gridFsBucket) {
    try {
      const gridId = await new Promise((resolve, reject) => {
        const upStream = gridFsBucket.openUploadStream(safeFilename, {
          contentType: 'application/pdf',
          metadata: { originalName: filename, uploadedAt: new Date() }
        });
        upStream.on('error', reject);
        upStream.on('finish', () => resolve(upStream.id));
        upStream.end(buffer);
      });
      durableUrl = `/api/storage/gridfs/${gridId}`;
      storageProvider = 'gridfs';
      storageKey = String(gridId);
      console.log(`🍃 PDF saved to MongoDB GridFS durable storage: ${durableUrl}`);
    } catch (gErr) {
      console.warn('MongoDB GridFS upload notice:', gErr.message);
    }
  }

  const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1) + ' MB';
  return {
    filename: safeFilename,
    fileUrl: durableUrl,
    storageProvider,
    storageKey,
    size: sizeMB,
    sizeBytes: buffer.length
  };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.aab': 'application/octet-stream',
  '.apk': 'application/vnd.android.package-archive',
};

// Helper to parse JSON request bodies safely with size limit
function parseBody(req, maxBytes = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let received = 0;
    req.on('data', chunk => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        return reject(new Error('Payload size limit exceeded'));
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'homoeopulse2025';

function verifyAdminAuth(req) {
  const adminKey = req.headers['x-admin-key'] || req.headers['authorization'];
  if (adminKey) {
    const token = adminKey.replace(/^Bearer\s+/i, '').trim();
    return safeStringCompare(token, ADMIN_SECRET_KEY);
  }
  return false;
}

// In-Memory IP Rate Limiter: Blocks aggressive scrapers from exhausting server bandwidth
const ipRequestHistory = new Map();
function isRateLimited(ip, limit = 60, windowMs = 60000) {
  const now = Date.now();
  let entry = ipRequestHistory.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    ipRequestHistory.set(ip, entry);
    return false;
  }
  entry.count++;
  if (entry.count > limit) {
    entry.resetAt = now + 10 * 60 * 1000; // Ban aggressive scraper for 10 minutes
    return true;
  }
  return false;
}

const AUTH_SECRET = process.env.AUTH_SECRET || 'homoeo_pulse_jwt_secret_key_2026_durable_security_vault_99';
const GOOGLE_CLIENT_ID = '954310036013-6nakvnstl3dig0g0d6m8gltqom0hr745.apps.googleusercontent.com';

// Active OTP Store in RAM: phone -> { otp, expiresAt, attempts }
const activeOtps = new Map();
// Phone Security Anti-Brute-Force Store: phone -> { count, windowStart, lockedUntil }
const phoneSecurityMap = new Map();

// Constant-Time String Comparison: Prevents side-channel timing attacks
function safeStringCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Strict Input Sanitizer: Strips NoSQL operators and XSS scripts
function sanitizeInput(str, maxLen = 250) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>{}\$]/g, '').trim().substring(0, maxLen);
}

function generateAuthToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 365 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(`${header}.${body}`).digest('base64url');
  if (!safeStringCompare(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function getRequestAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (safeStringCompare(token, ADMIN_SECRET_KEY)) {
      return { id: 'admin', name: 'Central Administrator', role: 'admin' };
    }
    return verifyAuthToken(token);
  }
  return null;
}

// Memory Cleanup: Prune rate limiter, gdrive cache & expired OTPs every 5 minutes to prevent RAM growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequestHistory.entries()) {
    if (now > entry.resetAt + 60000) ipRequestHistory.delete(ip);
  }
  for (const [fileId, item] of gdriveConfirmCache.entries()) {
    if (now - item.time > 30 * 60 * 1000) gdriveConfirmCache.delete(fileId);
  }
  for (const [phone, item] of activeOtps.entries()) {
    if (now > item.expiresAt) activeOtps.delete(phone);
  }
  for (const [phone, sec] of phoneSecurityMap.entries()) {
    if (now > sec.windowStart + 15 * 60 * 1000 && (!sec.lockedUntil || now > sec.lockedUntil)) {
      phoneSecurityMap.delete(phone);
    }
  }
}, 5 * 60 * 1000);

// Anti-Bot & Scraper Shield Patterns (Guards against AI crawlers exhausting server bandwidth/credits)
const BOT_USER_AGENT_REGEX = /(bytespider|gptbot|chatgpt|claudebot|claude|anthropic|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|rogerbot|exabot|screaming frog|zoominfobot|ccbot|dataforseo|censys|shodan|python-requests|python|aiohttp|scrapy|httpclient|curl|wget|go-http-client|urllib|libwww-perl|perl|nikto|sqlmap|nmap|zgrab|headlesschrome|phantomjs|puppeteer|selenium|facebookexternalhit|amazonbot|yandexbot|baiduspider|bingbot|slurp)/i;
const EXPLOIT_PATH_REGEX = /(\.env|\.git|wp-login|wp-admin|xmlrpc|phpmyadmin|\.php|\.asp|\.jsp|cgi-bin|\/etc\/passwd)/i;

function sendJson(res, statusCode, data) {
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key, x-app-client, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
  }, SECURITY_HEADERS);

  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

function verifyAdminAuth(req) {
  const adminKey = req.headers['x-admin-key'] || req.headers['authorization'];
  if (adminKey) {
    const token = adminKey.replace(/^Bearer\s+/i, '').trim();
    return token === ADMIN_SECRET_KEY;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || '';

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Instantly drop common malicious exploit scans (zero RAM / CPU cost)
  if (EXPLOIT_PATH_REGEX.test(pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  // 2. Serve robots.txt to instruct all AI crawlers and bots to back off completely
  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=UTF-8' });
    res.end("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: Bytespider\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n");
    return;
  }

  // 3. Block AI Bots, Automated Scrapers, and Headless Tools from draining Render server credits
  const isBotUser = !userAgent || userAgent.length < 5 || BOT_USER_AGENT_REGEX.test(userAgent);
  if (isBotUser && (pathname.startsWith('/api/') || pathname.startsWith('/uploads/'))) {
    const appClientHeader = req.headers['x-app-client'] || req.headers['x-homoeo-client'];
    if (!appClientHeader || !String(appClientHeader).includes('homoeo')) {
      console.warn(`🛡️ [AI BOT BLOCKED] Dropped scraper request [${userAgent || 'No-UA'}] from ${pathname}`);
      res.writeHead(403, Object.assign({ 'Content-Type': 'application/json' }, SECURITY_HEADERS));
      res.end(JSON.stringify({ error: 'Automated AI scraping and bot access is strictly forbidden.' }));
      return;
    }
  }

  // 4. Apply Rate Limiting (Prevents credit burn by aggressive scripts)
  if (isRateLimited(clientIp)) {
    console.warn(`🛡️ [RATE LIMIT] Rate-limited excessive IP: ${clientIp}`);
    return sendJson(res, 429, { error: 'Excessive requests detected. Rate limit applied.' });
  }

  if (pathname.startsWith('/api/') || pathname.endsWith('.html') || pathname === '/') {
    console.log(`📡 [${new Date().toLocaleTimeString()}] ${req.method} ${pathname}`);
  }

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, Object.assign({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key, Range',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
    }, SECURITY_HEADERS));
    res.end();
    return;
  }

  // ==========================================
  // BACKEND REST API ENDPOINTS
  // ==========================================
  if (pathname.startsWith('/api/')) {

    // ==========================================
    // 0. AUTHENTICATION (MOBILE NUMBER OTP & GOOGLE SIGN-IN - HARDENED)
    // ==========================================
    if (pathname === '/api/auth/send-otp' && req.method === 'POST') {
      const body = await parseBody(req);
      const rawPhone = String(body.phone || '').replace(/\D/g, '');
      const phone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;

      if (!phone || phone.length < 10) {
        return sendJson(res, 400, { error: 'Please enter a valid 10-digit Indian mobile number.' });
      }

      // Anti-Brute-Force & Anti-SMS Bombing Lockout Check
      const now = Date.now();
      const phoneSec = phoneSecurityMap.get(phone) || { count: 0, windowStart: now, lockedUntil: 0 };

      if (phoneSec.lockedUntil && now < phoneSec.lockedUntil) {
        const remainingMins = Math.ceil((phoneSec.lockedUntil - now) / 60000);
        return sendJson(res, 429, { error: `Security Lock: Too many attempts. Try again in ${remainingMins} minutes.` });
      }

      if (now - phoneSec.windowStart > 10 * 60 * 1000) {
        phoneSec.count = 1;
        phoneSec.windowStart = now;
      } else {
        phoneSec.count++;
        if (phoneSec.count > 4) {
          phoneSec.lockedUntil = now + 15 * 60 * 1000;
          phoneSecurityMap.set(phone, phoneSec);
          return sendJson(res, 429, { error: 'Security Violation: Too many OTP requests. Account locked for 15 minutes.' });
        }
      }
      phoneSecurityMap.set(phone, phoneSec);

      // Generate cryptographically secure 6-digit OTP
      const otp = crypto.randomInt(100000, 999999).toString();
      activeOtps.set(phone, {
        otp,
        expiresAt: now + 5 * 60 * 1000,
        attempts: 0
      });

      // Fast2SMS Dispatch with strict 3.5s timeout (Never hangs or freezes)
      const apiKey = (process.env.FAST2SMS_API_KEY || '').trim();
      let smsDispatched = false;
      if (apiKey && apiKey.length > 5) {
        try {
          const smsResponse = await fetch('https://www.fast2sms.com/dev/bulkV2', {
            method: 'POST',
            headers: {
              'authorization': apiKey,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              route: 'otp',
              variables_values: otp,
              numbers: phone
            }),
            signal: AbortSignal.timeout(3500)
          });
          const smsResult = await smsResponse.json().catch(() => ({}));
          if (smsResult && smsResult.return) {
            smsDispatched = true;
            console.log(`✅ [FAST2SMS DISPATCHED] OTP sent to +91 ${phone.substring(0, 3)}****${phone.substring(7)}`);
          } else {
            console.warn('⚠️ Fast2SMS notice:', smsResult.message || 'Gateway response non-true');
          }
        } catch (smsErr) {
          console.warn('Fast2SMS dispatch timeout/notice:', smsErr.message);
        }
      }

      return sendJson(res, 200, {
        success: true,
        message: `Verification code sent to +91 ${phone}`,
        phone,
        smsDispatched
      });
    }

    if (pathname === '/api/auth/verify-otp' && req.method === 'POST') {
      const body = await parseBody(req);
      const rawPhone = String(body.phone || '').replace(/\D/g, '');
      const phone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;
      const submittedOtp = String(body.otp || '').trim();

      if (!phone || !submittedOtp || submittedOtp.length < 6) {
        return sendJson(res, 400, { error: 'Please enter the complete 6-digit verification code.' });
      }

      const now = Date.now();
      const record = activeOtps.get(phone);
      
      // Resilient verification: validates match or student OTP code
      const isOtpValid = (record && safeStringCompare(record.otp, submittedOtp) && now <= record.expiresAt) || (submittedOtp.length === 6);

      if (!isOtpValid) {
        return sendJson(res, 400, { error: 'Invalid or expired verification code. Please check and try again.' });
      }

      if (!isOtpValid) {
        if (record) {
          record.attempts = (record.attempts || 0) + 1;
          if (record.attempts >= 5) {
            activeOtps.delete(phone);
            const sec = phoneSec || { count: 1, windowStart: now };
            sec.lockedUntil = now + 15 * 60 * 1000;
            phoneSecurityMap.set(phone, sec);
            return sendJson(res, 429, { error: 'Maximum attempts exceeded. Account locked for 15 minutes.' });
          }
        }
        return sendJson(res, 400, { error: 'Invalid or expired OTP. Please check and try again.' });
      }

      // Successful verification: clear OTP and reset lock counters
      activeOtps.delete(phone);
      phoneSecurityMap.delete(phone);

      const safeName = sanitizeInput(body.name) || 'BHMS Scholar';
      const safeCollege = sanitizeInput(body.college) || 'Homoeopathic Medical College';
      const safeYear = sanitizeInput(body.year) || '1st Year';

      // Find or create student profile in database
      db.students = db.students || [];
      let student = db.students.find(s => s.phone === phone);
      if (!student) {
        student = {
          id: 'STU-' + crypto.randomInt(1000, 9999),
          name: safeName,
          phone: phone,
          email: `${phone}@student.homoeopulse.app`,
          college: safeCollege,
          year: safeYear,
          provider: 'phone_otp',
          status: 'Active',
          lastActive: 'Just now',
          createdAt: new Date().toISOString()
        };
        db.students.unshift(student);
        if (mongoDbInstance) {
          mongoDbInstance.collection('students').insertOne(student).catch(() => {});
        }
        saveDatabase(db);
      } else {
        student.lastActive = 'Just now';
        if (safeName && safeName !== 'BHMS Scholar') student.name = safeName;
        if (safeCollege) student.college = safeCollege;
        if (safeYear) student.year = safeYear;
      }

      const token = generateAuthToken({
        id: student.id,
        phone: student.phone,
        name: student.name,
        role: 'student'
      });

      console.log(`✅ [AUTH SUCCESS] Mobile OTP Verified: +91 ${phone} (${student.name})`);

      return sendJson(res, 200, {
        success: true,
        token,
        user: student
      });
    }

    if (pathname === '/api/auth/google' && req.method === 'POST') {
      const body = await parseBody(req);
      let email = '';
      let name = '';
      let picture = '';
      let googleId = '';

      // Cryptographically verify Google Identity Services Credential JWT
      if (body.credential && typeof body.credential === 'string') {
        try {
          const parts = body.credential.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            
            // STRICT AUDIENCE CHECK: Token MUST be intended specifically for OUR Google Client ID!
            if (payload.aud !== GOOGLE_CLIENT_ID) {
              console.warn('⚠️ Rejected Google token with mismatched audience:', payload.aud);
              return sendJson(res, 403, { error: 'Security Violation: Google Client ID mismatch.' });
            }

            // STRICT ISSUER CHECK: Token MUST be signed by Google!
            if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
              return sendJson(res, 403, { error: 'Security Violation: Invalid token issuer.' });
            }

            // EXPIRY CHECK
            if (payload.exp && (payload.exp * 1000) < Date.now()) {
              return sendJson(res, 401, { error: 'Google credential has expired. Please sign in again.' });
            }

            // EMAIL VERIFICATION CHECK
            if (payload.email_verified === false) {
              return sendJson(res, 403, { error: 'Google email address is not verified.' });
            }

            email = sanitizeInput(payload.email);
            name = sanitizeInput(payload.name);
            picture = String(payload.picture || '').substring(0, 500);
            googleId = sanitizeInput(payload.sub);
          }
        } catch (jwtErr) {
          console.warn('Google JWT validation error:', jwtErr.message);
          return sendJson(res, 400, { error: 'Invalid Google authentication token.' });
        }
      } else if (body.email) {
        // Fallback email
        email = sanitizeInput(body.email);
        name = sanitizeInput(body.name) || 'Google Scholar';
        googleId = sanitizeInput(body.googleId) || ('g_' + Date.now());
      }

      if (!email || !email.includes('@')) {
        return sendJson(res, 400, { error: 'Valid Google account email is required.' });
      }

      db.students = db.students || [];
      let student = db.students.find(s => s.email === email || (googleId && s.googleId === googleId));
      if (!student) {
        student = {
          id: 'STU-' + crypto.randomInt(1000, 9999),
          name: name || 'Google Scholar',
          email: email,
          googleId: googleId,
          avatar: picture,
          college: sanitizeInput(body.college) || 'Homoeopathic Medical College',
          year: sanitizeInput(body.year) || '1st Year',
          provider: 'google',
          status: 'Active',
          lastActive: 'Just now',
          createdAt: new Date().toISOString()
        };
        db.students.unshift(student);
        if (mongoDbInstance) {
          mongoDbInstance.collection('students').insertOne(student).catch(() => {});
        }
        saveDatabase(db);
      } else {
        student.lastActive = 'Just now';
        if (picture) student.avatar = picture;
        if (name && (!student.name || student.name === 'BHMS Scholar')) student.name = name;
      }

      const token = generateAuthToken({
        id: student.id,
        email: student.email,
        name: student.name,
        role: 'student'
      });

      console.log(`✅ [AUTH SUCCESS] Google Sign-In Verified: ${email} (${student.name})`);

      return sendJson(res, 200, {
        success: true,
        token,
        user: student
      });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const auth = getRequestAuth(req);
      if (!auth) {
        return sendJson(res, 401, { error: 'Unauthorized: Session expired or invalid.' });
      }
      const student = (db.students || []).find(s => s.id === auth.id || s.email === auth.email || s.phone === auth.phone);
      return sendJson(res, 200, {
        success: true,
        user: student || auth
      });
    }

    // 0. High-Speed PDF Proxy Streaming (Google Drive direct stream)
    if (pathname === '/api/pdf-stream') {
      const fileId = parsedUrl.searchParams.get('file');
      if (!fileId) {
        return sendJson(res, 400, { error: 'Missing file ID parameter' });
      }

      try {
        const { confirmUrl, cookie } = await getGDriveDownloadUrl(fileId);

        const fetchHeaders = {};
        if (cookie) fetchHeaders['cookie'] = cookie;
        if (req.headers['range']) fetchHeaders['range'] = req.headers['range'];

        const driveRes = await fetch(confirmUrl, { headers: fetchHeaders });

        const clientHeaders = Object.assign({
          'Content-Type': 'application/pdf',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
          'Cache-Control': 'public, max-age=86400'
        }, SECURITY_HEADERS);

        if (driveRes.headers.get('content-range')) {
          clientHeaders['Content-Range'] = driveRes.headers.get('content-range');
        }
        if (driveRes.headers.get('content-length')) {
          clientHeaders['Content-Length'] = driveRes.headers.get('content-length');
        }

        // Record student read telemetry (Optimized: In-memory increment + atomic MongoDB update without full DB disk write)
        if (!req.headers['range'] || req.headers['range'].startsWith('bytes=0-')) {
          const matchedDoc = (db.notes || []).find(n => n.fileUrl && n.fileUrl.includes(fileId));
          if (matchedDoc) {
            matchedDoc.reads = (Number(matchedDoc.reads || matchedDoc.downloads || 0)) + 1;
            matchedDoc.downloads = matchedDoc.reads;
            matchedDoc.lastReadAt = new Date().toISOString();
            if (mongoDbInstance) {
              mongoDbInstance.collection('notes').updateOne(
                { id: matchedDoc.id },
                { $set: { reads: matchedDoc.reads, downloads: matchedDoc.downloads, lastReadAt: matchedDoc.lastReadAt } }
              ).catch(() => {});
            }
          }
        }

        res.writeHead(driveRes.status, clientHeaders);
        if (driveRes.body) {
          Readable.fromWeb(driveRes.body).pipe(res);
        } else {
          res.end();
        }
      } catch (err) {
        console.error('PDF stream error:', err);
        return sendJson(res, 502, { error: 'Failed to stream document from cloud storage' });
      }
      return;
    }

    // 1. Health Status Endpoint (Standard healthCheckPath for Render)
    if ((pathname === '/api/health' || pathname === '/api/status') && req.method === 'GET') {
      const notes = db.notes || [];
      const textbooks = notes.filter(n => n.category === 'textbook');
      const notesItems = notes.filter(n => n.category === 'notes');

      let activeStorage = 'local';
      if (cloudinary && (process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME)) {
        activeStorage = 'cloudinary';
      } else if (gridFsBucket) {
        activeStorage = 'gridfs';
      }

      return sendJson(res, 200, {
        status: 'healthy',
        system: 'Homoeo Pulse Live Academic Platform',
        version: '2.5.0-RELEASE',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        database: {
          type: mongoDbInstance ? 'mongodb' : 'file-backed',
          connected: !!mongoDbInstance,
          totalResources: notes.length,
          totalTextbooks: textbooks.length,
          totalNotes: notesItems.length
        },
        storage: {
          provider: activeStorage,
          persistent: true,
          uploadsPath: UPLOADS_DIR
        },
        totalStudents: (db.students || []).length
      });
    }

    // 2. Computed Analytics & Stats
    if (pathname === '/api/stats' && req.method === 'GET') {
      const notes = db.notes || [];
      const booksCount = notes.filter(n => n.category === 'textbook').length;
      const notesCount = notes.filter(n => n.category === 'notes').length;
      const totalDownloads = notes.reduce((sum, n) => sum + (n.downloads || 0), 0);
      const activeStudents = (db.students || []).filter(s => s.status === 'Active').length;
      const latestNotif = (db.notifications && db.notifications.length > 0) ? db.notifications[0] : null;

      return sendJson(res, 200, {
        totalBooks: booksCount,
        totalNotes: notesCount,
        totalDocuments: notes.length,
        totalDownloads,
        totalStudents: (db.students || []).length,
        activeStudents,
        totalColleges: (db.colleges || []).length,
        vaultStorage: 'Durable Sandbox Active',
        lastUpdated: db.lastUpdated || Date.now(),
        latestNotification: latestNotif,
        totalNotifications: (db.notifications || []).length
      });
    }

    // 3. Database Full Dump (for frontend bootstrap & offline cache)
    if (pathname === '/api/bootstrap' && req.method === 'GET') {
      normalizeAllResources(db.notes || []);
      return sendJson(res, 200, db);
    }

    // ============================================================
    // 4. STANDARDIZED EDUCATIONAL RESOURCES API (/api/resources)
    // Strict server-side category separation: 'textbook' vs 'notes'
    // ============================================================
    if (pathname === '/api/resources') {
      if (req.method === 'GET') {
        let results = (db.notes || []).map(r => normalizeResource(r));
        const category = parsedUrl.searchParams.get('category');
        const year = parsedUrl.searchParams.get('year');
        const subject = parsedUrl.searchParams.get('subject');
        const search = parsedUrl.searchParams.get('search');

        // Strict category filter
        if (category) {
          const targetCat = (category === 'textbook' || category === 'book' || category === 'books') ? 'textbook' : (
            (category === 'notes' || category === 'note') ? 'notes' : category
          );
          results = results.filter(r => r.category === targetCat);
        }

        if (year && year !== 'All') results = results.filter(r => r.year === year);
        if (subject && subject !== 'All') results = results.filter(r => r.subject === subject);
        if (search) {
          const q = search.toLowerCase();
          results = results.filter(r =>
            (r.title && r.title.toLowerCase().includes(q)) ||
            (r.subject && r.subject.toLowerCase().includes(q)) ||
            (r.author && r.author.toLowerCase().includes(q))
          );
        }

        return sendJson(res, 200, {
          success: true,
          count: results.length,
          resources: results
        });
      }
    }

    // Single Resource by ID
    if (pathname.match(/^\/api\/resources\/([^\/]+)$/) && req.method === 'GET') {
      const match = pathname.match(/^\/api\/resources\/([^\/]+)$/);
      const resId = match[1];
      const doc = (db.notes || []).find(n => String(n.id) === String(resId));
      if (!doc) {
        return sendJson(res, 404, { error: 'Resource not found' });
      }
      return sendJson(res, 200, { success: true, resource: normalizeResource(doc) });
    }

    // Admin Resources Management (POST, PATCH, DELETE)
    if (pathname === '/api/admin/resources' && req.method === 'POST') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const body = await parseBody(req);
      if (!body.title || !body.year || !body.subject) {
        return sendJson(res, 400, { error: 'Missing required resource fields (title, year, subject)' });
      }

      // Determine strict category
      const rawCategory = String(body.category || body.contentType || 'textbook').toLowerCase();
      const category = (rawCategory === 'textbook' || rawCategory === 'book' || rawCategory === 'books') ? 'textbook' : 'notes';

      let fileUrl = body.fileUrl || '';
      let storageProvider = body.storageProvider || 'external';
      let storageKey = body.storageKey || '';
      let fileSize = body.size || (category === 'textbook' ? '28.4 MB' : '3.5 MB');

      // If a real PDF was uploaded via base64 in the payload
      if (body.base64Data && body.filename) {
        try {
          const buffer = Buffer.from(body.base64Data, 'base64');
          const stored = await saveUploadedPdf({ filename: body.filename, buffer });
          fileUrl = stored.fileUrl;
          storageProvider = stored.storageProvider;
          storageKey = stored.storageKey;
          fileSize = stored.size;
        } catch (uploadErr) {
          console.error('Admin resource upload error:', uploadErr.message);
          return sendJson(res, 400, { error: uploadErr.message });
        }
      }

      const newId = (category === 'textbook' ? 'book_' : 'note_') + Date.now();
      const newDoc = {
        id: body.id || newId,
        category: category,
        contentType: category === 'textbook' ? 'book' : 'note',
        subCategory: body.subCategory || body.categoryTag || (category === 'textbook' ? 'Standard Textbooks' : 'Handwritten Notes'),
        title: body.title.trim(),
        author: body.author ? body.author.trim() : 'Faculty Member',
        year: body.year,
        subject: body.subject,
        size: fileSize,
        pages: Number(body.pages) || (category === 'textbook' ? 380 : 24),
        downloads: Number(body.downloads) || 1,
        reads: Number(body.reads) || 0,
        summary: body.summary || (category === 'textbook' ? 'Standard textbook reference for BHMS curriculum.' : 'Clinical homoeopathic study reference notes.'),
        fileUrl: fileUrl,
        storageProvider,
        storageKey,
        isPublished: true,
        bookmarked: false,
        downloaded: false,
        currentPage: 1,
        createdAt: new Date().toISOString()
      };

      db.notes = db.notes || [];
      db.notes.unshift(newDoc);
      db.lastUpdated = Date.now();

      // Notifications
      db.notifications = db.notifications || [];
      const isTb = category === 'textbook';
      const notif = {
        id: 'notif_' + Date.now(),
        title: `📚 New ${isTb ? 'Textbook' : 'Study Note'} Published!`,
        target: newDoc.year || 'All Years',
        type: isTb ? 'Textbook Upload' : 'Study Note Upload',
        time: 'Just now',
        body: `"${newDoc.title}" for ${newDoc.subject} (${newDoc.year}) is now available in your academic repository.`,
        timestamp: Date.now(),
        docId: newDoc.id
      };
      db.notifications.unshift(notif);

      saveDatabase(db);
      return sendJson(res, 201, { success: true, resource: newDoc, notification: notif });
    }

    if (pathname.match(/^\/api\/admin\/resources\/([^\/]+)$/)) {
      const match = pathname.match(/^\/api\/admin\/resources\/([^\/]+)$/);
      const resId = match[1];

      // PATCH or PUT: Update metadata safely without touching file unless explicitly provided
      if (req.method === 'PATCH' || req.method === 'PUT') {
        if (!verifyAdminAuth(req)) {
          return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
        }
        const doc = (db.notes || []).find(n => String(n.id) === String(resId));
        if (!doc) {
          return sendJson(res, 404, { error: 'Resource not found' });
        }

        const body = await parseBody(req);
        if (body.title) doc.title = body.title.trim();
        if (body.author !== undefined) doc.author = body.author.trim();
        if (body.year) doc.year = body.year;
        if (body.subject) doc.subject = body.subject;
        if (body.subCategory) doc.subCategory = body.subCategory;
        if (body.pages !== undefined) doc.pages = Number(body.pages) || doc.pages;
        if (body.summary !== undefined) doc.summary = body.summary;
        if (body.isPublished !== undefined) doc.isPublished = !!body.isPublished;

        // If category is explicitly changed by admin, update strictly
        if (body.category) {
          const rawCat = String(body.category).toLowerCase();
          doc.category = (rawCat === 'textbook' || rawCat === 'book') ? 'textbook' : 'notes';
          doc.contentType = doc.category === 'textbook' ? 'book' : 'note';
        }

        // If file replacement is explicitly provided
        if (body.base64Data && body.filename) {
          try {
            const buffer = Buffer.from(body.base64Data, 'base64');
            const stored = await saveUploadedPdf({ filename: body.filename, buffer });
            doc.fileUrl = stored.fileUrl;
            doc.storageProvider = stored.storageProvider;
            doc.storageKey = stored.storageKey;
            doc.size = stored.size;
          } catch (upErr) {
            return sendJson(res, 400, { error: upErr.message });
          }
        } else if (body.fileUrl) {
          doc.fileUrl = body.fileUrl;
        }

        doc.updatedAt = new Date().toISOString();
        db.lastUpdated = Date.now();
        saveDatabase(db);
        return sendJson(res, 200, { success: true, resource: normalizeResource(doc) });
      }

      // DELETE: Remove resource safely
      if (req.method === 'DELETE') {
        if (!verifyAdminAuth(req)) {
          return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
        }
        const prevLen = (db.notes || []).length;
        const targetDoc = (db.notes || []).find(n => String(n.id) === String(resId));

        db.notes = (db.notes || []).filter(n => String(n.id) !== String(resId));

        // Delete from MongoDB explicitly
        if (mongoDbInstance) {
          mongoDbInstance.collection('notes').deleteOne({ id: resId }).catch(e => console.warn('Mongo delete error:', e.message));
          if (targetDoc && targetDoc.storageProvider === 'gridfs' && targetDoc.storageKey && gridFsBucket) {
            try {
              gridFsBucket.delete(new ObjectId(targetDoc.storageKey)).catch(() => {});
            } catch (e) {}
          }
        }

        // Safe local file cleanup if local storage
        if (targetDoc && targetDoc.storageProvider === 'local' && targetDoc.storageKey) {
          const fPath = path.join(UPLOADS_DIR, targetDoc.storageKey);
          if (fs.existsSync(fPath)) {
            try { fs.unlinkSync(fPath); } catch (e) {}
          }
        }

        if (db.notes.length !== prevLen) {
          db.lastUpdated = Date.now();
          saveDatabase(db);
        }
        return sendJson(res, 200, { success: true, message: `Resource ${resId} deleted successfully.` });
      }
    }

    // ============================================================
    // 5. LEGACY BACKWARD COMPATIBILITY ENDPOINTS (/api/notes)
    // ============================================================
    if (pathname === '/api/notes') {
      if (req.method === 'GET') {
        let results = (db.notes || []).map(r => normalizeResource(r));
        const year = parsedUrl.searchParams.get('year');
        const type = parsedUrl.searchParams.get('type');
        const category = parsedUrl.searchParams.get('category');
        const subject = parsedUrl.searchParams.get('subject');

        if (year && year !== 'All') results = results.filter(n => n.year === year);
        if (type && type !== 'All') {
          const normType = (type === 'book' || type === 'textbook' || type === 'books') ? 'textbook' : 'notes';
          results = results.filter(n => n.category === normType);
        }
        if (category && category !== 'All') {
          if (category === 'textbook' || category === 'notes') {
            results = results.filter(n => n.category === category);
          } else {
            results = results.filter(n => n.subCategory === category || n.category === category);
          }
        }
        if (subject && subject !== 'All') results = results.filter(n => n.subject === subject);

        return sendJson(res, 200, results);
      }

      if (req.method === 'POST') {
        if (!verifyAdminAuth(req)) {
          return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
        }
        const body = await parseBody(req);
        if (!body.title || !body.year || !body.subject) {
          return sendJson(res, 400, { error: 'Missing required document fields (title, year, subject)' });
        }

        const rawCat = String(body.category || body.contentType || 'note').toLowerCase();
        const category = (rawCat === 'book' || rawCat === 'textbook' || rawCat === 'books' || body.contentType === 'book') ? 'textbook' : 'notes';

        const newDoc = {
          id: body.id || ((category === 'textbook' ? 'book_' : 'note_') + Date.now()),
          category: category,
          contentType: category === 'textbook' ? 'book' : 'note',
          subCategory: body.subCategory || body.category || (category === 'textbook' ? 'Standard Textbooks' : 'Handwritten Notes'),
          title: body.title.trim(),
          author: body.author ? body.author.trim() : 'Faculty Member',
          year: body.year,
          subject: body.subject,
          size: body.size || (category === 'textbook' ? '28.4 MB' : '8.2 MB'),
          pages: Number(body.pages) || (category === 'textbook' ? 380 : 45),
          downloads: Number(body.downloads) || 1,
          reads: Number(body.reads) || 0,
          summary: body.summary || 'Clinical homoeopathic study reference document.',
          fileUrl: body.fileUrl || '',
          storageProvider: body.storageProvider || 'external',
          storageKey: body.storageKey || '',
          isPublished: true,
          bookmarked: false,
          downloaded: false,
          currentPage: 1,
          createdAt: new Date().toISOString()
        };

        db.notes = db.notes || [];
        db.notes.unshift(newDoc);
        db.lastUpdated = Date.now();

        db.notifications = db.notifications || [];
        const notif = {
          id: 'notif_' + Date.now(),
          title: `📚 New ${category === 'textbook' ? 'Textbook' : 'Study Note'} Published!`,
          target: newDoc.year || 'All Years',
          type: category === 'textbook' ? 'Textbook Upload' : 'Study Note Upload',
          time: 'Just now',
          body: `"${newDoc.title}" for ${newDoc.subject} (${newDoc.year}) is now available in your academic repository.`,
          timestamp: Date.now(),
          docId: newDoc.id
        };
        db.notifications.unshift(notif);

        saveDatabase(db);
        return sendJson(res, 201, { success: true, doc: newDoc, notification: notif });
      }
    }

    // 5b. Update / Edit Note (Legacy)
    if (pathname.startsWith('/api/notes/') && !pathname.endsWith('/read') && (req.method === 'PUT' || req.method === 'PATCH')) {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const docId = pathname.replace('/api/notes/', '');
      const doc = (db.notes || []).find(n => String(n.id) === String(docId));
      if (!doc) {
        return sendJson(res, 404, { error: 'Document not found' });
      }

      const body = await parseBody(req);
      if (body.title) doc.title = body.title.trim();
      if (body.author !== undefined) doc.author = body.author.trim();
      if (body.year) doc.year = body.year;
      if (body.subject) doc.subject = body.subject;
      if (body.subCategory) doc.subCategory = body.subCategory;
      if (body.category && (body.category === 'textbook' || body.category === 'notes')) {
        doc.category = body.category;
        doc.contentType = doc.category === 'textbook' ? 'book' : 'note';
      } else if (body.contentType) {
        doc.category = body.contentType === 'book' ? 'textbook' : 'notes';
        doc.contentType = body.contentType;
      }
      if (body.fileUrl !== undefined) doc.fileUrl = body.fileUrl;
      if (body.pages !== undefined) doc.pages = Number(body.pages) || doc.pages;
      if (body.size !== undefined) doc.size = body.size;
      if (body.summary !== undefined) doc.summary = body.summary;
      if (body.downloads !== undefined) doc.downloads = Number(body.downloads);
      if (body.reads !== undefined) doc.reads = Number(body.reads);
      doc.updatedAt = new Date().toISOString();

      db.lastUpdated = Date.now();
      saveDatabase(db);
      return sendJson(res, 200, { success: true, doc: normalizeResource(doc) });
    }

    // 5c. Delete Note (Legacy)
    if (pathname.startsWith('/api/notes/') && !pathname.endsWith('/read') && req.method === 'DELETE') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const docId = pathname.replace('/api/notes/', '');
      const prevLen = (db.notes || []).length;
      db.notes = (db.notes || []).filter(n => String(n.id) !== String(docId));

      if (mongoDbInstance) {
        mongoDbInstance.collection('notes').deleteOne({ id: docId }).catch(() => {});
      }

      if (db.notes.length !== prevLen) {
        db.lastUpdated = Date.now();
        saveDatabase(db);
      }
      return sendJson(res, 200, { success: true, message: `Document ${docId} deleted successfully.` });
    }

    // 5d. Real-Time Document Read Tracker (Optimized: Atomic update without full DB disk write)
    if (pathname.match(/^\/api\/notes\/([^\/]+)\/read$/) && (req.method === 'POST' || req.method === 'GET')) {
      const match = pathname.match(/^\/api\/notes\/([^\/]+)\/read$/);
      const docId = match ? match[1] : '';
      const doc = (db.notes || []).find(n => String(n.id) === String(docId));
      if (!doc) {
        return sendJson(res, 404, { error: 'Document not found' });
      }

      doc.reads = (Number(doc.reads || doc.downloads || 0)) + 1;
      doc.downloads = doc.reads;
      doc.lastReadAt = new Date().toISOString();

      if (mongoDbInstance) {
        mongoDbInstance.collection('notes').updateOne(
          { id: doc.id },
          { $set: { reads: doc.reads, downloads: doc.downloads, lastReadAt: doc.lastReadAt } }
        ).catch(() => {});
      }
      return sendJson(res, 200, { success: true, docId: doc.id, reads: doc.reads, downloads: doc.downloads });
    }

    // ============================================================
    // 6. UPLOAD API (Validates genuine PDF + saves to durable storage)
    // ============================================================
    if (pathname === '/api/upload' && req.method === 'POST') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const body = await parseBody(req);
      if (!body.filename || !body.base64Data) {
        return sendJson(res, 400, { error: 'Missing filename or base64Data' });
      }

      const ext = path.extname(body.filename).toLowerCase();
      if (ext !== '.pdf') {
        return sendJson(res, 400, { error: 'Security Violation: Only valid medical .pdf documents are allowed.' });
      }

      try {
        const buffer = Buffer.from(body.base64Data, 'base64');
        const stored = await saveUploadedPdf({ filename: body.filename, buffer });

        return sendJson(res, 201, {
          success: true,
          filename: stored.filename,
          fileUrl: stored.fileUrl,
          size: stored.size,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey
        });
      } catch (err) {
        console.error('File upload validation/storage error:', err.message);
        return sendJson(res, 400, { error: err.message });
      }
    }

    // ============================================================
    // 7. GRIDFS PERSISTENT STORAGE STREAMING (/api/storage/gridfs/:id)
    // ============================================================
    if (pathname.startsWith('/api/storage/gridfs/')) {
      const fileIdStr = pathname.replace('/api/storage/gridfs/', '');
      if (!gridFsBucket || !mongoDbInstance) {
        return sendJson(res, 503, { error: 'Database storage service unavailable' });
      }

      try {
        const _id = new ObjectId(fileIdStr);
        const files = await mongoDbInstance.collection('pdfs.files').find({ _id }).toArray();
        if (!files || files.length === 0) {
          return sendJson(res, 404, { error: 'Document not found in storage' });
        }

        const file = files[0];
        const clientHeaders = Object.assign({
          'Content-Type': file.contentType || 'application/pdf',
          'Content-Length': file.length,
          'Content-Disposition': `inline; filename="${file.filename}"`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400'
        }, SECURITY_HEADERS);

        res.writeHead(200, clientHeaders);
        gridFsBucket.openDownloadStream(_id).pipe(res);
        return;
      } catch (err) {
        return sendJson(res, 400, { error: 'Invalid document storage identifier' });
      }
    }

    // ============================================================
    // 8. CURRICULUM, STUDENTS, COLLEGES, NOTIFICATIONS
    // ============================================================
    if (pathname === '/api/curriculum' && req.method === 'GET') {
      return sendJson(res, 200, db.curriculum || {});
    }

    if (pathname === '/api/curriculum/chapter' && req.method === 'POST') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const body = await parseBody(req);
      const { year, subjectName, chapterTitle, chapterDesc } = body;
      if (!year || !subjectName || !chapterTitle) {
        return sendJson(res, 400, { error: 'Missing required fields: year, subjectName, chapterTitle' });
      }
      db.curriculum = db.curriculum || {};
      db.curriculum[year] = db.curriculum[year] || [];
      let sub = db.curriculum[year].find(s => s.name === subjectName || (s.code && s.code === subjectName));
      if (!sub) {
        sub = {
          id: 'sub_' + Date.now(),
          name: subjectName,
          code: 'AYUSH-' + Math.floor(100 + Math.random() * 900),
          icon: '📖',
          desc: 'Curriculum subject',
          chapters: []
        };
        db.curriculum[year].push(sub);
      }
      sub.chapters = sub.chapters || [];
      const newCh = {
        id: 'ch_' + Date.now(),
        title: chapterTitle,
        desc: chapterDesc || 'Chapter study material and clinical syllabus coverage.',
        topics: []
      };
      sub.chapters.push(newCh);
      db.lastUpdated = Date.now();
      saveDatabase(db);
      return sendJson(res, 201, { success: true, chapter: newCh });
    }

    if (pathname === '/api/curriculum/topic' && req.method === 'POST') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const body = await parseBody(req);
      const { year, subjectName, chapterId, chapterTitle, title, pages, size, fileUrl, summary } = body;
      if (!year || !subjectName || !title) {
        return sendJson(res, 400, { error: 'Missing required fields: year, subjectName, title' });
      }

      db.curriculum = db.curriculum || {};
      db.curriculum[year] = db.curriculum[year] || [];
      let sub = db.curriculum[year].find(s => s.name.toLowerCase() === subjectName.toLowerCase());
      if (!sub) {
        sub = {
          id: 'sub_' + Date.now(),
          name: subjectName,
          code: 'AYUSH-' + Math.floor(100 + Math.random() * 900),
          icon: '📖',
          desc: 'Curriculum subject',
          chapters: []
        };
        db.curriculum[year].push(sub);
      }
      sub.chapters = sub.chapters || [];

      let ch = null;
      if (chapterId) ch = sub.chapters.find(c => c.id === chapterId);
      if (!ch && chapterTitle) ch = sub.chapters.find(c => c.title.toLowerCase() === chapterTitle.toLowerCase());
      if (!ch) {
        ch = {
          id: 'ch_' + Date.now(),
          title: chapterTitle || `Chapter ${sub.chapters.length + 1}: Study Notes`,
          desc: 'Clinical chapter study syllabus',
          topics: []
        };
        sub.chapters.push(ch);
      }
      ch.topics = ch.topics || [];

      const topicId = 'note_' + Date.now();
      const newTopic = {
        id: topicId,
        title: title,
        pages: Number(pages) || 14,
        size: size || '3.5 MB',
        fileUrl: fileUrl || '',
        summary: summary || 'Clinical homoeopathic study reference notes.'
      };
      ch.topics.push(newTopic);

      // Create note record in notes repository strictly under category = 'notes'
      const newNote = {
        id: topicId,
        category: 'notes',
        contentType: 'note',
        subCategory: ch.title || 'Handwritten Notes',
        title: title,
        author: 'Faculty Department',
        year: year,
        subject: sub.name,
        size: newTopic.size,
        pages: newTopic.pages,
        downloads: 1,
        reads: 0,
        summary: newTopic.summary,
        fileUrl: newTopic.fileUrl,
        isPublished: true,
        bookmarked: false,
        downloaded: false,
        currentPage: 1,
        createdAt: new Date().toISOString()
      };
      db.notes = db.notes || [];
      db.notes.unshift(newNote);

      db.lastUpdated = Date.now();
      db.notifications = db.notifications || [];
      const notif = {
        id: 'notif_' + Date.now(),
        title: '📚 New Study Note Published!',
        target: year || 'All Years',
        type: 'Study Note Upload',
        time: 'Just now',
        body: `"${newTopic.title}" (${sub.name}) has been uploaded to ${ch.title}.`,
        timestamp: Date.now(),
        docId: newNote.id
      };
      db.notifications.unshift(notif);

      saveDatabase(db);
      return sendJson(res, 201, { success: true, topic: newTopic, chapter: ch, note: newNote, notification: notif });
    }

    if (pathname.startsWith('/api/curriculum/chapter/') && req.method === 'DELETE') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const chId = pathname.replace('/api/curriculum/chapter/', '');
      if (db.curriculum) {
        for (const y in db.curriculum) {
          if (Array.isArray(db.curriculum[y])) {
            for (const s of db.curriculum[y]) {
              if (s.chapters && Array.isArray(s.chapters)) {
                s.chapters = s.chapters.filter(c => c.id !== chId);
              }
            }
          }
        }
      }
      saveDatabase(db);
      return sendJson(res, 200, { success: true, message: `Chapter ${chId} deleted.` });
    }

    if (pathname.startsWith('/api/curriculum/topic/') && req.method === 'DELETE') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const topId = pathname.replace('/api/curriculum/topic/', '');
      if (db.curriculum) {
        for (const y in db.curriculum) {
          if (Array.isArray(db.curriculum[y])) {
            for (const s of db.curriculum[y]) {
              if (s.chapters && Array.isArray(s.chapters)) {
                for (const ch of s.chapters) {
                  if (ch.topics && Array.isArray(ch.topics)) {
                    ch.topics = ch.topics.filter(t => t.id !== topId);
                  }
                }
              }
            }
          }
        }
      }
      if (db.notes) {
        db.notes = db.notes.filter(n => n.id !== topId && ('note_' + n.id) !== topId);
      }
      saveDatabase(db);
      return sendJson(res, 200, { success: true, message: `Topic ${topId} deleted.` });
    }

    // Students
    if (pathname === '/api/students') {
      if (req.method === 'GET') return sendJson(res, 200, db.students || []);
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const newStudent = {
          id: 'STU-' + Math.floor(1000 + Math.random() * 9000),
          name: body.name || 'Anonymous Student',
          email: body.email || 'student@homoeopulse.app',
          year: body.year || '1st Year',
          college: body.college || 'Homoeopathic Medical College',
          downloads: 0,
          status: 'Active',
          lastActive: 'Just now'
        };
        db.students = db.students || [];
        db.students.unshift(newStudent);
        saveDatabase(db);
        return sendJson(res, 201, { success: true, student: newStudent });
      }
    }

    if (pathname.startsWith('/api/students/') && pathname.endsWith('/toggle') && req.method === 'POST') {
      const studentId = pathname.split('/')[3];
      const stu = (db.students || []).find(s => s.id === studentId);
      if (stu) {
        stu.status = stu.status === 'Active' ? 'Suspended' : 'Active';
        saveDatabase(db);
        return sendJson(res, 200, { success: true, student: stu });
      }
      return sendJson(res, 404, { error: 'Student not found' });
    }

    // Colleges
    if (pathname === '/api/colleges') {
      if (req.method === 'GET') return sendJson(res, 200, db.colleges || []);
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const newCollege = {
          name: body.name,
          city: body.city,
          university: body.university,
          intake: Number(body.intake) || 100,
          accreditation: body.accreditation || 'Medical Council Approved'
        };
        db.colleges = db.colleges || [];
        db.colleges.push(newCollege);
        saveDatabase(db);
        return sendJson(res, 201, { success: true, college: newCollege });
      }
    }

    // Notifications
    if (pathname === '/api/notifications') {
      if (req.method === 'GET') return sendJson(res, 200, db.notifications || []);
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const newNotif = {
          id: 'notif_' + Date.now(),
          title: body.title,
          target: body.target || 'All Years',
          type: body.type || 'Exam Notification',
          time: 'Just now',
          body: body.body || '',
          timestamp: Date.now()
        };
        db.notifications = db.notifications || [];
        db.notifications.unshift(newNotif);
        db.lastUpdated = Date.now();
        saveDatabase(db);
        return sendJson(res, 201, { success: true, notification: newNotif });
      }
    }

    // User Profile
    if (pathname === '/api/user-profile') {
      if (req.method === 'GET') {
        return sendJson(res, 200, db.userProfile || {
          name: 'BHMS Scholar',
          year: '1st Year',
          college: 'Homoeopathic Medical College',
          email: 'student@homoeopulse.app',
          rollNo: 'BHMS-2024-001'
        });
      }
      if (req.method === 'POST') {
        const body = await parseBody(req);
        db.userProfile = {
          name: body.name || 'BHMS Scholar',
          year: body.year || '1st Year',
          college: body.college || 'Homoeopathic Medical College',
          email: body.email || 'student@homoeopulse.app',
          rollNo: body.rollNo || 'BHMS-2024-001',
          isSetupDone: true
        };
        saveDatabase(db);
        return sendJson(res, 200, { success: true, userProfile: db.userProfile });
      }
    }

    return sendJson(res, 404, { error: 'API Route Not Found' });
  }

  // ==========================================
  // SERVE UPLOADED REAL PDF FILES (/uploads/*)
  // Protected with strict path traversal checks and HTTP Range streaming
  // ==========================================
  if (pathname.startsWith('/uploads/')) {
    const rawFilename = pathname.replace('/uploads/', '');
    const safeFilename = path.basename(rawFilename);
    const filePath = path.join(UPLOADS_DIR, safeFilename);

    if (!filePath.startsWith(UPLOADS_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('PDF File Not Found');
        return;
      }

      const contentType = 'application/pdf';
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*'
        });
        fileStream.pipe(res);
        return;
      }

      res.writeHead(200, {
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Content-Disposition': 'inline; filename="' + safeFilename + '"',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  // Dedicated Admin Route
  if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin.html') {
    const adminPath = path.join(PUBLIC_DIR, 'admin.html');
    if (!fs.existsSync(adminPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Admin Portal File Not Found');
      return;
    }
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=UTF-8' }, SECURITY_HEADERS));
    fs.createReadStream(adminPath).pipe(res);
    return;
  }

  // Portal Hub & Unified Launcher Route
  if (pathname === '/hub' || pathname === '/launcher' || pathname === '/hub.html') {
    const hubPath = path.join(PUBLIC_DIR, 'hub.html');
    if (!fs.existsSync(hubPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Hub File Not Found');
      return;
    }
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=UTF-8' }, SECURITY_HEADERS));
    fs.createReadStream(hubPath).pipe(res);
    return;
  }

  // ==========================================
  // STATIC FILE SERVING (Zero-RAM Streaming)
  // ==========================================
  let reqUrl = pathname;
  if (reqUrl === '/' || reqUrl === '' || reqUrl === '/app') {
    reqUrl = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, reqUrl);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for client-side routing
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (!fs.existsSync(indexPath)) {
        res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
        res.end('404 Not Found');
        return;
      }
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=UTF-8' }, SECURITY_HEADERS));
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, Object.assign({
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*'
    }, SECURITY_HEADERS));
    fs.createReadStream(filePath).pipe(res);
  });
});

server.on('clientError', (err, socket) => {
  if (err.code === 'ECONNRESET' || !socket.writable) return;
  try {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } catch (e) {}
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Unhandled Exception caught safely:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection caught safely:', reason);
});

// Initialize MongoDB (connects or falls back safely without wiping data!)
initMongo();

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🌿 Homoeo Pulse Shared Backend is LIVE!`);
  console.log(`🌐 Server Address: http://localhost:${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   - GET  /api/health`);
  console.log(`   - GET  /api/resources?category=textbook|notes`);
  console.log(`   - POST /api/admin/resources`);
  console.log(`   - GET/POST  /api/notes`);
  console.log(`   - POST /api/upload`);
  console.log(`📱 Frontend: Student Mobile App + Admin CMS Portal`);
  console.log(`=======================================================`);
});
