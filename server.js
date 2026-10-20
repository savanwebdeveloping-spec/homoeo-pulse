const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { MongoClient } = require('mongodb');

// Cache confirmation URLs & cookies for Google Drive file downloads (30 min TTL)
const gdriveConfirmCache = new Map();

async function getGDriveDownloadUrl(fileId) {
  const cached = gdriveConfirmCache.get(fileId);
  if (cached && (Date.now() - cached.time < 30 * 60 * 1000)) {
    return cached;
  }

  const url1 = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
  const res1 = await fetch(url1);
  const cookie = res1.headers.get('set-cookie');
  const html = await res1.text();

  const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
  const confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t` + (uuidMatch ? `&uuid=${uuidMatch[1]}` : '');

  const data = { confirmUrl, cookie, time: Date.now() };
  gdriveConfirmCache.set(fileId, data);
  return data;
}


const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'web');
const DB_PATH = path.join(__dirname, 'data', 'database.json');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'homoeo_pulse';

let mongoDbInstance = null;

// Ensure database file exists
function loadDatabase() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (!data.lastUpdated) {
        data.lastUpdated = 1791978991862;
      }
      return data;
    }
  } catch (err) {
    console.error('Error reading database:', err);
  }
  return { curriculum: {}, notes: [], students: [], colleges: [], notifications: [], lastUpdated: 1791978991862 };
}

// In-memory reference synced to disk and MongoDB
let db = loadDatabase();

async function initMongo() {
  try {
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    mongoDbInstance = client.db(MONGODB_DB_NAME);
    console.log(`🍃 Connected to MongoDB: ${MONGODB_DB_NAME}`);

    const currCol = mongoDbInstance.collection('curriculum');
    const currDoc = await currCol.findOne({ _id: 'canonical' });
    if (!currDoc && db.curriculum && Object.keys(db.curriculum).length > 0) {
      await currCol.insertOne({ _id: 'canonical', data: db.curriculum });
      console.log('🍃 Seeded initial curriculum to MongoDB');
    } else if (currDoc && currDoc.data) {
      let diskChapters = 0;
      let mongoChapters = 0;
      for (const y in db.curriculum) (db.curriculum[y] || []).forEach(s => diskChapters += (s.chapters || []).length);
      for (const y in currDoc.data) (currDoc.data[y] || []).forEach(s => mongoChapters += (s.chapters || []).length);
      if (diskChapters > mongoChapters) {
        console.log(`🍃 Upgrading MongoDB curriculum with richer disk syllabus (${diskChapters} vs ${mongoChapters} chapters).`);
        await currCol.updateOne({ _id: 'canonical' }, { $set: { data: db.curriculum } }, { upsert: true });
      } else {
        db.curriculum = currDoc.data;
      }
    }

    const notesCol = mongoDbInstance.collection('notes');
    const notesCount = await notesCol.countDocuments();
    if (notesCount === 0 && db.notes && db.notes.length > 0) {
      await notesCol.insertMany(db.notes.map(n => ({ ...n })));
      console.log(`🍃 Seeded ${db.notes.length} initial notes to MongoDB`);
    } else if (notesCount > 0) {
      const allNotes = await notesCol.find({}).toArray();
      if (allNotes.length < (db.notes || []).length) {
        console.log(`🍃 Upgrading MongoDB with full note catalog (${db.notes.length} notes vs ${allNotes.length} in mongo).`);
        await notesCol.deleteMany({});
        await notesCol.insertMany(db.notes.map(n => ({ ...n })));
      } else {
        db.notes = allNotes.map(({ _id, ...rest }) => rest);
      }
    }
  } catch (err) {
    console.log('🍃 MongoDB notice: Running in local file-backed mode (resilient storage active).');
  }
}

function saveDatabase(data) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');

    // Async background sync to MongoDB if active
    if (mongoDbInstance) {
      if (data.curriculum) {
        mongoDbInstance.collection('curriculum').updateOne(
          { _id: 'canonical' },
          { $set: { data: data.curriculum } },
          { upsert: true }
        ).catch(() => {});
      }
      if (data.notes) {
        const notesCol = mongoDbInstance.collection('notes');
        notesCol.deleteMany({}).then(() => {
          if (data.notes.length > 0) {
            notesCol.insertMany(data.notes.map(n => ({ ...n }))).catch(() => {});
          }
        }).catch(() => {});
      }
    }
    return true;
  } catch (err) {
    console.error('Error saving database:', err);
    return false;
  }
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

// Helper to parse JSON request bodies
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
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
  'X-Frame-Options': 'SAMEORIGIN',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'homoeopulse2025';

// Mirror changes to Live Cloud Production Server if running on local machine
const IS_LIVE_CLOUD = !!(process.env.RENDER || process.env.PORT == 10000 || process.env.NODE_ENV === 'production');
function mirrorToLiveCloud(endpoint, method, payload) {
  if (IS_LIVE_CLOUD) return;
  try {
    fetch(`https://homoeo-pulse.onrender.com${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_SECRET_KEY
      },
      body: payload ? JSON.stringify(payload) : undefined
    }).catch(e => console.warn(`[Live Mirror] ${endpoint} notice:`, e.message));
  } catch (err) {}
}

