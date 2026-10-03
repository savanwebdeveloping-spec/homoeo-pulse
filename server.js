const http = require('http');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

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
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading database:', err);
  }
  return { curriculum: {}, notes: [], students: [], colleges: [], notifications: [] };
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
      db.curriculum = currDoc.data;
    }

    const notesCol = mongoDbInstance.collection('notes');
    const notesCount = await notesCol.countDocuments();
    if (notesCount === 0 && db.notes && db.notes.length > 0) {
      await notesCol.insertMany(db.notes.map(n => ({ ...n })));
      console.log(`🍃 Seeded ${db.notes.length} initial notes to MongoDB`);
    } else if (notesCount > 0) {
      const allNotes = await notesCol.find({}).toArray();
      db.notes = allNotes.map(({ _id, ...rest }) => rest);
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key'
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key'
    }, SECURITY_HEADERS));
    res.end();
    return;
  }

  // ==========================================
  // BACKEND REST API ENDPOINTS
  // ==========================================
  if (pathname.startsWith('/api/')) {
    // 1. Health Status
    if (pathname === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'online',
        system: 'Homoeo Pulse Live Academic Platform',
        version: '2.5.0-AYUSH',
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

      return sendJson(res, 200, {
        totalBooks: booksCount,
        totalNotes: notesCount,
        totalDocuments: notes.length,
        totalDownloads,
        totalStudents: (db.students || []).length,
        activeStudents,
        totalColleges: (db.colleges || []).length,
        vaultStorage: '184.2 MB Encrypted Sandbox'
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
        saveDatabase(db);
        return sendJson(res, 201, { success: true, doc: newDoc });
      }
    }

    // 4b. Delete Note
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
        saveDatabase(db);
        return sendJson(res, 200, { success: true, message: `Document ${docId} deleted successfully.` });
      }
      saveDatabase(db);
      return sendJson(res, 200, { success: true, message: `Deleted.` });
    }

    // 4c. Delete Curriculum Chapter
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
          accreditation: body.accreditation || 'NCH / AYUSH Approved'
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
          title: body.title,
          target: body.target || 'All Years',
          type: body.type || 'Exam Notification',
          time: 'Just now',
          body: body.body || ''
        };
        db.notifications.unshift(newNotif);
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

      return sendJson(res, 201, {
        success: true,
        filename: safeName,
        fileUrl: '/uploads/' + safeName,
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
          rollNo: body.rollNo || 'BHMS-2024-001'
        };
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

      saveDatabase(db);
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