// In-Memory IP Rate Limiter
const ipRequestHistory = new Map();
function isRateLimited(ip, limit = 200, windowMs = 60000) {
  const now = Date.now();
  const entry = ipRequestHistory.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + windowMs;
    ipRequestHistory.set(ip, entry);
    return false;
  }
  entry.count++;
  ipRequestHistory.set(ip, entry);
  return entry.count > limit;
}

function sendJson(res, statusCode, data) {
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key, Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
  }, SECURITY_HEADERS);

  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(data));
}

function verifyAdminAuth(req) {
  const adminKey = req.headers['x-admin-key'] || req.headers['authorization'];
  if (adminKey) {
    const token = adminKey.replace(/^Bearer\s+/i, '').trim();
    if (token === ADMIN_SECRET_KEY) return true;
  }
  // Local development / loopback fallback
  const ip = req.socket.remoteAddress;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  return false;
}

const server = http.createServer(async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  // Apply DDoS / Brute-Force Rate Limiting
  if (isRateLimited(clientIp)) {
    return sendJson(res, 429, { error: 'Too many requests. Please slow down.' });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

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
    // 0. High-Speed PDF Proxy Streaming (Zero Google Drive CORS / Preview limits)
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

        // Record student reading activity if request is initial stream
        if (!req.headers['range'] || req.headers['range'].startsWith('bytes=0-')) {
          const matchedDoc = (db.notes || []).find(n => n.fileUrl && n.fileUrl.includes(fileId));
          if (matchedDoc) {
            matchedDoc.reads = (Number(matchedDoc.reads || matchedDoc.downloads || 0)) + 1;
            matchedDoc.downloads = matchedDoc.reads;
            matchedDoc.lastReadAt = new Date().toISOString();
            db.lastUpdated = Date.now();
            saveDatabase(db);
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

    // 1. Health Status
    if (pathname === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'online',
        system: 'Homoeo Pulse Live Academic Platform',
        version: '2.2.0-RELEASE',
        timestamp: new Date().toISOString(),
        totalNotes: db.notes ? db.notes.length : 0,
        totalStudents: db.students ? db.students.length : 0
      });
    }

    // 2. Computed Analytics & Stats
    if (pathname === '/api/stats' && req.method === 'GET') {
      const notes = db.notes || [];
      const booksCount = notes.filter(n => n.contentType === 'book').length;
      const notesCount = notes.filter(n => n.contentType === 'note').length;
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
        vaultStorage: '184.2 MB Encrypted Sandbox',
        lastUpdated: db.lastUpdated || 1791978991862,
        latestNotification: latestNotif,
        totalNotifications: (db.notifications || []).length
      });
    }

    // 3. Database Full Dump (for frontend sync)
    if (pathname === '/api/bootstrap' && req.method === 'GET') {
      return sendJson(res, 200, db);
    }

    // 4. Notes & Books Collection
    if (pathname === '/api/notes') {
      if (req.method === 'GET') {
        let results = db.notes || [];
        const year = parsedUrl.searchParams.get('year');
        const type = parsedUrl.searchParams.get('type');
        const subject = parsedUrl.searchParams.get('subject');

        if (year && year !== 'All') results = results.filter(n => n.year === year);
        if (type && type !== 'All') results = results.filter(n => n.contentType === type);
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

        const newDoc = {
          id: body.id || ((body.contentType === 'book' ? 'book_' : 'note_') + Date.now()),
          contentType: body.contentType || 'note',
          title: body.title,
          author: body.author || 'Faculty Member',
          year: body.year,
          subject: body.subject,
          category: body.category || 'Standard Study Material',
          size: body.size || (body.contentType === 'book' ? '28.4 MB' : '8.2 MB'),
          pages: Number(body.pages) || (body.contentType === 'book' ? 380 : 45),
          downloads: Number(body.downloads) || 1,
          summary: body.summary || 'Clinical homoeopathic study reference document.',
          fileUrl: body.fileUrl || '',
          bookmarked: false,
          downloaded: false,
          currentPage: 1,
          createdAt: new Date().toISOString()
        };

        db.notes.unshift(newDoc);
        db.lastUpdated = Date.now();

        // Also link note to curriculum topics if it's a study note
        if (newDoc.contentType === 'note' && db.curriculum && db.curriculum[newDoc.year]) {
          const sub = db.curriculum[newDoc.year].find(s => s.name === newDoc.subject || (s.code && s.code === newDoc.subject));
          if (sub) {
            sub.chapters = sub.chapters || [];
            let ch = sub.chapters.find(c => c.title.toLowerCase().includes((newDoc.category || '').toLowerCase()) || c.title.toLowerCase().includes('study notes'));
            if (!ch && sub.chapters.length > 0) ch = sub.chapters[0];
            if (!ch) {
              ch = {
                id: 'ch_' + Date.now(),
                title: newDoc.category || `${newDoc.subject} Study Notes`,
                desc: 'High-yield clinical study notes and lecture topics.',
                topics: []
              };
              sub.chapters.push(ch);
            }
            ch.topics = ch.topics || [];
            if (!ch.topics.some(t => t.id === newDoc.id || t.title === newDoc.title)) {
              ch.topics.push({
                id: newDoc.id,
                title: newDoc.title,
                pages: newDoc.pages || 14,
                size: newDoc.size || '3.5 MB',
                fileUrl: newDoc.fileUrl,
                summary: newDoc.summary || 'Clinical homoeopathic study reference notes.'
              });
            }
          }
        }

        db.notifications = db.notifications || [];
        const isBook = newDoc.contentType === 'book';
        const notif = {
          id: 'notif_' + Date.now(),
          title: `📚 New ${isBook ? 'Textbook' : 'Study Note'} Published!`,
          target: newDoc.year || 'All Years',
          type: isBook ? 'Textbook Upload' : 'Study Note Upload',
          time: 'Just now',
          body: `"${newDoc.title}" for ${newDoc.subject || 'BHMS'} (${newDoc.year}) is now available in your academic repository.`,
          timestamp: Date.now(),
          docId: newDoc.id
        };
        db.notifications.unshift(notif);
        saveDatabase(db);
        mirrorToLiveCloud('/api/notes', 'POST', newDoc);
        return sendJson(res, 201, { success: true, doc: newDoc, notification: notif });
      }
    }

    // 4b. Update / Edit Note
    if (pathname.startsWith('/api/notes/') && (req.method === 'PUT' || req.method === 'PATCH')) {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const docId = pathname.replace('/api/notes/', '');
      const doc = (db.notes || []).find(n => String(n.id) === String(docId));
      if (!doc) {
        return sendJson(res, 404, { error: 'Document not found' });
      }

      const body = await parseBody(req);
      if (body.title) doc.title = body.title;
      if (body.author !== undefined) doc.author = body.author;
      if (body.year) doc.year = body.year;
      if (body.subject) doc.subject = body.subject;
      if (body.contentType) doc.contentType = body.contentType;
      if (body.category) doc.category = body.category;
      if (body.fileUrl !== undefined) doc.fileUrl = body.fileUrl;
      if (body.pages !== undefined) doc.pages = Number(body.pages) || doc.pages;
      if (body.size !== undefined) doc.size = body.size;
      if (body.summary !== undefined) doc.summary = body.summary;
      if (body.downloads !== undefined) doc.downloads = Number(body.downloads);
      if (body.reads !== undefined) doc.reads = Number(body.reads);
      doc.updatedAt = new Date().toISOString();

      // Also update matching topic in curriculum if it was a note
      if (db.curriculum) {
        for (const y in db.curriculum) {
          if (Array.isArray(db.curriculum[y])) {
            for (const s of db.curriculum[y]) {
              if (s.chapters && Array.isArray(s.chapters)) {
                for (const ch of s.chapters) {
                  if (ch.topics && Array.isArray(ch.topics)) {
                    for (const t of ch.topics) {
                      if (String(t.id) === String(docId) || ('note_' + t.id) === String(docId)) {
                        if (body.title) t.title = body.title;
                        if (body.fileUrl) t.fileUrl = body.fileUrl;
                        if (body.pages) t.pages = Number(body.pages);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      db.lastUpdated = Date.now();
      db.notifications = db.notifications || [];
      const notif = {
        id: 'notif_' + Date.now(),
        title: `✏️ Document Details Updated`,
        target: doc.year || 'All Years',
        type: 'Academic Update',
        time: 'Just now',
        body: `Faculty updated "${doc.title}" (${doc.subject || 'BHMS'}). Latest revision is now ready in the app.`,
        timestamp: Date.now(),
        docId: doc.id
      };
      db.notifications.unshift(notif);
      saveDatabase(db);
      mirrorToLiveCloud(pathname, 'PUT', body);
      return sendJson(res, 200, { success: true, doc, notification: notif });
    }

    // 4c. Delete Note
    if (pathname.startsWith('/api/notes/') && req.method === 'DELETE') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const docId = pathname.replace('/api/notes/', '');
      const prevLen = db.notes.length;
      db.notes = db.notes.filter(n => n.id !== docId);

      // Also remove matching topic from curriculum if it was a note
      if (db.curriculum) {
        for (const y in db.curriculum) {
          if (Array.isArray(db.curriculum[y])) {
            for (const s of db.curriculum[y]) {
              if (s.chapters && Array.isArray(s.chapters)) {
                for (const ch of s.chapters) {
                  if (ch.topics && Array.isArray(ch.topics)) {
                    ch.topics = ch.topics.filter(t => t.id !== docId && ('note_' + t.id) !== docId);
                  }
                }
              }
            }
          }
        }
      }

      if (db.notes.length !== prevLen) {
        db.lastUpdated = Date.now();
        db.notifications = db.notifications || [];
        const notif = {
          id: 'notif_' + Date.now(),
          title: `🔄 Library Repository Updated`,
          target: 'All Years',
          type: 'Curriculum Maintenance',
          time: 'Just now',
          body: `Academic repository has been updated by faculty administrators.`,
          timestamp: Date.now()
        };
        db.notifications.unshift(notif);
      }
      saveDatabase(db);
      mirrorToLiveCloud(pathname, 'DELETE');
      return sendJson(res, 200, { success: true, message: `Document ${docId} deleted successfully.` });
    }

    // 4d. Real-Time Document Read Tracker (Invoked when a student reads PDF)
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
      db.lastUpdated = Date.now();

      saveDatabase(db);
      mirrorToLiveCloud(`/api/notes/${docId}/read`, 'POST');
      return sendJson(res, 200, { success: true, docId: doc.id, reads: doc.reads, downloads: doc.downloads });
    }

    // 4c. Curriculum Chapter & Topic Management
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
          code: 'BHMS',
          icon: '📖',
          desc: 'Academic curriculum subject',
          chapters: []
        };
        db.curriculum[year].push(sub);
      }
      sub.chapters = sub.chapters || [];
      const newChapter = {
        id: 'ch_' + Date.now(),
        title: chapterTitle,
        desc: chapterDesc || 'High-yield clinical study notes and lecture topics.',
        topics: []
      };
      sub.chapters.push(newChapter);
      db.lastUpdated = Date.now();
      saveDatabase(db);
      mirrorToLiveCloud('/api/curriculum/chapter', 'POST', body);
      return sendJson(res, 201, { success: true, chapter: newChapter });
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
      let sub = db.curriculum[year].find(s => s.name === subjectName || (s.code && s.code === subjectName));
      if (!sub) {
        sub = {
          id: 'sub_' + Date.now(),
          name: subjectName,
          code: 'BHMS',
          icon: '📖',
          desc: 'Academic curriculum subject',
          chapters: []
        };
        db.curriculum[year].push(sub);
      }
      sub.chapters = sub.chapters || [];

      let ch = null;
      if (chapterId) {
        ch = sub.chapters.find(c => c.id === chapterId);
      }
      if (!ch && chapterTitle) {
        ch = sub.chapters.find(c => c.title.toLowerCase() === chapterTitle.toLowerCase());
      }
      if (!ch) {
        ch = {
          id: 'ch_' + Date.now(),
          title: chapterTitle || `Chapter ${sub.chapters.length + 1}: Study Notes`,
          desc: 'High-yield clinical study notes and lecture topics.',
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

      // Also create note in notes collection for global indexing
      const newNote = {
        id: topicId,
        contentType: 'note',
        title: title,
        author: 'Faculty Department',
        year: year,
        subject: subjectName,
        category: ch.title,
        size: newTopic.size,
        pages: newTopic.pages,
        downloads: 1,
        summary: newTopic.summary,
        fileUrl: newTopic.fileUrl,
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
        body: `"${newNote.title}" for ${newNote.subject} (${newNote.year}) is now available in your academic repository.`,
        timestamp: Date.now(),
        docId: newNote.id
      };
      db.notifications.unshift(notif);

      saveDatabase(db);
      mirrorToLiveCloud('/api/curriculum/topic', 'POST', body);
      return sendJson(res, 201, { success: true, chapter: ch, topic: newTopic, note: newNote, notification: notif });
    }

    // 4d. Delete Curriculum Chapter
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
      mirrorToLiveCloud(pathname, 'DELETE');
      return sendJson(res, 200, { success: true, message: `Chapter ${chId} deleted.` });
    }

    // 4e. Delete Curriculum Topic
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
      // Also remove from notes collection if exists
      if (db.notes) {
        db.notes = db.notes.filter(n => n.id !== topId);
      }
      saveDatabase(db);
      mirrorToLiveCloud(pathname, 'DELETE');
      return sendJson(res, 200, { success: true, message: `Topic ${topId} deleted.` });
    }

    // 4f. Full Database Sync Endpoint (For instant Live Cloud replication)
    if (pathname === '/api/admin/sync-db' && req.method === 'POST') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const body = await parseBody(req);
      if (body.curriculum) db.curriculum = body.curriculum;
      if (body.notes) db.notes = body.notes;
      if (body.notifications) db.notifications = body.notifications;
      db.lastUpdated = Date.now();
      saveDatabase(db);
      return sendJson(res, 200, { success: true, message: 'Database synced successfully.', lastUpdated: db.lastUpdated });
    }

    // 5. Students Collection
    if (pathname === '/api/students') {
      if (req.method === 'GET') {
        return sendJson(res, 200, db.students || []);
      }
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const newStudent = {
          id: 'STU-' + Math.floor(1000 + Math.random() * 9000),
          name: body.name || 'Anonymous Student',
          email: body.email || 'student@homoeopulse.ayush.gov.in',
          year: body.year || '1st Year',
          college: body.college || 'Homoeopathic Medical College',
          downloads: 0,
          status: 'Active',
          lastActive: 'Just now'
        };
        db.students.unshift(newStudent);
        saveDatabase(db);
        return sendJson(res, 201, { success: true, student: newStudent });
      }
    }

    // 5b. Toggle Student Status
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

    // 6. Colleges Collection
    if (pathname === '/api/colleges') {
      if (req.method === 'GET') {
        return sendJson(res, 200, db.colleges || []);
      }
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const newCollege = {
          name: body.name,
          city: body.city,
          university: body.university,
          intake: Number(body.intake) || 100,
          accreditation: body.accreditation || 'Medical Council Approved'
        };
        db.colleges.push(newCollege);
        saveDatabase(db);
        return sendJson(res, 201, { success: true, college: newCollege });
      }
    }

    // 7. Notifications Collection
    if (pathname === '/api/notifications') {
      if (req.method === 'GET') {
        return sendJson(res, 200, db.notifications || []);
      }
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

    // 8. Secure Real File Upload API (Strict PDF validation + magic bytes + size check)
    if (pathname === '/api/upload' && req.method === 'POST') {
      if (!verifyAdminAuth(req)) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin security passcode required.' });
      }
      const body = await parseBody(req);
      if (!body.filename || !body.base64Data) {
        return sendJson(res, 400, { error: 'Missing filename or base64Data' });
      }

      // Security check: Only .pdf allowed
      const ext = path.extname(body.filename).toLowerCase();
      if (ext !== '.pdf') {
        return sendJson(res, 400, { error: 'Security Violation: Only valid medical .pdf documents are allowed.' });
      }

      const buffer = Buffer.from(body.base64Data, 'base64');

      // Security check: Magic bytes header must start with %PDF-
      if (buffer.length < 5 || buffer.toString('utf8', 0, 4) !== '%PDF') {
        return sendJson(res, 400, { error: 'Security Violation: Invalid file signature. Content is not a legitimate PDF.' });
      }

      // Security check: Max 50 MB file size
      if (buffer.length > 50 * 1024 * 1024) {
        return sendJson(res, 400, { error: 'File size exceeds maximum permitted limit of 50 MB.' });
      }

      const safeName = Date.now() + '_' + path.basename(body.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const uploadsDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const savePath = path.join(uploadsDir, safeName);
      fs.writeFileSync(savePath, buffer);

      // If running locally, automatically mirror upload to live Render server
      if (!IS_LIVE_CLOUD) {
        fetch('https://homoeo-pulse.onrender.com/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-key': ADMIN_SECRET_KEY
          },
          body: JSON.stringify({
            filename: body.filename,
            base64Data: body.base64Data
          })
        }).catch(err => console.warn('[Live Mirror] Upload warning:', err.message));
      }

      const fileUrl = IS_LIVE_CLOUD 
        ? '/uploads/' + safeName 
        : 'https://homoeo-pulse.onrender.com/uploads/' + safeName;

      return sendJson(res, 201, {
        success: true,
        filename: safeName,
        fileUrl: fileUrl,
        size: (buffer.length / (1024 * 1024)).toFixed(1) + ' MB'
      });
    }

    // 9. Real User Profile Management
    if (pathname === '/api/user-profile') {
      if (req.method === 'GET') {
        return sendJson(res, 200, db.userProfile || {
          name: 'BHMS Scholar',
          year: '1st Year',
          college: 'Homoeopathic Medical College',
          email: 'student@homoeopulse.ayush.gov.in',
          rollNo: 'BHMS-2024-001'
        });
      }
      if (req.method === 'POST') {
        const body = await parseBody(req);
        db.userProfile = {
          name: body.name || 'BHMS Scholar',
          year: body.year || '1st Year',
          college: body.college || 'Homoeopathic Medical College',
          email: body.email || 'student@homoeopulse.ayush.gov.in',
          rollNo: body.rollNo || 'BHMS-2024-001',
          isSetupDone: true
        };
        if (body.name && body.name !== 'BHMS Scholar') {
          db.students = db.students || [];
          const existing = db.students.find(s => (body.email && s.email === body.email) || (s.name && s.name.toLowerCase() === body.name.toLowerCase()));
          if (existing) {
            existing.name = body.name;
            existing.year = body.year || existing.year;
            existing.college = body.college || existing.college;
            existing.lastActive = 'Just now';
          } else {
            db.students.push({
              id: 'STU-' + Math.floor(1000 + Math.random() * 9000),
              name: body.name,
              email: body.email || 'student@homoeopulse.ayush.gov.in',
              year: body.year || '1st Year',
              college: body.college || 'Homoeopathic Medical College',
              downloads: 1,
              status: 'Active',
              lastActive: 'Just now'
            });
          }
        }
        saveDatabase(db);
        return sendJson(res, 200, { success: true, userProfile: db.userProfile });
      }
    }

    // 10. Curriculum Hierarchy Endpoints (Year -> Subject -> Chapters -> Topics)
    if (pathname === '/api/curriculum' && req.method === 'GET') {
      return sendJson(res, 200, db.curriculum || {});
    }

    // 10a. Add / Update Chapter
    if (pathname === '/api/curriculum/chapter' && req.method === 'POST') {
      const body = await parseBody(req);
      const { year, subjectName, chapterTitle, chapterDesc } = body;
      if (!year || !subjectName || !chapterTitle) {
        return sendJson(res, 400, { error: 'Missing required fields (year, subjectName, chapterTitle)' });
      }
      if (!db.curriculum) db.curriculum = {};
      if (!db.curriculum[year]) db.curriculum[year] = [];
      
      let subj = db.curriculum[year].find(s => s.name.toLowerCase() === subjectName.toLowerCase());
      if (!subj) {
        subj = {
          id: 'subj_' + Date.now(),
          name: subjectName,
          code: 'AYUSH-' + Math.floor(100 + Math.random() * 900),
          icon: '📖',
          desc: 'Curriculum subject',
          chapters: []
        };
        db.curriculum[year].push(subj);
      }
      if (!subj.chapters) subj.chapters = [];
      
      const newCh = {
        id: 'ch_' + Date.now(),
        title: chapterTitle,
        desc: chapterDesc || 'Chapter study material and clinical syllabus coverage.',
        topics: []
      };
      subj.chapters.push(newCh);
      saveDatabase(db);
      return sendJson(res, 201, { success: true, chapter: newCh });
    }

    // 10b. Add Topic under Chapter
    if (pathname === '/api/curriculum/topic' && req.method === 'POST') {
      const body = await parseBody(req);
      const { year, subjectName, chapterTitle, chapterId, title, pages, size, fileUrl, summary } = body;
      if (!year || !subjectName || !title) {
        return sendJson(res, 400, { error: 'Missing required fields (year, subjectName, title)' });
      }
      if (!db.curriculum) db.curriculum = {};
      if (!db.curriculum[year]) db.curriculum[year] = [];

      let subj = db.curriculum[year].find(s => s.name.toLowerCase() === subjectName.toLowerCase());
      if (!subj) {
        subj = {
          id: 'subj_' + Date.now(),
          name: subjectName,
          code: 'AYUSH-' + Math.floor(100 + Math.random() * 900),
          icon: '📖',
          desc: 'Curriculum subject',
          chapters: []
        };
        db.curriculum[year].push(subj);
      }
      if (!subj.chapters) subj.chapters = [];

      // Find or create chapter
      let ch = null;
      if (chapterId) {
        ch = subj.chapters.find(c => c.id === chapterId);
      }
      if (!ch && chapterTitle) {
        ch = subj.chapters.find(c => c.title.toLowerCase() === chapterTitle.toLowerCase());
      }
      if (!ch) {
        ch = {
          id: 'ch_' + Date.now(),
          title: chapterTitle || `Chapter ${subj.chapters.length + 1}: Study Notes`,
          desc: 'Clinical chapter study syllabus',
          topics: []
        };
        subj.chapters.push(ch);
      }
      if (!ch.topics) ch.topics = [];

      const newTopic = {
        id: 'top_' + Date.now(),
        title: title,
        pages: Number(pages) || 12,
        size: size || '3.5 MB',
        fileUrl: fileUrl || '',
        summary: summary || 'Clinical homoeopathic study reference notes.'
      };
      ch.topics.push(newTopic);

      // Also create a note item in db.notes so it appears in standard repository queries as well
      const newNote = {
        id: 'note_' + newTopic.id,
        contentType: 'note',
        title: `${ch.title} - ${title}`,
        author: 'Faculty Department',
        year: year,
        subject: subj.name,
        category: 'Handwritten Notes',
        size: newTopic.size,
        pages: newTopic.pages,
        downloads: 1,
        summary: newTopic.summary,
        fileUrl: newTopic.fileUrl,
        bookmarked: false,
        downloaded: false,
        currentPage: 1,
        createdAt: new Date().toISOString()
      };
      db.notes.unshift(newNote);
      db.lastUpdated = Date.now();
      db.notifications = db.notifications || [];
      const notif = {
        id: 'notif_' + Date.now(),
        title: '📚 New Topic Notes Published!',
        target: year || 'All Years',
        type: 'Study Note Upload',
        time: 'Just now',
        body: `"${newTopic.title}" (${subj.name}) has been uploaded to ${ch.title}.`,
        timestamp: Date.now(),
        docId: newNote.id
      };
      db.notifications.unshift(notif);

      saveDatabase(db);
      mirrorToLiveCloud('/api/curriculum/topic', 'POST', body);
      return sendJson(res, 201, { success: true, topic: newTopic, chapter: ch, note: newNote });
    }

    return sendJson(res, 404, { error: 'API Route Not Found' });
  }

  // ==========================================
  // SERVE UPLOADED REAL PDF FILES (/uploads/*)
  // ==========================================
  if (pathname.startsWith('/uploads/')) {
    const uploadFilePath = path.join(__dirname, pathname);
    const uploadsRoot = path.join(__dirname, 'uploads');
    if (!uploadFilePath.startsWith(uploadsRoot)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      return;
    }

    fs.stat(uploadFilePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('PDF File Not Found');
        return;
      }

      const ext = path.extname(uploadFilePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/pdf';

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunksize = (end - start) + 1;
        const fileStream = fs.createReadStream(uploadFilePath, { start, end });
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
        'Content-Disposition': 'inline',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      });
      fs.createReadStream(uploadFilePath).pipe(res);
    });
    return;
  }

  // Dedicated Admin Route
  if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin.html') {
    const adminPath = path.join(PUBLIC_DIR, 'admin.html');
    fs.readFile(adminPath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Admin Portal File Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
        res.end(content);
      }
    });
    return;
  }

  // Portal Hub & Unified Launcher Route
  if (pathname === '/hub' || pathname === '/launcher' || pathname === '/hub.html') {
    const hubPath = path.join(PUBLIC_DIR, 'hub.html');
    fs.readFile(hubPath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Hub File Not Found');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
        res.end(content);
      }
    });
    return;
  }

  // ==========================================
  // SECURE UPLOADS FILE SERVING
  // ==========================================
  if (pathname.startsWith('/uploads/')) {
    const rawFilename = pathname.replace('/uploads/', '');
    const safeFilename = path.basename(rawFilename); // Prevent path traversal
    const uploadsDir = path.join(__dirname, 'uploads');
    const filePath = path.join(uploadsDir, safeFilename);

    // Verify file stays strictly inside uploads directory
    if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) {
      res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
      res.end('404 Document Not Found');
      return;
    }

    const stat = fs.statSync(filePath);
    res.writeHead(200, Object.assign({
      'Content-Type': 'application/pdf',
      'Content-Length': stat.size,
      'Content-Disposition': 'inline; filename="' + safeFilename + '"',
      'Access-Control-Allow-Origin': '*'
    }, SECURITY_HEADERS));

    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // ==========================================
  // STATIC FILE SERVING
  // ==========================================
  let reqUrl = pathname;
  if (reqUrl === '/' || reqUrl === '' || reqUrl === '/app') {
    reqUrl = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, reqUrl);

  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
          res.end('404 Not Found');
        } else {
          res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=UTF-8' }, SECURITY_HEADERS));
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, Object.assign({ 'Content-Type': 'text/plain' }, SECURITY_HEADERS));
        res.end('500 Internal Server Error');
      } else {
        res.writeHead(200, Object.assign({
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*'
        }, SECURITY_HEADERS));
        res.end(content);
      }
    });
  });
});

server.on('clientError', (err, socket) => {
  if (err.code === 'ECONNRESET' || !socket.writable) {
    return;
  }
  try {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  } catch (e) {}
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Unhandled Exception caught safely:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection caught safely:', reason);
});

// Initialize MongoDB (connects or falls back safely)
initMongo();

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🌿 Homoeo Pulse Fullstack Platform is LIVE!`);
  console.log(`🌐 Server Address: http://localhost:${PORT}`);
  console.log(`📡 REST API Endpoints:`);
  console.log(`   - GET  /api/status`);
  console.log(`   - GET  /api/stats`);
  console.log(`   - GET/POST  /api/notes`);
  console.log(`   - GET/POST  /api/students`);
  console.log(`   - GET/POST  /api/colleges`);
  console.log(`   - GET/POST  /api/notifications`);
  console.log(`📱 Frontend: Student Mobile Simulator + Admin CMS Portal`);
  console.log(`=======================================================`);
});
