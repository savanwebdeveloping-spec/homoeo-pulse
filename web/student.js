// ============================================================
// HOMOEO PULSE - STUDENT MOBILE APP ENGINE & REAL-TIME SYNC
// ============================================================

// 1. App State & API Configuration
const API_BASE_URL = window.HOMOEO_PULSE_API_URL || 'https://homoeo-pulse.onrender.com';

let BHMS_CURRICULUM = (window.HOMOEO_DEFAULT_DATA && window.HOMOEO_DEFAULT_DATA.curriculum) ? window.HOMOEO_DEFAULT_DATA.curriculum : {};
let notesData = (window.HOMOEO_DEFAULT_DATA && window.HOMOEO_DEFAULT_DATA.notes) ? window.HOMOEO_DEFAULT_DATA.notes : [];
let currentAppYear = '1st Year';
let currentAppSubpart = 'books';
let currentSubjectFilter = '';
let currentSubjectCarouselIndex = 0;
let currentSelectedSubject = null;
let currentSelectedChapter = null;
let currentSubjectSubpart = 'books';

function formatDocTitle(title) {
  if (!title) return 'Medical Study Material';
  let clean = String(title).replace(/^\d{10,}_/, '');
  clean = clean.replace(/\.pdf$/i, '');
  clean = clean.replace(/[_\-]+/g, ' ');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean || 'Medical Textbook';
}
window.formatDocTitle = formatDocTitle;

const KNOWN_DRIVE_MAPPING = {
  'golwalla': '15uL8k_MFXQOwlHlQbk7t34GXymZhTKW5',
  'mathew': '13aQ3_EWbZhlcNMLI-DYaeautOffJzG4I',
  'harrison_s_manual_of_medicine_18e': '1AbR_owQCSLDTgYheM6kfta_XpW7tJr6R',
  '18e': '1AbR_owQCSLDTgYheM6kfta_XpW7tJr6R',
  'harrison_s_manual_of_medicine_19e': '1XBQJSo2zHCoKxPREivjDFcvhG7s0nmvn',
  '19e': '1XBQJSo2zHCoKxPREivjDFcvhG7s0nmvn',
  'harrison': '1XBQJSo2zHCoKxPREivjDFcvhG7s0nmvn',
  'manthappa': '1HHqf2v8PZXz5duH30tNQ7LVFvaFZJw60',
  'boloor': '1sHZ_zBe-Jb2xKe1bd8PkdLNCCnNi5mDC',
  'nayak': '1sHZ_zBe-Jb2xKe1bd8PkdLNCCnNi5mDC',
  'maheta': '11Za5JjUfEBp1OHYhL0uLDE3dsToDYL_r',
  'mehta': '11Za5JjUfEBp1OHYhL0uLDE3dsToDYL_r',
  'alagappan': '1qqby-npnOEiOUeKbpdgZbhFb9nEfeaiQ',
  'davidson': '1bzIfkYOLDMcgDt5rrX9smkb-lvxl7Cx4',
  'suryakantha': '17gXct122Z1-iYwEV_mV1qPb9C4KTl7Ym',
  'psm': '17gXct122Z1-iYwEV_mV1qPb9C4KTl7Ym',
  'hutchisons': '1vEMtXv80wggJrfiThUIrzM2XRRq34ky-'
};

function getDriveFileId(str) {
  if (!str) return null;
  const lower = String(str).toLowerCase();
  for (const [key, driveId] of Object.entries(KNOWN_DRIVE_MAPPING)) {
    if (lower.includes(key)) return driveId;
  }
  const match = String(str).match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?export=download&id=)|id=)([a-zA-Z0-9_-]{25,})/i);
  if (match && match[1]) return match[1];
  return null;
}
window.getDriveFileId = getDriveFileId;

function formatDriveUrl(rawUrl) {
  if (!rawUrl) return '';
  if (rawUrl.includes('/api/pdf-stream')) return rawUrl;
  if (rawUrl.includes('drive.usercontent.google.com/download')) return rawUrl;

  const lower = rawUrl.toLowerCase();
  for (const [key, driveId] of Object.entries(KNOWN_DRIVE_MAPPING)) {
    if (lower.includes(key)) {
      return `https://drive.usercontent.google.com/download?id=${driveId}&export=download&authuser=0`;
    }
  }

  const match = rawUrl.match(/(?:drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?export=download&id=)|id=)([a-zA-Z0-9_-]{25,})/i);
  if (match && match[1]) {
    return `https://drive.usercontent.google.com/download?id=${match[1]}&export=download&authuser=0`;
  }
  return rawUrl;
}
window.formatDriveUrl = formatDriveUrl;

// Offline Mozilla PDF.js Worker Configuration
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
}

// ============================================================
// INDEXEDDB OFFLINE STUDY VAULT ENGINE
// ============================================================
const VAULT_DB_NAME = 'HomoeoPulseVault';
const VAULT_DB_VERSION = 1;
const VAULT_STORE_NAME = 'offline_books';

function openVaultDB() {
  return new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
        db.createObjectStore(VAULT_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function savePdfToVault(docId, arrayBuffer) {
  try {
    const db = await openVaultDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VAULT_STORE_NAME);
      store.put(arrayBuffer, String(docId));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('savePdfToVault error:', e);
    return false;
  }
}

async function getPdfFromVault(docId) {
  try {
    const db = await openVaultDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(VAULT_STORE_NAME, 'readonly');
      const store = tx.objectStore(VAULT_STORE_NAME);
      const req = store.get(String(docId));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function removePdfFromVault(docId) {
  try {
    const db = await openVaultDB();
    if (!db) return;
    const tx = db.transaction(VAULT_STORE_NAME, 'readwrite');
    tx.objectStore(VAULT_STORE_NAME).delete(String(docId));
  } catch (e) {}
}

// ============================================================
// OFFLINE VAULT & BOOKMARKS PERSISTENCE ENGINE
// ============================================================
function getDownloadedDocIds() {
  try {
    return JSON.parse(localStorage.getItem('hp_vault_downloads') || '[]');
  } catch (e) {
    return [];
  }
}

function setDocDownloadedInStorage(docId, isDownloaded, docMeta = null) {
  try {
    let ids = getDownloadedDocIds();
    const idStr = String(docId);
    if (isDownloaded) {
      if (!ids.includes(idStr)) ids.push(idStr);
      if (docMeta) {
        const metaMap = JSON.parse(localStorage.getItem('hp_vault_docs_meta') || '{}');
        metaMap[idStr] = {
          id: docMeta.id,
          title: docMeta.title,
          author: docMeta.author,
          subject: docMeta.subject,
          pages: docMeta.pages,
          year: docMeta.year,
          fileUrl: docMeta.fileUrl,
          downloaded: true,
          bookmarked: docMeta.bookmarked || false
        };
        localStorage.setItem('hp_vault_docs_meta', JSON.stringify(metaMap));
      }
    } else {
      ids = ids.filter(id => id !== idStr);
      const metaMap = JSON.parse(localStorage.getItem('hp_vault_docs_meta') || '{}');
      delete metaMap[idStr];
      localStorage.setItem('hp_vault_docs_meta', JSON.stringify(metaMap));
    }
    localStorage.setItem('hp_vault_downloads', JSON.stringify(ids));
  } catch (e) {}
}

function getBookmarkedDocIds() {
  try {
    return JSON.parse(localStorage.getItem('hp_vault_bookmarks') || '[]');
  } catch (e) {
    return [];
  }
}

function setDocBookmarkedInStorage(docId, isBookmarked, docMeta = null) {
  try {
    let ids = getBookmarkedDocIds();
    const idStr = String(docId);
    if (isBookmarked) {
      if (!ids.includes(idStr)) ids.push(idStr);
      if (docMeta) {
        const metaMap = JSON.parse(localStorage.getItem('hp_vault_bookmarks_meta') || '{}');
        metaMap[idStr] = {
          id: docMeta.id,
          title: docMeta.title,
          author: docMeta.author,
          subject: docMeta.subject,
          pages: docMeta.pages,
          year: docMeta.year,
          fileUrl: docMeta.fileUrl,
          downloaded: docMeta.downloaded || false,
          bookmarked: true
        };
        localStorage.setItem('hp_vault_bookmarks_meta', JSON.stringify(metaMap));
      }
    } else {
      ids = ids.filter(id => id !== idStr);
      const metaMap = JSON.parse(localStorage.getItem('hp_vault_bookmarks_meta') || '{}');
      delete metaMap[idStr];
      localStorage.setItem('hp_vault_bookmarks_meta', JSON.stringify(metaMap));
    }
    localStorage.setItem('hp_vault_bookmarks', JSON.stringify(ids));
  } catch (e) {}
}

function syncVaultStatus() {
  const downloadedIds = getDownloadedDocIds();
  const bookmarkedIds = getBookmarkedDocIds();

  notesData.forEach(d => {
    const idStr = String(d.id);
    d.downloaded = downloadedIds.includes(idStr);
    d.bookmarked = bookmarkedIds.includes(idStr);
  });
}


// Detect native Capacitor Android wrapper
if (window.Capacitor || navigator.userAgent.includes('wv') || window.location.protocol === 'capacitor:') {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('is-native-app');
  });
}

let currentUserProfile = {
  name: '',
  year: '1st Year',
  college: '',
  email: '',
  rollNo: '',
  isSetupDone: false
};

// PDF Viewer State
let currentViewingDoc = null;
let currentViewerPage = 1;
let currentPdfDoc = null;
let currentPdfScale = 0.95;
let currentRenderingTask = null;
let pdfViewerOriginScreen = 'appScreenDashboard';

// ============================================================
// REAL-TIME BROADCAST & SERVER SYNC CHANNEL
// ============================================================
const syncChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('homoeo_pulse_sync') : null;
const appSessionStartTime = Date.now();
let lastKnownNotifId = localStorage.getItem('hp_last_seen_notif_id') || null;
let lastKnownStatsSig = null;
let isInitialSyncDone = false;

function setupRealtimeSync() {
  // 1. Instant sync via BroadcastChannel (Same device / different tabs)
  if (syncChannel) {
    syncChannel.onmessage = async (event) => {
      if (event.data && event.data.type === 'DATA_UPDATED') {
        console.log('📡 Real-time update signal received from Faculty Admin CMS!');
        await syncWithBackend(false);
      }
    };
  }

  // 2. Storage event fallback across tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'hp_last_sync_time') {
      syncWithBackend(false);
    }
  });

  // 3. Periodic Background Polling (Every 3.5 seconds) to catch cloud/admin edits
  setInterval(async () => {
    try {
      const res = await fetch((API_BASE_URL || '') + '/api/stats');
      if (res.ok) {
        const stats = await res.json();
        const currentSig = `${stats.totalDocuments}_${stats.lastUpdated || 0}_${stats.totalNotifications || 0}`;

        // FIRST RUN (App Launch / Cold Start):
        // Record baseline state and DO NOT trigger any notifications for past uploads!
        if (!isInitialSyncDone) {
          isInitialSyncDone = true;
          lastKnownStatsSig = currentSig;
          if (stats.latestNotification && stats.latestNotification.id) {
            lastKnownNotifId = stats.latestNotification.id;
            localStorage.setItem('hp_last_seen_notif_id', stats.latestNotification.id);
          }
          return;
        }

        // Subsequent runs: Only trigger if something changed while the app was running!
        if (lastKnownStatsSig && currentSig !== lastKnownStatsSig) {
          lastKnownStatsSig = currentSig;

          // Silently refresh books and notes in background
          await syncWithBackend(false);

          const newNotif = stats.latestNotification;
          // Trigger notification ONLY if there is a genuinely new notification id
          if (newNotif && newNotif.id && newNotif.id !== lastKnownNotifId) {
            lastKnownNotifId = newNotif.id;
            localStorage.setItem('hp_last_seen_notif_id', newNotif.id);

            // Trigger notification ONLY for the newly uploaded / edited item!
            triggerPhonePushNotification(newNotif.title, newNotif.body, newNotif.docId);
          }
        }
      }
    } catch (e) {}
  }, 3500);
}

// ============================================================
// APP INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  showSplashScreen();
  setupRealtimeSync();

  // Load initial local data
  loadLocalProfile();
  renderUserProfileUI();
  syncVaultStatus();

  // Initial render
  updateYearSubpartCounts();
  renderAppContentForYear(currentAppYear, currentAppSubpart);
  updateResumeCardUI();
  updateVaultCounts();

  // Connect to backend server
  await syncWithBackend(false);
});

async function syncWithBackend(isAutoUpdate = false) {
  try {
    const res = await fetch((API_BASE_URL || '') + '/api/bootstrap');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.notes)) {
        notesData = data.notes.map(n => {
          if (n.fileUrl) n.fileUrl = formatDriveUrl(n.fileUrl);
          return n;
        });
        syncVaultStatus();
      }
      if (data.curriculum && Object.keys(data.curriculum).length > 0) BHMS_CURRICULUM = data.curriculum;
      // Do NOT overwrite user's saved local profile with backend bootstrap mock profile!
      // Local profile is device-specific and persists until app uninstallation.

      updateYearSubpartCounts();
      renderAppContentForYear(currentAppYear, currentAppSubpart);
      updateResumeCardUI();
      renderUserProfileUI();
      updateVaultCounts();
      if (document.getElementById('appScreenVault')?.classList.contains('active')) renderVaultScreen();

      if (currentSelectedSubject) {
        // Re-find subject in updated curriculum
        const updatedSub = (BHMS_CURRICULUM[currentAppYear] || []).find(s => s.name === currentSelectedSubject.name);
        if (updatedSub) {
          currentSelectedSubject = updatedSub;
          if (document.getElementById('appScreenChapters').classList.contains('active')) {
            openSubjectChapters(updatedSub);
          } else if (document.getElementById('appScreenNotesList').classList.contains('active')) {
            renderAppDocsForSubject(updatedSub, currentSubjectSubpart, 'All');
          }
        }
      }
    }
  } catch (err) {
    console.warn('Backend connection offline, using cached sandbox');
  }
}

function loadLocalProfile() {
  try {
    const profKeys = ['hp_user_profile_v5', 'hp_user_profile', 'hp_user_profile_v4'];
    for (const key of profKeys) {
      const prof = localStorage.getItem(key);
      if (prof) {
        const parsed = JSON.parse(prof);
        if (parsed && parsed.name && parsed.name.trim().length > 0 && parsed.name !== 'BHMS Scholar') {
          currentUserProfile = {
            name: parsed.name.trim(),
            year: parsed.year || '1st Year',
            college: parsed.college || '',
            email: parsed.email || '',
            rollNo: parsed.rollNo || '',
            isSetupDone: true
          };
          saveLocalProfile();
          return;
        }
      }
    }
  } catch (e) {
    console.warn('LocalStorage profile load error:', e);
  }

  // Default fresh install state: Profile Pending
  currentUserProfile = {
    name: '',
    year: '1st Year',
    college: '',
    email: '',
    rollNo: '',
    isSetupDone: false
  };
}

function saveLocalProfile() {
  try {
    if (currentUserProfile && currentUserProfile.name && currentUserProfile.name.trim().length > 0) {
      currentUserProfile.isSetupDone = true;
    }
    const dataStr = JSON.stringify(currentUserProfile);
    localStorage.setItem('hp_user_profile_v5', dataStr);
    localStorage.setItem('hp_user_profile', dataStr);
  } catch (e) {
    console.warn('LocalStorage profile save error:', e);
  }
}

let splashTimeout = null;
let splashProgressInterval = null;

function showSplashScreen() {
  const el = document.getElementById('appSplashScreen');
  const fill = document.getElementById('splashLoaderFill');
  const status = document.getElementById('splashStatusText');
  if (!el) return;

  if (splashTimeout) clearTimeout(splashTimeout);
  if (splashProgressInterval) clearInterval(splashProgressInterval);

  el.style.display = 'flex';
  el.classList.remove('fade-out');
  el.classList.remove('hidden');

  if (fill) fill.style.width = '6%';
  if (status) status.innerText = 'Connecting to Medical Cloud Platform...';

  const startTime = Date.now();
  const totalDuration = 1400; // 1.4 seconds smooth & snappy

  splashProgressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const pct = Math.min(Math.floor((elapsed / totalDuration) * 100), 96);
    if (fill) fill.style.width = `${pct}%`;

    if (elapsed < 400) {
      if (status) status.innerText = 'Connecting to Medical Cloud Platform...';
    } else if (elapsed < 800) {
      if (status) status.innerText = 'Verifying Academic Curriculum & Vault...';
    } else if (elapsed < 1200) {
      if (status) status.innerText = 'Synchronizing Standard Textbooks & Notes...';
    } else {
      if (status) status.innerText = currentUserProfile ? `Welcome, ${currentUserProfile.name}!` : 'Ready!';
    }
  }, 40);

  splashTimeout = setTimeout(() => {
    if (splashProgressInterval) clearInterval(splashProgressInterval);
    if (fill) fill.style.width = '100%';
    if (status) status.innerText = currentUserProfile ? `Welcome, ${currentUserProfile.name}!` : 'Ready!';

    setTimeout(() => {
      dismissSplashScreen();
    }, 200);
  }, totalDuration);
}

function dismissSplashScreen() {
  const el = document.getElementById('appSplashScreen');
  if (!el) return;

  if (splashTimeout) clearTimeout(splashTimeout);
  if (splashProgressInterval) clearInterval(splashProgressInterval);

  const fill = document.getElementById('splashLoaderFill');
  if (fill) fill.style.width = '100%';

  el.classList.add('fade-out');
  setTimeout(() => {
    el.classList.add('hidden');
    el.style.display = 'none';

    // On fresh install / after uninstall & re-download:
    // If profile has never been set up, prompt user to enter their profile!
    const isConfigured = Boolean(
      currentUserProfile &&
      currentUserProfile.isSetupDone &&
      currentUserProfile.name &&
      currentUserProfile.name.trim().length > 0 &&
      currentUserProfile.name !== 'BHMS Scholar'
    );
    if (!isConfigured) {
      setTimeout(() => {
        openEditProfileModal();
      }, 400);
    }
  }, 600);
}
window.dismissSplashScreen = dismissSplashScreen;

// ============================================================
// NOTIFICATION CHIME TUNE & PUSH NOTIFICATION ENGINE
// ============================================================
let notificationAudioContext = null;

function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      if (!notificationAudioContext) {
        notificationAudioContext = new AudioCtx();
      }
      if (notificationAudioContext.state === 'suspended') {
        notificationAudioContext.resume();
      }
      const ctx = notificationAudioContext;
      const now = ctx.currentTime;

      const master = ctx.createGain();
      master.gain.setValueAtTime(0.35, now);
      master.connect(ctx.destination);

      // Bell Tone 1: D5 (587.33 Hz) warm crystal
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.7, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc1.connect(gain1);
      gain1.connect(master);
      osc1.start(now);
      osc1.stop(now + 0.7);

      // Bell Tone 2: A5 (880.00 Hz) sweet ringing chime
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(880.00, now + 0.08);
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.setValueAtTime(0.85, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
      osc2.connect(gain2);
      gain2.connect(master);
      osc2.start(now + 0.08);
      osc2.stop(now + 1.15);

      // Bell Shimmer Harmonic: 1760 Hz
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(1760.00, now + 0.09);
      gain3.gain.setValueAtTime(0.001, now);
      gain3.gain.setValueAtTime(0.25, now + 0.09);
      gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      osc3.connect(gain3);
      gain3.connect(master);
      osc3.start(now + 0.09);
      osc3.stop(now + 0.75);

      return;
    }
  } catch (e) {
    console.warn('Web Audio chime fallback:', e);
  }

  // Fallback to audio element
  try {
    const audio = document.getElementById('notifAudioTune') || new Audio('notification_chime.wav');
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch (e) {}
}
window.playNotificationChime = playNotificationChime;

// Unlock Audio on first user interaction for seamless mobile autoplay
function unlockAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && !notificationAudioContext) {
      notificationAudioContext = new AudioCtx();
    }
    if (notificationAudioContext && notificationAudioContext.state === 'suspended') {
      notificationAudioContext.resume();
    }
    const audio = document.getElementById('notifAudioTune');
    if (audio) {
      audio.load();
    }
  } catch (e) {}
}
window.addEventListener('click', unlockAudioContext, { once: true, passive: true });
window.addEventListener('touchstart', unlockAudioContext, { once: true, passive: true });

function triggerPhonePushNotification(title, msg, optDocId = null) {
  // 1. Play crystal notification tune!
  playNotificationChime();

  // 2. Gentle haptic vibration on phone
  try {
    if (navigator.vibrate) {
      navigator.vibrate([80, 40, 100]);
    }
  } catch (e) {}

  // 3. Show in-app floating toast
  const toast = document.getElementById('phoneNotifToast');
  if (toast) {
    document.getElementById('toastTitle').innerText = title;
    document.getElementById('toastMsg').innerText = msg;
    if (optDocId) {
      toast.onclick = () => {
        toast.classList.remove('show');
        openPdfViewer(optDocId);
      };
    } else {
      toast.onclick = () => {
        toast.classList.remove('show');
        switchAppTab('dashboard');
      };
    }
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 6000);
  }
}

function openNotifDetails() {
  const toast = document.getElementById('phoneNotifToast');
  if (toast) toast.classList.remove('show');
  switchAppTab('dashboard');
}

// ============================================================
// RESUME STUDY CARD
// ============================================================
function updateResumeCardUI() {
  const card = document.getElementById('appResumeCard');
  if (!card) return;
  const doc = currentViewingDoc || (notesData && notesData.length > 0 ? notesData[0] : null);
  if (!doc) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  const tEl = document.getElementById('resumeTitle');
  if (tEl) tEl.innerText = formatDocTitle(doc.title);
  const sEl = document.getElementById('resumeSub');
  if (sEl) sEl.innerText = `${doc.subject} • ${doc.contentType === 'book' ? 'Standard Book' : (doc.category || 'Study Material')}`;
  const bEl = document.getElementById('resumePageBadge');
  if (bEl) bEl.innerText = `Page ${doc.currentPage || 1} of ${doc.pages || 1}`;
  const pEl = document.getElementById('resumeProgressBar');
  if (pEl) pEl.style.width = `${((doc.currentPage || 1) / (doc.pages || 1)) * 100}%`;
}

function openCurrentRecentPdf() {
  if (currentViewingDoc) {
    openPdfViewer(currentViewingDoc.id);
  } else if (notesData.length > 0) {
    openPdfViewer(notesData[0].id);
  }
}

// ============================================================
// YEAR SELECTOR & SUBPART (BOOKS VS NOTES)
// ============================================================
function selectAppYear(year) {
  currentAppYear = year;
  document.querySelectorAll('#appYearPills .year-pill').forEach(pill => {
    pill.classList.toggle('active', pill.getAttribute('data-year') === year);
  });
  const yearSubjects = BHMS_CURRICULUM[year] || [];
  currentSubjectFilter = yearSubjects.length > 0 ? yearSubjects[0].name : '';
  currentSubjectCarouselIndex = 0;
  updateYearSubpartCounts();
  renderAppContentForYear(year, currentAppSubpart);
}

function updateYearSubpartCounts() {
  const books = notesData.filter(d => d.year === currentAppYear && d.contentType === 'book');
  const notes = notesData.filter(d => d.year === currentAppYear && d.contentType === 'note');

  const bCount = document.getElementById('badgeBooksCount');
  const nCount = document.getElementById('badgeNotesCount');
  if (bCount) bCount.innerText = books.length;
  if (nCount) nCount.innerText = notes.length;
}

function switchYearSubpart(subpart) {
  currentAppSubpart = subpart;

  const btnB = document.getElementById('btnSubpartBooks');
  const btnN = document.getElementById('btnSubpartNotes');
  if (btnB) btnB.classList.toggle('active', subpart === 'books');
  if (btnN) btnN.classList.toggle('active', subpart === 'notes');

  const titleEl = document.getElementById('appSubjectListTitle');
  const badgeEl = document.getElementById('appSubpartBadge');

  if (subpart === 'books') {
    if (titleEl) titleEl.innerText = `${currentAppYear} • Standard Textbooks`;
    if (badgeEl) {
      badgeEl.innerText = 'BOOKS CATALOG';
      badgeEl.style.background = 'var(--brand-green-pale)';
      badgeEl.style.color = 'var(--brand-green)';
    }
  } else {
    if (titleEl) titleEl.innerText = `${currentAppYear} • Curriculum Subjects & Notes`;
    if (badgeEl) {
      badgeEl.innerText = 'ACADEMIC NOTES';
      badgeEl.style.background = '#FEF3C7';
      badgeEl.style.color = '#B45309';
    }
  }

  updateYearSubpartCounts();
  renderAppContentForYear(currentAppYear, subpart);
}

// ============================================================
// SUBJECT CAROUSEL & CONTENT RENDERER
// ============================================================
function renderAppContentForYear(year, subpart) {
  const container = document.getElementById('appSubjectsContainer');
  if (!container) return;
  container.innerHTML = '';

  const subjects = BHMS_CURRICULUM[year] || [];
  if (subjects.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);">No subjects found for this year.</div>';
    return;
  }

  // 1. Subject Carousel (Curriculum Subjects Only)
  const carouselWrapper = document.createElement('div');
  carouselWrapper.className = 'subject-carousel-wrapper';

  const carouselItems = subjects.map((s, idx) => ({
    id: s.name,
    name: s.name,
    icon: s.icon || '📖',
    countBadge: `Subject ${idx + 1} of ${subjects.length}`
  }));

  let activeIndex = carouselItems.findIndex(item => item.id === currentSubjectFilter);
  if (activeIndex === -1) {
    activeIndex = 0;
    currentSubjectFilter = carouselItems[0].id;
  }
  const currentItem = carouselItems[activeIndex];
  const currentSubObj = subjects.find(s => s.name === currentItem.id) || subjects[activeIndex];
  const booksForActiveSub = notesData.filter(d => d.year === year && d.subject === currentItem.id && d.contentType === 'book');
  const directNotesForActiveSub = notesData.filter(d => d.year === year && (d.subject === currentItem.id || (currentSubObj && currentSubObj.code && d.subject === currentSubObj.code)) && d.contentType === 'note');
  const activeChaptersCount = (currentSubObj && currentSubObj.chapters && currentSubObj.chapters.length > 0)
    ? currentSubObj.chapters.length
    : (directNotesForActiveSub.length > 0 ? 1 : 0);
  const countLabel = subpart === 'books'
    ? `${booksForActiveSub.length} Standard Books`
    : `${activeChaptersCount} Chapters`;

  carouselWrapper.innerHTML = `
    <button class="subj-arrow-btn prev" type="button" aria-label="Previous Subject" onclick="navigateSubjectCarousel(-1)">
      ‹
    </button>
    <div class="subj-center-card" onclick="handleCenterSubjectClick('${currentItem.id}')">
      <div class="subj-center-meta">
        <span class="subj-center-badge">${currentItem.countBadge}</span>
        <span class="subj-center-count-chip">${subpart === 'books' ? '📚' : '📝'} ${countLabel}</span>
      </div>
      <div class="subj-center-info">
        <span class="subj-center-icon">${currentItem.icon}</span>
        <span class="subj-center-name">${currentItem.name}</span>
      </div>
      <div class="subj-center-dots">
        ${carouselItems.map((it, idx) => `
          <span class="subj-carousel-dot ${idx === activeIndex ? 'active' : ''}" onclick="event.stopPropagation(); jumpToSubjectCarouselIndex(${idx})"></span>
        `).join('')}
      </div>
    </div>
    <button class="subj-arrow-btn next" type="button" aria-label="Next Subject" onclick="navigateSubjectCarousel(1)">
      ›
    </button>
  `;

  // Native mobile touch swipe for subject carousel
  let carouselTouchX = 0;
  let carouselTouchY = 0;
  carouselWrapper.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      carouselTouchX = e.touches[0].clientX;
      carouselTouchY = e.touches[0].clientY;
    }
  }, { passive: true });

  carouselWrapper.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1) {
      const diffX = e.changedTouches[0].clientX - carouselTouchX;
      const diffY = e.changedTouches[0].clientY - carouselTouchY;
      if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0) {
          navigateSubjectCarousel(1); // Swipe left -> Next
        } else {
          navigateSubjectCarousel(-1); // Swipe right -> Previous
        }
      }
    }
  }, { passive: true });

  container.appendChild(carouselWrapper);

  const activeSubjects = subjects.filter(s => s.name === currentSubjectFilter);

  // 2. Render Textbooks or Notes directly under Subject Carousel (No duplicate banner)
  if (subpart === 'books') {
    activeSubjects.forEach(sub => {
      const booksForSub = notesData.filter(d => d.year === year && d.subject === sub.name && d.contentType === 'book');

      if (booksForSub.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'font-size:11.5px;color:var(--text-muted);padding:24px 16px;background:#FFFFFF;border-radius:12px;border:1px dashed var(--border);margin-bottom:12px;text-align:center;';
        emptyDiv.innerHTML = `<span style="font-size:24px;display:block;margin-bottom:6px;">📚</span>No textbooks uploaded for ${sub.name} yet.`;
        container.appendChild(emptyDiv);
      } else {
        booksForSub.forEach(b => {
          const card = document.createElement('div');
          card.className = 'book-card-item';
          card.style.cursor = 'pointer';
          card.onclick = () => openPdfViewer(b.id);
          card.innerHTML = `
            <div class="book-spine-cover">
              <span>📖</span>
            </div>
            <div class="book-card-details">
              <div class="book-card-title">${formatDocTitle(b.title)}</div>
              <div class="book-card-author">By ${b.author}</div>
              <div class="book-card-meta">
                <span class="badge-tag year" style="font-size:9px;padding:1px 6px;">${b.subject}</span>
                <span>${b.pages} Pages</span>
                <span>•</span>
                <span>${b.size}</span>
              </div>
              <div style="display:flex;gap:6px;margin-top:8px;">
                <button class="btn-doc-open" style="padding:4px 12px;font-size:10px;" onclick="event.stopPropagation(); openPdfViewer('${b.id}')">Read Book</button>
                <button class="btn-doc-download ${b.downloaded ? 'downloaded' : ''}" style="padding:4px 8px;font-size:10px;" onclick="event.stopPropagation(); toggleDocDownload('${b.id}')">
                  ${b.downloaded ? '✓ Offline' : '📥 Save'}
                </button>
              </div>
            </div>
          `;
          container.appendChild(card);
        });
      }
    });
  } else {
    // 3. Render Academic Notes Chapters directly under Subject Carousel (No duplicate tile)
    activeSubjects.forEach(sub => {
      let chapters = (sub.chapters && sub.chapters.length > 0) ? [...sub.chapters] : [];

      // Check if there are notes uploaded under notesData for this subject
      const directNotes = notesData.filter(d =>
        d.year === year &&
        (d.subject === sub.name || (sub.code && d.subject === sub.code)) &&
        d.contentType === 'note'
      );

      // If no chapters exist in curriculum but direct notes exist in notesData, synthesize chapter
      if (chapters.length === 0 && directNotes.length > 0) {
        chapters = [
          {
            id: 'ch_auto_' + (sub.id || 'notes'),
            title: 'Chapter 1: Academic Study Notes',
            desc: 'Faculty lecture notes, question banks, and clinical topics.',
            topics: directNotes.map(n => ({
              id: n.id,
              title: n.title,
              pages: n.pages || 14,
              size: n.size || '3.5 MB',
              fileUrl: n.fileUrl,
              summary: n.summary || 'Clinical homoeopathic study reference notes.'
            }))
          }
        ];
      }

      if (chapters.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'font-size:11.5px;color:var(--text-muted);padding:24px 16px;background:#FFFFFF;border-radius:12px;border:1px dashed var(--border);margin-bottom:12px;text-align:center;';
        emptyDiv.innerHTML = `<span style="font-size:24px;display:block;margin-bottom:6px;">📝</span>No chapters uploaded for ${sub.name} yet.`;
        container.appendChild(emptyDiv);
      } else {
        chapters.forEach((ch, idx) => {
          const chEl = document.createElement('div');
          chEl.className = 'chapter-card-item';
          const chNum = (idx + 1).toString().padStart(2, '0');
          const numTopics = ch.topics ? ch.topics.length : 0;
          chEl.onclick = () => openChapterTopics(ch, 'appScreenDashboard');
          chEl.innerHTML = `
            <div class="ch-header-row">
              <span class="ch-num-badge">CHAPTER ${chNum}</span>
              <span class="ch-topics-count">📑 ${numTopics} Topics</span>
            </div>
            <div class="ch-title">${ch.title}</div>
            <div class="ch-desc">${ch.desc || 'High-yield clinical study notes and lecture topics.'}</div>
            <div class="ch-footer-row">
              <span>Verified Medical Study Material</span>
              <span class="ch-cta">Explore Topics ›</span>
            </div>
          `;
          container.appendChild(chEl);
        });
      }
    });
  }
}

function handleCenterSubjectClick(subjectId) {
  const sub = (BHMS_CURRICULUM[currentAppYear] || []).find(s => s.name === subjectId);
  if (sub) {
    if (currentAppSubpart === 'books') openSubjectByName(sub.name, 'books');
    else openSubjectChapters(sub);
  }
}

function navigateSubjectCarousel(direction) {
  const subjects = BHMS_CURRICULUM[currentAppYear] || [];
  if (subjects.length === 0) return;
  const carouselItems = subjects.map(s => s.name);
  let idx = carouselItems.indexOf(currentSubjectFilter);
  if (idx === -1) idx = 0;
  idx = (idx + direction + carouselItems.length) % carouselItems.length;
  currentSubjectFilter = carouselItems[idx];
  renderAppContentForYear(currentAppYear, currentAppSubpart);
}

function jumpToSubjectCarouselIndex(idx) {
  const subjects = BHMS_CURRICULUM[currentAppYear] || [];
  if (subjects.length === 0) return;
  const carouselItems = subjects.map(s => s.name);
  if (idx >= 0 && idx < carouselItems.length) {
    currentSubjectFilter = carouselItems[idx];
    renderAppContentForYear(currentAppYear, currentAppSubpart);
  }
}

// ============================================================
// CHAPTERS & TOPICS DRILL-DOWN
// ============================================================
function openSubjectChapters(subject) {
  currentSelectedSubject = subject;

  document.getElementById('chaptersSubjectTitle').innerText = subject.name;
  document.getElementById('chaptersSubjectCode').innerText = subject.code || 'BHMS';
  document.getElementById('chaptersIntroName').innerText = subject.name;
  document.getElementById('chaptersIntroIcon').innerText = subject.icon || '📖';
  document.getElementById('chaptersIntroDesc').innerText = subject.desc || 'BHMS Curriculum';

  const container = document.getElementById('appChaptersContainer');
  if (container) {
    container.innerHTML = '';
    let chapters = (subject.chapters && subject.chapters.length > 0) ? [...subject.chapters] : [];
    if (chapters.length === 0) {
      const directNotes = notesData.filter(d =>
        d.year === currentAppYear &&
        (d.subject === subject.name || (subject.code && d.subject === subject.code)) &&
        d.contentType === 'note'
      );
      if (directNotes.length > 0) {
        chapters = [
          {
            id: 'ch_auto_' + (subject.id || 'notes'),
            title: 'Chapter 1: Academic Study Notes',
            desc: 'Faculty lecture notes, question banks, and clinical topics.',
            topics: directNotes.map(n => ({
              id: n.id,
              title: n.title,
              pages: n.pages || 14,
              size: n.size || '3.5 MB',
              fileUrl: n.fileUrl,
              summary: n.summary || 'Clinical homoeopathic study reference notes.'
            }))
          }
        ];
      }
    }

    if (chapters.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:36px 16px;background:#FFF;border:1px dashed var(--border);border-radius:12px;color:var(--text-muted);">
          <div style="font-size:32px;margin-bottom:8px;">📑</div>
          <div style="font-weight:700;color:var(--text);">No Chapters Published Yet</div>
          <div style="font-size:11px;margin-top:4px;">When faculty uploads course chapters &amp; notes, they will appear here live.</div>
        </div>
      `;
    } else {
      chapters.forEach((ch, idx) => {
        const card = document.createElement('div');
        card.className = 'chapter-card-item';
        const chNum = (idx + 1).toString().padStart(2, '0');
        const numTopics = ch.topics ? ch.topics.length : 0;
        card.onclick = () => openChapterTopics(ch);
        card.innerHTML = `
          <div class="ch-header-row">
            <span class="ch-num-badge">CH ${chNum}</span>
            <span class="ch-topics-count">📑 ${numTopics} Topics</span>
          </div>
          <div class="ch-title">${ch.title}</div>
          <div class="ch-desc">${ch.desc || 'Clinical chapter lecture notes.'}</div>
          <div class="ch-footer-row">
            <span>Verified BHMS Curriculum</span>
            <span class="ch-cta">Explore Topics ›</span>
          </div>
        `;
        container.appendChild(card);
      });
    }
  }

  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  const sc = document.getElementById('appScreenChapters');
  if (sc) sc.classList.add('active');
}

let currentTopicsOriginScreen = 'appScreenDashboard';

function openChapterTopics(chapter, originScreen = 'appScreenChapters') {
  currentTopicsOriginScreen = originScreen;
  currentSelectedChapter = chapter;

  // Auto-detect parent subject if not selected
  if (!currentSelectedSubject) {
    const subjects = BHMS_CURRICULUM[currentAppYear] || [];
    currentSelectedSubject = subjects.find(s => (s.chapters || []).some(c => c.id === chapter.id || c.title === chapter.title)) || subjects[0];
  }

  const subjName = currentSelectedSubject ? currentSelectedSubject.name : 'Community Medicine';
  const breadcrumb = document.getElementById('topicsBreadcrumb');
  if (breadcrumb) breadcrumb.innerHTML = `${subjName} <span>›</span> ${chapter.title}`;

  const backLabel = document.getElementById('topicsBackLabel');
  if (backLabel) {
    backLabel.innerText = originScreen === 'appScreenDashboard' ? 'Dashboard' : 'Chapters';
  }

  const titleEl = document.getElementById('topicsChapterTitle');
  if (titleEl) titleEl.innerText = chapter.title;

  const numTopics = chapter.topics ? chapter.topics.length : 0;
  const subEl = document.getElementById('topicsChapterSub');
  if (subEl) subEl.innerText = `${numTopics} Topics with High-Yield Medical PDFs`;

  const descEl = document.getElementById('topicsChapterDesc');
  if (descEl) descEl.innerText = chapter.desc || 'Lecture notes, examination topics, and clinical correlations.';

  const container = document.getElementById('appTopicsContainer');
  if (container) {
    container.innerHTML = '';
    if (!chapter.topics || chapter.topics.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:36px 16px;background:#FFF;border:1px dashed var(--border);border-radius:12px;color:var(--text-muted);">
          <div style="font-size:32px;margin-bottom:8px;">📝</div>
          <div style="font-weight:700;color:var(--text);">No Topics in this Chapter Yet</div>
          <div style="font-size:11px;margin-top:4px;">Topics uploaded by faculty will appear here instantly.</div>
        </div>
      `;
    } else {
      chapter.topics.forEach(top => {
        const card = document.createElement('div');
        card.className = 'topic-card-item';
        card.style.cursor = 'pointer';
        card.onclick = () => openTopicPdf(top.id);
        card.innerHTML = `
          <div class="topic-title-row">
            <div class="topic-title">${top.title}</div>
            <span class="topic-pdf-badge">PDF</span>
          </div>
          <div class="topic-summary">${top.summary || 'Clinical homoeopathic lecture note reference.'}</div>
          <div class="topic-meta-row">
            <span class="topic-meta-pill">📄 ${top.pages || 14} Pages</span>
            <span class="topic-meta-pill">💾 ${top.size || '3.5 MB'}</span>
            <span class="topic-meta-pill" style="color:var(--brand-green);border-color:#A7F3D0;background:var(--brand-green-pale);">✓ Standard Medical Syllabus</span>
          </div>
          <div class="topic-actions-row">
            <button class="btn-topic-read" onclick="event.stopPropagation(); openTopicPdf('${top.id}')">
              <span>📄</span>
              <span>Read PDF</span>
            </button>
            <button class="btn-topic-save" id="btnSaveTopic_${top.id}" onclick="toggleTopicOffline('${top.id}', event)">
              <span>📥 Save</span>
            </button>
          </div>
        `;
        container.appendChild(card);
      });
    }
  }

  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  const sc = document.getElementById('appScreenTopics');
  if (sc) sc.classList.add('active');
}

function openTopicPdf(topicIdOrObj) {
  let topic = null;
  let subjectName = currentSelectedSubject ? currentSelectedSubject.name : 'Homoeopathy';
  let chapterTitle = currentSelectedChapter ? currentSelectedChapter.title : 'Study Topic';

  if (typeof topicIdOrObj === 'object') {
    topic = topicIdOrObj;
  } else {
    if (currentSelectedChapter && currentSelectedChapter.topics) {
      topic = currentSelectedChapter.topics.find(t => t.id === topicIdOrObj);
    }
    if (!topic && BHMS_CURRICULUM) {
      for (const y in BHMS_CURRICULUM) {
        for (const sub of BHMS_CURRICULUM[y]) {
          if (sub.chapters) {
            for (const ch of sub.chapters) {
              if (ch.topics) {
                const found = ch.topics.find(t => t.id === topicIdOrObj);
                if (found) {
                  topic = found;
                  chapterTitle = ch.title;
                  subjectName = sub.name;
                  break;
                }
              }
            }
          }
        }
      }
    }
  }

  if (!topic) return;

  const docObj = {
    id: topic.id,
    title: topic.title,
    author: 'Faculty Department',
    year: currentAppYear,
    subject: subjectName,
    category: chapterTitle,
    contentType: 'note',
    size: topic.size || '3.5 MB',
    pages: topic.pages || 14,
    downloads: 1,
    summary: topic.summary || 'Clinical homoeopathic lecture note.',
    fileUrl: topic.fileUrl || '',
    bookmarked: false,
    downloaded: false,
    currentPage: 1
  };

  openPdfViewer(docObj);
}

function navigateBackFromChapters() {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  const sc = document.getElementById('appScreenDashboard');
  if (sc) sc.classList.add('active');
}

function navigateBackFromTopics() {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  const targetId = currentTopicsOriginScreen || 'appScreenDashboard';
  const sc = document.getElementById(targetId) || document.getElementById('appScreenDashboard');
  if (sc) sc.classList.add('active');
}

function navigateBackToDashboard() {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  const sc = document.getElementById('appScreenDashboard');
  if (sc) sc.classList.add('active');
}

function openSubjectByName(subjectName, subpart = 'books') {
  const subjects = BHMS_CURRICULUM[currentAppYear] || [];
  const sub = subjects.find(s => s.name === subjectName);
  if (!sub) return;

  currentSelectedSubject = sub;
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  document.getElementById('appScreenNotesList').classList.add('active');

  document.getElementById('subjectNotesTitle').innerText = sub.name;
  document.getElementById('subjectNotesSub').innerText = `${sub.code || 'BHMS'} • ${currentAppYear}`;

  switchSubjectSubpart(subpart);
}

function switchSubjectSubpart(subpart) {
  currentSubjectSubpart = subpart;
  const btnB = document.getElementById('subjBtnBooks');
  const btnN = document.getElementById('subjBtnNotes');
  if (btnB) btnB.classList.toggle('active', subpart === 'books');
  if (btnN) btnN.classList.toggle('active', subpart === 'notes');

  const chipsContainer = document.getElementById('appCatChips');
  if (chipsContainer) {
    chipsContainer.style.display = subpart === 'books' ? 'none' : 'flex';
  }

  renderAppDocsForSubject(currentSelectedSubject, subpart, 'All');
}

function renderAppDocsForSubject(subject, subpart = currentSubjectSubpart, categoryFilter = 'All') {
  const container = document.getElementById('appDocsContainer');
  if (!container || !subject) return;
  container.innerHTML = '';

  const docs = notesData.filter(d => {
    const matchSub = d.subject === subject.name;
    const matchType = d.contentType === subpart;
    const matchCat = categoryFilter === 'All' || d.category === categoryFilter;
    return matchSub && matchType && matchCat;
  });

  if (docs.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 10px;color:var(--text-muted);">
        <div style="font-size:36px;margin-bottom:8px;">${subpart === 'books' ? '📚' : '📝'}</div>
        <div style="font-weight:700;">No ${subpart === 'books' ? 'standard books' : 'notes'} found</div>
        <div style="font-size:11px;margin-top:4px;">Uploaded material by faculty will appear here!</div>
      </div>
    `;
    return;
  }

  docs.forEach(doc => {
    const tile = document.createElement('div');
    tile.className = 'doc-tile';
    tile.innerHTML = `
      <div class="doc-header">
        <div>
          <div class="doc-title">${formatDocTitle(doc.title)}</div>
          <div class="doc-author">By ${doc.author}</div>
        </div>
        <button class="viewer-btn" onclick="toggleDocBookmark('${doc.id}')" title="Bookmark">
          ${doc.bookmarked ? '⭐' : '☆'}
        </button>
      </div>
      <div class="doc-desc">${doc.summary}</div>
      <div class="doc-footer">
        <div>${doc.pages} pgs • ${doc.size} • <span style="color:var(--brand-green);">${doc.category}</span></div>
        <div class="doc-actions">
          <button class="btn-doc-download ${doc.downloaded ? 'downloaded' : ''}" onclick="toggleDocDownload('${doc.id}')">
            ${doc.downloaded ? '✓ Offline' : '📥 Save'}
          </button>
          <button class="btn-doc-open" onclick="openPdfViewer('${doc.id}')">Read</button>
        </div>
      </div>
    `;
    container.appendChild(tile);
  });
}

function filterAppDocsByCategory(cat) {
  document.querySelectorAll('#appCatChips .cat-chip').forEach(c => {
    c.classList.toggle('active', c.innerText.includes(cat) || (cat === 'All' && c.innerText === 'All Material'));
  });
  if (currentSelectedSubject) renderAppDocsForSubject(currentSelectedSubject, currentSubjectSubpart, cat);
}

function trackDocumentRead(docId) {
  if (!docId) return;
  try {
    const doc = notesData.find(n => String(n.id) === String(docId));
    if (doc) {
      doc.reads = (Number(doc.reads || doc.downloads || 0)) + 1;
      doc.downloads = doc.reads;
      if (syncChannel) syncChannel.postMessage({ type: 'READ_COUNT_UPDATED', docId, reads: doc.reads });
    }

    const apiHost = (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) ? API_BASE_URL : 'https://homoeo-pulse.onrender.com';
    fetch(`${apiHost}/api/notes/${docId}/read`, { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        if (res && res.success && doc) {
          doc.reads = res.reads;
          doc.downloads = res.reads;
          if (syncChannel) syncChannel.postMessage({ type: 'READ_COUNT_UPDATED', docId, reads: res.reads });
        }
      })
      .catch(() => {});
  } catch (e) {}
}
window.trackDocumentRead = trackDocumentRead;

// ============================================================
// PDF VIEWER & ENGINE
// ============================================================
async function openPdfViewer(docIdOrObj) {
  let doc = null;
  if (typeof docIdOrObj === 'object') {
    doc = docIdOrObj;
  } else {
    doc = notesData.find(d => String(d.id) === String(docIdOrObj));
  }
  if (!doc) {
    const dMeta = JSON.parse(localStorage.getItem('hp_vault_docs_meta') || '{}');
    const bMeta = JSON.parse(localStorage.getItem('hp_vault_bookmarks_meta') || '{}');
    doc = dMeta[String(docIdOrObj)] || bMeta[String(docIdOrObj)];
  }
  if (!doc) return;

  currentViewingDoc = doc;
  currentViewerPage = 1;

  // Track live real-time read telemetry
  trackDocumentRead(doc.id);

  // Track screen to return to
  const activeScreen = document.querySelector('.app-screen.active');
  if (activeScreen && activeScreen.id !== 'appScreenPdfViewer') {
    pdfViewerOriginScreen = activeScreen.id;
  }

  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  document.getElementById('appScreenPdfViewer').classList.add('active');

  // Push browser history state so mobile back button returns to previous screen
  try {
    window.history.pushState({ screen: 'pdfViewer', docId: doc.id }, '');
  } catch (e) {}

  setupPdfTouchGestures();
  resetPinchZoom();

  document.getElementById('viewerDocTitle').innerText = formatDocTitle(doc.title);
  const wm = document.getElementById('pdfViewerWatermark');
  if (wm && currentUserProfile && currentUserProfile.name) {
    wm.innerText = `HOMOEO PULSE • ${currentUserProfile.name.toUpperCase()} • VERIFIED MEDICAL MATERIAL`;
  } else if (wm) {
    wm.innerText = `HOMOEO PULSE • VERIFIED MEDICAL MATERIAL`;
  }

  updateViewerBookmarkBtn();

  const canvasContainer = document.getElementById('pdfCanvasContainer');
  const spinner = document.getElementById('pdfLoadingSpinner');
  const fallbackViewport = document.getElementById('pdfFallbackViewport');

  if (spinner) spinner.style.display = 'block';

  // 1. Check if saved in IndexedDB Offline Study Vault (must be real PDF > 5KB, not dummy)
  const vaultBuffer = await getPdfFromVault(doc.id);
  if (vaultBuffer && vaultBuffer.byteLength > 5000 && typeof pdfjsLib !== 'undefined') {
    try {
      const loadingTask = pdfjsLib.getDocument({ data: vaultBuffer });
      currentPdfDoc = await loadingTask.promise;
      doc.pages = currentPdfDoc.numPages;
      if (spinner) spinner.style.display = 'none';
      canvasContainer.style.display = 'flex';
      fallbackViewport.style.display = 'none';

      document.getElementById('viewerTotalPageText').innerText = doc.pages;
      document.getElementById('viewerPageSlider').max = doc.pages;
      document.getElementById('viewerPageSlider').value = 1;

      await setupContinuousPdfFeed(currentPdfDoc);
      setupPdfTouchGestures();
      updateResumeCardUI();
      return;
    } catch (err) {
      console.warn('Vault buffer render error, falling back to candidates:', err);
    }
  }

  // 2. Ensure Google Drive external preview iframe is NEVER shown (it blocks large medical textbooks with "file too large to preview")
  const driveFrame = document.getElementById('pdfDriveFrame');
  if (driveFrame) {
    driveFrame.style.display = 'none';
    driveFrame.src = 'about:blank';
  }
  const footerBar = document.querySelector('.pdf-footer-bar');
  if (footerBar) footerBar.style.display = 'flex';

  const driveId = doc.driveFileId || getDriveFileId(doc.fileUrl) || getDriveFileId(doc.title);

  // 3. Load via In-App Native PDF.js Reader with High-Speed Range Streaming
  if (typeof pdfjsLib !== 'undefined') {
    const candidateUrls = [];

    // Priority 1: High-speed cloud streaming proxy (Supports HTTP Range, zero CORS, bypasses Google virus check tokens)
    if (driveId) {
      if (API_BASE_URL) candidateUrls.push(`${API_BASE_URL}/api/pdf-stream?file=${driveId}`);
      candidateUrls.push(`/api/pdf-stream?file=${driveId}`);
    }

    if (doc.fileUrl) {
      if (doc.fileUrl.startsWith('http')) {
        candidateUrls.push(doc.fileUrl);
      } else {
        if (API_BASE_URL) candidateUrls.push(API_BASE_URL + doc.fileUrl);
        candidateUrls.push(doc.fileUrl);
      }
    }

    for (const url of candidateUrls) {
      try {
        if (spinner) {
          spinner.style.display = 'block';
          spinner.innerHTML = 'Connecting to Google Drive Book... 📄';
        }

        const loadingTask = pdfjsLib.getDocument({
          url: url,
          rangeChunkSize: 65536,
          disableAutoFetch: true,
          disableStream: false
        });

        loadingTask.onProgress = function(p) {
          if (spinner && p && p.total > 0) {
            const pct = Math.min(99, Math.round((p.loaded / p.total) * 100));
            const mb = (p.loaded / (1024 * 1024)).toFixed(1);
            spinner.innerHTML = `Fast Streaming Book (${pct}%)... 📄<br><span style="font-size:10px;font-weight:500;opacity:0.85;">${mb} MB</span>`;
          }
        };

        currentPdfDoc = await loadingTask.promise;
        doc.pages = currentPdfDoc.numPages;
        if (spinner) spinner.style.display = 'none';
        canvasContainer.style.display = 'flex';
        fallbackViewport.style.display = 'none';

        document.getElementById('viewerTotalPageText').innerText = doc.pages;
        document.getElementById('viewerPageSlider').max = doc.pages;
        document.getElementById('viewerPageSlider').value = 1;

        await setupContinuousPdfFeed(currentPdfDoc);
        setupPdfTouchGestures();
        updateResumeCardUI();
        return;
      } catch (err) {
        console.warn('Candidate stream failed for', url, err);
      }
    }
  }

  // 3. Try loading offline sample_note.pdf via PDF.js
  if (typeof pdfjsLib !== 'undefined') {
    try {
      const loadingTask = pdfjsLib.getDocument('sample_note.pdf');
      currentPdfDoc = await loadingTask.promise;
      doc.pages = currentPdfDoc.numPages;
      if (spinner) spinner.style.display = 'none';
      canvasContainer.style.display = 'flex';
      fallbackViewport.style.display = 'none';

      document.getElementById('viewerTotalPageText').innerText = doc.pages;
      document.getElementById('viewerPageSlider').max = doc.pages;
      document.getElementById('viewerPageSlider').value = 1;

      await setupContinuousPdfFeed(currentPdfDoc);
      setupPdfTouchGestures();
      updateResumeCardUI();
      return;
    } catch (err) {
      console.warn('Sample PDF load error:', err);
    }
  }

  // 4. Fallback: Interactive Multi-Page Medical Chapter Reader
  currentPdfDoc = null;
  if (spinner) spinner.style.display = 'none';
  canvasContainer.style.display = 'none';
  fallbackViewport.style.display = 'flex';
  renderViewerPageContent();
  updateResumeCardUI();
}

// ============================================================
// CONTINUOUS VERTICAL REELS-STYLE PDF FEED & LAZY RENDERING
// ============================================================
let pdfFeedObserver = null;
const renderedPdfPages = new Set();
const renderingPdfPages = new Set();
let pdfZoomScale = 1.0;

async function setupContinuousPdfFeed(pdfDoc) {
  const feed = document.getElementById('pdfPagesScrollFeed');
  if (!feed || !pdfDoc) return;

  feed.innerHTML = '';
  renderedPdfPages.clear();
  renderingPdfPages.clear();
  pdfZoomScale = 1.0;
  applyPdfTransform();

  const totalPages = pdfDoc.numPages;
  document.getElementById('viewerTotalPageText').innerText = totalPages;
  document.getElementById('viewerPageSlider').max = totalPages;
  document.getElementById('viewerPageSlider').value = 1;
  document.getElementById('viewerCurrentPageText').innerText = '1';

  // Get sample aspect ratio from page 1
  let pageAspectRatio = 1.414;
  try {
    const page1 = await pdfDoc.getPage(1);
    const vp = page1.getViewport({ scale: 1.0 });
    pageAspectRatio = vp.height / vp.width;
  } catch (e) {}

  const containerWidth = feed.clientWidth || 360;
  const targetCardWidth = Math.min(containerWidth - 16, 580);
  const estimatedCardHeight = Math.round(targetCardWidth * pageAspectRatio);

  // Build page placeholder cards for continuous vertical reels-style feed
  const fragment = document.createDocumentFragment();
  for (let i = 1; i <= totalPages; i++) {
    const card = document.createElement('div');
    card.className = 'pdf-page-card';
    card.id = `pdfPageCard_${i}`;
    card.dataset.page = String(i);
    card.style.minHeight = `${estimatedCardHeight}px`;

    // Seamless background rendering: clean paper card with fading-in canvas, no intrusive dark loading box
    card.innerHTML = `
      <canvas id="pdfCanvas_${i}" style="width:100%;height:auto;display:block;opacity:0;transition:opacity 0.25s ease-in;"></canvas>
      <span class="pdf-page-chip">Page ${i} / ${totalPages}</span>
    `;

    fragment.appendChild(card);
  }
  feed.appendChild(fragment);

  // Setup IntersectionObserver for on-demand lazy rendering
  if (pdfFeedObserver) {
    try { pdfFeedObserver.disconnect(); } catch (e) {}
  }

  // Preload generously (800px margin) so pages are already rendered in the background before entering view
  pdfFeedObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const pageNum = parseInt(entry.target.dataset.page, 10);
      if (entry.isIntersecting) {
        renderPageOnDemand(pageNum);

        // Update active page indicator when centered in viewport
        if (entry.intersectionRatio >= 0.45) {
          currentViewerPage = pageNum;
          document.getElementById('viewerCurrentPageText').innerText = pageNum;
          document.getElementById('viewerPageSlider').value = pageNum;
          const subtitle = document.getElementById('viewerDocSubtitle');
          if (subtitle) subtitle.innerText = `Page ${pageNum} of ${totalPages} • Swipe Up/Down`;
        }
      }
    });
  }, {
    root: feed,
    rootMargin: '800px 0px 800px 0px',
    threshold: [0.05, 0.45, 0.8]
  });

  // Observe all page cards
  document.querySelectorAll('.pdf-page-card').forEach(card => {
    pdfFeedObserver.observe(card);
  });

  // Render first 3 pages immediately in background
  renderPageOnDemand(1);
  if (totalPages >= 2) renderPageOnDemand(2);
  if (totalPages >= 3) renderPageOnDemand(3);
}

async function renderPageOnDemand(pageNum) {
  if (!currentPdfDoc || pageNum < 1 || pageNum > currentPdfDoc.numPages) return;
  if (renderedPdfPages.has(pageNum) || renderingPdfPages.has(pageNum)) return;
  renderingPdfPages.add(pageNum);

  try {
    const card = document.getElementById(`pdfPageCard_${pageNum}`);
    const canvas = document.getElementById(`pdfCanvas_${pageNum}`);
    if (!canvas || !card) return;

    const page = await currentPdfDoc.getPage(pageNum);
    const feed = document.getElementById('pdfPagesScrollFeed');
    const containerWidth = (feed ? feed.clientWidth : 360) || 360;
    const targetWidth = Math.min(containerWidth - 16, 580);

    const baseVp = page.getViewport({ scale: 1.0 });
    const renderScale = (targetWidth / baseVp.width) * (window.devicePixelRatio || 1.5);
    const viewport = page.getViewport({ scale: renderScale });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';

    const ctx = canvas.getContext('2d');
    const renderTask = page.render({ canvasContext: ctx, viewport: viewport });
    await renderTask.promise;

    // Smoothly reveal the rendered page canvas
    canvas.style.opacity = '1';
    card.style.minHeight = 'auto';

    // Remove any leftover skeleton element if present
    const skeleton = document.getElementById(`pdfSkeleton_${pageNum}`);
    if (skeleton) skeleton.remove();

    renderedPdfPages.add(pageNum);

    // Proactively pre-render the next page in the background
    if (pageNum + 1 <= currentPdfDoc.numPages && !renderedPdfPages.has(pageNum + 1) && !renderingPdfPages.has(pageNum + 1)) {
      setTimeout(() => renderPageOnDemand(pageNum + 1), 60);
    }
  } catch (err) {
    console.warn(`Render error on page ${pageNum}:`, err);
  } finally {
    renderingPdfPages.delete(pageNum);
  }
}

// ============================================================
// TOUCH PINCH-TO-ZOOM & PAN GESTURES ENGINE
// ============================================================
function handlePdfZoom(delta) {
  pdfZoomScale = Math.min(Math.max(0.75, Math.round((pdfZoomScale + delta) * 100) / 100), 3.0);
  applyPdfTransform();
}

function resetPinchZoom() {
  pdfZoomScale = 1.0;
  applyPdfTransform();
}

function applyPdfTransform() {
  const badge = document.getElementById('viewerZoomBadge');
  if (badge) badge.innerText = Math.round(pdfZoomScale * 100) + '%';

  const feed = document.getElementById('pdfPagesScrollFeed');
  const cards = document.querySelectorAll('.pdf-page-card');
  const pct = Math.round(pdfZoomScale * 100);

  cards.forEach(card => {
    if (pdfZoomScale <= 1.0) {
      card.style.setProperty('width', '100%', 'important');
      card.style.setProperty('min-width', '0', 'important');
      card.style.setProperty('max-width', '580px', 'important');
    } else {
      card.style.setProperty('width', `${pct}%`, 'important');
      card.style.setProperty('min-width', `${pct}%`, 'important');
      card.style.setProperty('max-width', `${Math.round(580 * pdfZoomScale)}px`, 'important');
    }
  });

  const fallbackPage = document.getElementById('pdfDocumentPage');
  if (fallbackPage) {
    if (pdfZoomScale <= 1.0) {
      fallbackPage.style.setProperty('width', '100%', 'important');
      fallbackPage.style.setProperty('min-width', '0', 'important');
    } else {
      fallbackPage.style.setProperty('width', `${pct}%`, 'important');
      fallbackPage.style.setProperty('min-width', `${pct}%`, 'important');
    }
  }

  if (feed) {
    if (pdfZoomScale > 1.0) {
      feed.style.setProperty('touch-action', 'pan-x pan-y', 'important');
      feed.style.setProperty('overflow-x', 'auto', 'important');
    } else {
      feed.style.setProperty('touch-action', 'pan-y', 'important');
      feed.style.setProperty('overflow-x', 'hidden', 'important');
    }
  }
}

function setupPdfTouchGestures() {
  const feed = document.getElementById('pdfPagesScrollFeed');
  if (!feed || feed._hasPinchAttached) return;
  feed._hasPinchAttached = true;

  let initialDist = 0;
  let startScale = 1.0;
  let lastTapTime = 0;

  feed.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      initialDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      startScale = pdfZoomScale;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 300) {
        if (pdfZoomScale > 1.1) {
          resetPinchZoom();
        } else {
          pdfZoomScale = 1.6;
          applyPdfTransform();
        }
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    }
  }, { passive: true });

  feed.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && initialDist > 0) {
      if (e.cancelable) e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = currentDist / initialDist;
      pdfZoomScale = Math.min(Math.max(0.75, Math.round(startScale * factor * 20) / 20), 3.0);
      applyPdfTransform();
    }
  }, { passive: false });

  feed.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      initialDist = 0;
    }
  }, { passive: true });
}

function togglePdfDarkMode() {
  const feed = document.getElementById('pdfPagesScrollFeed');
  if (feed) feed.classList.toggle('inverted');
  const cards = document.querySelectorAll('.pdf-page-card');
  cards.forEach(c => c.classList.toggle('inverted'));
}

function closePdfViewer() {
  if (pdfFeedObserver) {
    try { pdfFeedObserver.disconnect(); } catch (e) {}
  }
  const feed = document.getElementById('pdfPagesScrollFeed');
  if (feed) feed.innerHTML = '';
  renderedPdfPages.clear();
  renderingPdfPages.clear();

  const driveFrame = document.getElementById('pdfDriveFrame');
  if (driveFrame) {
    driveFrame.style.display = 'none';
    driveFrame.src = 'about:blank';
  }

  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  const sc = document.getElementById(pdfViewerOriginScreen) || document.getElementById('appScreenDashboard');
  if (sc) sc.classList.add('active');
  resetPinchZoom();
}

function handleViewerSlider(val) {
  const pageNum = parseInt(val, 10);
  if (!pageNum) return;
  currentViewerPage = pageNum;
  document.getElementById('viewerCurrentPageText').innerText = pageNum;

  const targetCard = document.getElementById(`pdfPageCard_${pageNum}`);
  if (targetCard) {
    targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderPageOnDemand(pageNum);
  }
}

function scrollToTopPdf() {
  const feed = document.getElementById('pdfPagesScrollFeed');
  if (feed) {
    feed.scrollTo({ top: 0, behavior: 'smooth' });
  }
  handleViewerSlider(1);
}

function updateViewerBookmarkBtn() {
  const btn = document.getElementById('btnViewerBookmark');
  if (btn && currentViewingDoc) {
    btn.innerText = currentViewingDoc.bookmarked ? '⭐' : '☆';
  }
}

function toggleCurrentDocBookmark() {
  if (currentViewingDoc) {
    toggleDocBookmark(currentViewingDoc.id);
    updateViewerBookmarkBtn();
  }
}

function renderViewerPageContent() {
  const maxPages = (currentViewingDoc && currentViewingDoc.pages) ? Math.max(currentViewingDoc.pages, 12) : 12;
  document.getElementById('viewerCurrentPageText').innerText = currentViewerPage;
  document.getElementById('viewerPageSlider').max = maxPages;
  document.getElementById('viewerPageSlider').value = currentViewerPage;
  document.getElementById('pdfPageNumberSpan').innerText = `Page ${currentViewerPage} of ${maxPages}`;

  const body = document.getElementById('pdfContentBody');
  if (!body || !currentViewingDoc) return;

  const docTitle = formatDocTitle(currentViewingDoc.title);
  const subject = currentViewingDoc.subject || 'Homoeopathy';
  const author = currentViewingDoc.author || 'Dr. Mrunali Chavada & Faculty Panel';

  // Rich clinical curriculum pages with actual syllabus content
  const chapterTopics = [
    {
      title: "1. Comprehensive Clinical Foundations & BHMS Syllabus",
      badge: "Syllabus Unit 1",
      content: `This canonical edition covers the core theoretical and clinical concepts of <strong>${subject}</strong> prescribed for BHMS Medical Education. In clinical practice, understanding underlying disease pathology, holistic constitutional assessment, and fundamental homeopathic principles is paramount.`
    },
    {
      title: "2. Hahnemannian Principles & Organon Foundations",
      badge: "Clinical Doctrine",
      content: `The cornerstone of homeopathy rests upon <em>Similia Similibus Curentur</em> (Let likes be cured by likes). In §9 of the Organon of Medicine, Dr. Samuel Hahnemann highlights the role of the Vital Force: <em>"In the healthy condition of man, the spiritual vital force, the dynamis that animates the material body, rules with unbounded sway..."</em> Every clinical symptom represents the dynamic struggle of the vital force.`
    },
    {
      title: "3. Constitutional Analysis & Totality of Symptoms",
      badge: "Core Methodology",
      content: `Prescription requires determining the complete totality of symptoms: Mental Generals, Physical Generals, and Characteristic Particulars. The clinician must elicit: Location, Sensation, Modalities (aggravation/amelioration), and Concomitants. Uncovering individual susceptibility ensures an exact homeopathic similimum.`
    },
    {
      title: "4. Posology, Miasmatic Diagnosis & Potency Selection",
      badge: "Advanced Practice",
      content: `Miasmatic chronic classification includes Psora, Sycosis, and Syphilis. Dr. Hahnemann emphasized beginning with appropriate dynamic potencies (30C, 200C, 1M, or LM potencies). High potencies are indicated in acute hyper-reactive vital force states and functional disorders; medium potencies in structured tissue pathology.`
    },
    {
      title: "5. Materia Medica Correlates & Differential Diagnostics",
      badge: "Keynote Comparison",
      content: `Comparative analysis of key polychrest remedies: <em>Sulphur</em> (psoric king, burning sensations, worse from heat and bathing), <em>Lycopodium</em> (right-to-left progression, 4-8 PM aggravation, intellectual keenness), <em>Calcarea Carbonica</em> (fair, fat, flabby, cold damp feet, craving for eggs). Differential verification ensures precise prescribing.`
    },
    {
      title: "6. Solved University Board Questions & High-Yield Cases",
      badge: "Exam High-Yield",
      content: `Frequently asked examination questions: (1) Define susceptibility and discuss factors modifying it. (2) Explain the Second Prescription rules according to Dr. J.T. Kent. (3) Differentiate between suppression and cure according to Hering's Law of Cure: from above downwards, from within outwards, from more important to less important organs.`
    }
  ];

  const pageIdx = (currentViewerPage - 1) % chapterTopics.length;
  const currentChapter = chapterTopics[pageIdx];

  body.innerHTML = `
    <div style="margin-bottom:14px;padding-bottom:10px;border-bottom:1.5px solid var(--border);">
      <span style="display:inline-block;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:800;background:var(--brand-green-pale);color:var(--brand-green);margin-bottom:6px;">
        ${currentChapter.badge} • ${subject.toUpperCase()}
      </span>
      <h3 style="font-size:16px;font-weight:800;color:var(--text);margin:0 0 4px 0;">${docTitle}</h3>
      <div style="font-size:11px;color:var(--text-muted);">Authored / Curated by: <strong>${author}</strong> • Standard BHMS Curriculum</div>
    </div>

    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:14px;">
      <h4 style="font-size:13px;font-weight:800;color:#0F172A;margin:0 0 8px 0;">${currentChapter.title}</h4>
      <p style="font-size:12px;color:#334155;line-height:1.65;margin:0;">
        ${currentChapter.content}
      </p>
    </div>

    <div style="background:#F0FDF4;padding:12px;border-left:3px solid #10B981;font-size:11px;color:#065F46;border-radius:6px;margin-top:12px;">
      <strong>OFFLINE STUDY VAULT ACTIVE:</strong> This textbook is indexed in your offline mobile sandbox. Swipe or tap Next/Prev to study through syllabus sections.
    </div>
  `;
}

// ============================================================
// OFFLINE VAULT & BOOKMARKS
// ============================================================
function toggleDocBookmark(docId) {
  const doc = notesData.find(d => String(d.id) === String(docId)) ||
    JSON.parse(localStorage.getItem('hp_vault_docs_meta') || '{}')[String(docId)] ||
    JSON.parse(localStorage.getItem('hp_vault_bookmarks_meta') || '{}')[String(docId)];
  if (doc) {
    doc.bookmarked = !doc.bookmarked;
    setDocBookmarkedInStorage(doc.id, doc.bookmarked, doc);
    updateVaultCounts();
    if (document.getElementById('appScreenVault')?.classList.contains('active')) renderVaultScreen();
    triggerPhonePushNotification(
      doc.bookmarked ? '⭐ Bookmark Saved' : 'Bookmark Removed',
      doc.bookmarked ? `"${formatDocTitle(doc.title)}" saved to your bookmarks.` : `"${formatDocTitle(doc.title)}" removed from bookmarks.`
    );
  }
}

async function toggleDocDownload(docId) {
  const doc = notesData.find(d => String(d.id) === String(docId)) ||
    JSON.parse(localStorage.getItem('hp_vault_docs_meta') || '{}')[String(docId)];
  if (!doc) return;

  const btn = window.event && window.event.target ? window.event.target.closest('.btn-doc-download') : null;

  if (doc.downloaded) {
    // Remove from vault
    doc.downloaded = false;
    setDocDownloadedInStorage(doc.id, false);
    await removePdfFromVault(doc.id);
    updateVaultCounts();
    if (btn) {
      btn.classList.remove('downloaded');
      btn.innerHTML = '📥 Save';
    }
    triggerPhonePushNotification('Removed from Offline Storage', `"${formatDocTitle(doc.title)}" removed from offline storage.`);
    if (document.getElementById('appScreenVault')?.classList.contains('active')) renderVaultScreen();
    return;
  }

  // Download & Save to IndexedDB
  if (btn) {
    btn.innerHTML = '⏳ Saving...';
    btn.disabled = true;
  }
  triggerPhonePushNotification('Study Vault Download', `Downloading "${formatDocTitle(doc.title)}" for offline access...`);

  let fetchedBuffer = null;

  // Build candidate URLs with proxy prioritized for CORS & Range
  const candidateUrls = [];
  const driveId = doc.driveFileId || getDriveFileId(doc.fileUrl) || getDriveFileId(doc.title);

  if (driveId) {
    if (API_BASE_URL) candidateUrls.push(`${API_BASE_URL}/api/pdf-stream?file=${driveId}`);
    candidateUrls.push(`/api/pdf-stream?file=${driveId}`);
  }

  if (doc.fileUrl) {
    const directUrl = formatDriveUrl(doc.fileUrl);
    if (directUrl.startsWith('http')) {
      candidateUrls.push(directUrl);
    } else {
      if (API_BASE_URL) candidateUrls.push(API_BASE_URL + directUrl);
      candidateUrls.push(directUrl);
    }
  }

  for (const u of candidateUrls) {
    try {
      const res = await fetch(u);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf && buf.byteLength > 5000) {
          fetchedBuffer = buf;
          break;
        }
      }
    } catch (err) {
      console.warn('Candidate download attempt failed:', u, err);
    }
  }

  if (fetchedBuffer && fetchedBuffer.byteLength > 5000) {
    await savePdfToVault(doc.id, fetchedBuffer);
    doc.downloaded = true;
    setDocDownloadedInStorage(doc.id, true, doc);
    updateVaultCounts();

    if (btn) {
      btn.classList.add('downloaded');
      btn.innerHTML = '✓ Offline';
      btn.disabled = false;
    }

    triggerPhonePushNotification('✓ Offline Vault Ready', `"${formatDocTitle(doc.title)}" saved! You can now read it offline in Study Vault.`);
    if (document.getElementById('appScreenVault')?.classList.contains('active')) renderVaultScreen();
  } else {
    // If download failed, inform user cleanly (do NOT save dummy sample_note.pdf!)
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '📥 Save';
    }
    triggerPhonePushNotification('Download Failed', `Could not download "${formatDocTitle(doc.title)}". Please check internet connection.`);
  }
}

function toggleTopicOffline(topicId, event) {
  if (event) event.stopPropagation();
  const btn = document.getElementById(`btnSaveTopic_${topicId}`);
  if (btn) {
    const isSaved = btn.classList.contains('saved');
    btn.classList.toggle('saved', !isSaved);
    btn.innerHTML = !isSaved ? '<span>✓ Offline</span>' : '<span>📥 Save</span>';
    if (!isSaved) {
      triggerPhonePushNotification('Topic Saved Offline', 'Topic notes cached for offline revision.');
    }
  }
}

function updateVaultCounts() {
  syncVaultStatus();
  const downloadedIds = getDownloadedDocIds();
  const bookmarkedIds = getBookmarkedDocIds();
  const bEl = document.getElementById('countVaultBookmarks');
  const oEl = document.getElementById('countVaultOffline');
  if (bEl) bEl.innerText = bookmarkedIds.length;
  if (oEl) oEl.innerText = downloadedIds.length;
}

let currentVaultTab = 'bookmarks';
function switchVaultTab(tab) {
  currentVaultTab = tab;
  document.getElementById('btnVaultBookmarks')?.classList.toggle('active', tab === 'bookmarks');
  document.getElementById('btnVaultOffline')?.classList.toggle('active', tab === 'offline');
  renderVaultScreen();
}

function renderVaultScreen() {
  syncVaultStatus();
  const container = document.getElementById('appVaultContainer');
  if (!container) return;
  container.innerHTML = '';

  const metaMap = JSON.parse(
    localStorage.getItem(currentVaultTab === 'bookmarks' ? 'hp_vault_bookmarks_meta' : 'hp_vault_docs_meta') || '{}'
  );

  const docMap = new Map();
  notesData.forEach(d => {
    if (currentVaultTab === 'bookmarks' ? d.bookmarked : d.downloaded) {
      docMap.set(String(d.id), d);
    }
  });

  Object.keys(metaMap).forEach(id => {
    if (!docMap.has(String(id))) {
      docMap.set(String(id), metaMap[id]);
    }
  });

  const list = Array.from(docMap.values());
  updateVaultCounts();

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 16px;color:var(--text-muted);">
        <div style="font-size:36px;margin-bottom:8px;">${currentVaultTab === 'bookmarks' ? '⭐' : '📥'}</div>
        <div style="font-weight:700;">No ${currentVaultTab === 'bookmarks' ? 'Bookmarks' : 'Offline Downloads'} saved yet</div>
        <div style="font-size:11px;margin-top:4px;">Tap the bookmark or save button on any note or book to add it here.</div>
      </div>
    `;
    return;
  }

  list.forEach(doc => {
    const item = document.createElement('div');
    item.className = 'vault-doc-item';
    item.onclick = () => openPdfViewer(doc.id);
    item.innerHTML = `
      <div style="font-size:24px;">📄</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${formatDocTitle(doc.title)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${doc.subject || 'Academic Document'} • ${doc.pages || 14} pgs</div>
      </div>
      <button class="btn-doc-open" style="padding:4px 10px;font-size:10px;">Read</button>
    `;
    container.appendChild(item);
  });
}

// ============================================================
// STUDENT PROFILE & EDIT PROFILE
// ============================================================
function renderUserProfileUI() {
  const isConfigured = Boolean(
    currentUserProfile &&
    currentUserProfile.isSetupDone &&
    currentUserProfile.name &&
    currentUserProfile.name.trim().length > 0 &&
    currentUserProfile.name !== 'BHMS Scholar'
  );

  const gName = document.getElementById('appGreetingName');
  const topAv = document.getElementById('appTopAvatar');
  const pName = document.getElementById('profileStudentName');
  const pEmail = document.getElementById('profileStudentEmail');
  const pCol = document.getElementById('profileCollegeName');
  const pYear = document.getElementById('profileActiveYear');
  const pRole = document.getElementById('profileBadgeRole');
  const pAvBig = document.getElementById('profileAvatarBig');
  const dashNotice = document.getElementById('dashPendingProfileNotice');
  const profAlert = document.getElementById('profilePendingAlert');

  if (isConfigured) {
    const p = currentUserProfile;
    const initials = p.name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'HP';
    if (gName) gName.innerText = `Welcome, ${p.name}`;
    if (topAv) {
      topAv.innerText = initials;
      topAv.style.background = 'var(--brand-gradient)';
    }
    if (pName) pName.innerText = p.name;
    if (pEmail) pEmail.innerText = p.email || 'Not Provided';
    if (pCol) pCol.innerText = p.college || 'Homoeopathic Medical College';
    if (pYear) pYear.innerText = `${p.year || '1st Year'} (Tap to switch) ›`;
    if (pRole) {
      pRole.innerText = `BHMS ${(p.year || '1st Year').toUpperCase()} • ENROLLED SCHOLAR`;
      pRole.style.background = 'var(--brand-green-pale)';
      pRole.style.color = 'var(--brand-green)';
      pRole.style.border = '1px solid #A7F3D0';
    }
    if (pAvBig) pAvBig.innerText = initials;
    if (dashNotice) dashNotice.style.display = 'none';
    if (profAlert) profAlert.style.display = 'none';
  } else {
    // FRESH DOWNLOAD / PENDING PROFILE STATE
    if (gName) gName.innerText = 'Welcome, Medical Scholar';
    if (topAv) {
      topAv.innerText = '⚠️';
      topAv.style.background = '#F59E0B';
    }
    if (pName) pName.innerText = 'Profile Pending (Tap Edit)';
    if (pEmail) pEmail.innerText = 'Not Provided (Setup Pending)';
    if (pCol) pCol.innerText = 'College Affiliation Not Configured';
    if (pYear) pYear.innerText = 'Pending Setup (Tap to select) ›';
    if (pRole) {
      pRole.innerText = '⚠️ PROFILE SETUP PENDING • TAP TO EDIT';
      pRole.style.background = '#FEF3C7';
      pRole.style.color = '#B45309';
      pRole.style.border = '1px solid #FCD34D';
    }
    if (pAvBig) pAvBig.innerText = '👤';
    if (dashNotice) dashNotice.style.display = 'flex';
    if (profAlert) profAlert.style.display = 'flex';
  }
}

function openEditProfileModal() {
  document.getElementById('profName').value = currentUserProfile.name || '';
  document.getElementById('profCollege').value = currentUserProfile.college || '';
  document.getElementById('profYear').value = currentUserProfile.year || '1st Year';
  document.getElementById('profEmail').value = currentUserProfile.email || '';
  document.getElementById('profileModal').classList.add('active');
}

function closeEditProfileModal() {
  document.getElementById('profileModal').classList.remove('active');
}

async function handleProfileSubmit(e) {
  e.preventDefault();
  const nameVal = (document.getElementById('profName')?.value || '').trim();
  const collegeVal = (document.getElementById('profCollege')?.value || '').trim();
  const yearVal = document.getElementById('profYear')?.value || '1st Year';
  const emailVal = (document.getElementById('profEmail')?.value || '').trim();

  if (!nameVal) {
    alert('Please enter your Name to complete your scholar profile.');
    return;
  }

  currentUserProfile.name = nameVal;
  currentUserProfile.college = collegeVal || 'Homoeopathic Medical College';
  currentUserProfile.year = yearVal;
  currentUserProfile.email = emailVal;
  currentUserProfile.isSetupDone = true;

  saveLocalProfile();
  renderUserProfileUI();
  closeEditProfileModal();

  try {
    await fetch((API_BASE_URL || '') + '/api/user-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentUserProfile)
    });
  } catch (e) {}

  triggerPhonePushNotification('Profile Registered', `Welcome, ${currentUserProfile.name}! Your credentials have been saved.`);
}

// ============================================================
// NATIVE ANDROID HARDWARE/GESTURE BACK BUTTON CONTROLLER
// Hierarchical Screen Pop & Double-Tap to Exit System
// ============================================================
let lastHardwareBackTap = 0;
let exitToastTimer = null;
let lastBackHandledTimestamp = 0;

function showExitToast() {
  let toast = document.getElementById('appExitToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appExitToast';
    toast.style.cssText = `
      position: fixed;
      bottom: 84px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: #0F172A;
      color: #FFFFFF;
      padding: 10px 22px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 10px 25px -4px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.15);
      z-index: 99999;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    toast.innerHTML = `<span style="font-size: 15px;">🚪</span> <span>Press back again to exit</span>`;
    document.body.appendChild(toast);
  }

  clearTimeout(exitToastTimer);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  exitToastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, 2000);
}

function handleAppHardwareBack() {
  // Prevent duplicate execution within 250ms (debounces hardware back + popstate)
  const now = Date.now();
  if (now - lastBackHandledTimestamp < 250) {
    return true;
  }
  lastBackHandledTimestamp = now;

  // 1. Check open Modals
  const profModal = document.getElementById('profileModal');
  if (profModal && profModal.classList.contains('active')) {
    closeEditProfileModal();
    return true;
  }
  const notifToast = document.getElementById('phoneNotifToast');
  if (notifToast && notifToast.classList.contains('active')) {
    notifToast.classList.remove('active');
    return true;
  }

  // 2. Active PDF Viewer -> Return to origin screen
  const pdfScreen = document.getElementById('appScreenPdfViewer');
  if (pdfScreen && pdfScreen.classList.contains('active')) {
    closePdfViewer();
    return true;
  }

  // 3. Active Topics screen -> Return to Chapters screen
  const topicsScreen = document.getElementById('appScreenTopics');
  if (topicsScreen && topicsScreen.classList.contains('active')) {
    navigateBackFromTopics();
    return true;
  }

  // 4. Active Subject Notes list screen -> Return to Dashboard
  const notesScreen = document.getElementById('appScreenNotesList');
  if (notesScreen && notesScreen.classList.contains('active')) {
    navigateBackToDashboard();
    return true;
  }

  // 5. Active Chapters screen -> Return to Dashboard
  const chapScreen = document.getElementById('appScreenChapters');
  if (chapScreen && chapScreen.classList.contains('active')) {
    navigateBackFromChapters();
    return true;
  }

  // 6. Active other tabs (Admin, Vault, Profile) -> Return to Dashboard
  const dashScreen = document.getElementById('appScreenDashboard');
  if (dashScreen && !dashScreen.classList.contains('active')) {
    switchAppTab('dashboard');
    return true;
  }

  // 7. If Search query active on Dashboard -> clear search
  const searchInput = document.getElementById('appSearchInput');
  if (searchInput && searchInput.value && searchInput.value.trim().length > 0) {
    searchInput.value = '';
    handleAppSearch();
    return true;
  }

  // 8. User is at root Dashboard: Double Tap Back to Exit
  if (now - lastHardwareBackTap < 2000) {
    // Second tap within 2 seconds -> Exit app cleanly!
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && window.Capacitor.Plugins.App.exitApp) {
      window.Capacitor.Plugins.App.exitApp();
    } else {
      try {
        if (navigator.app && navigator.app.exitApp) navigator.app.exitApp();
      } catch (e) {}
    }
    return true;
  } else {
    // First tap -> Show toast warning
    lastHardwareBackTap = now;
    showExitToast();
    return true;
  }
}

// Attach native Capacitor Android Back Button Listener
function registerBackButtonListener() {
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    try {
      window.Capacitor.Plugins.App.removeAllListeners();
    } catch (e) {}
    try {
      window.Capacitor.Plugins.App.addListener('backButton', () => {
        handleAppHardwareBack();
      });
    } catch (e) {
      console.warn('Capacitor backButton registration error:', e);
    }
  }
}

registerBackButtonListener();
window.addEventListener('DOMContentLoaded', registerBackButtonListener);
window.addEventListener('load', registerBackButtonListener);

// Web History Popstate Listener (debounced)
window.addEventListener('popstate', (e) => {
  handleAppHardwareBack();
});

// ============================================================
// SEARCH & TAB NAVIGATION
// ============================================================
function handleAppSearch() {
  const inputEl = document.getElementById('appSearchInput');
  const clearBtn = document.getElementById('appSearchClearBtn');
  const query = (inputEl ? inputEl.value : '').toLowerCase().trim();

  if (clearBtn) {
    clearBtn.style.display = query ? 'block' : 'none';
  }

  const container = document.getElementById('appSubjectsContainer');
  if (!container) return;

  const yearPills = document.getElementById('appYearPills');
  const yearHeader = document.querySelector('.year-selector-header');
  const toggleBar = document.querySelector('.subpart-toggle-bar');

  if (!query) {
    if (yearPills) yearPills.style.display = '';
    if (yearHeader) yearHeader.style.display = '';
    if (toggleBar) toggleBar.style.display = '';
    renderAppContentForYear(currentAppYear, currentAppSubpart);
    return;
  }

  // Hide year pills and toggle bar while actively searching so all matching PDFs across years are shown
  if (yearPills) yearPills.style.display = 'none';
  if (yearHeader) yearHeader.style.display = 'none';
  if (toggleBar) toggleBar.style.display = 'none';

  container.innerHTML = '';

  // Multi-term token matching (all keywords must match in any of title, subject, author, category, year, summary)
  const tokens = query.split(/\s+/).filter(Boolean);

  const matchedDocs = notesData.filter(d => {
    const title = (d.title || '').toLowerCase();
    const cleanTitle = (formatDocTitle(d.title) || '').toLowerCase();
    const subject = (d.subject || '').toLowerCase();
    const author = (d.author || '').toLowerCase();
    const category = (d.category || '').toLowerCase();
    const year = (d.year || '').toLowerCase();
    const summary = (d.summary || '').toLowerCase();
    const contentType = (d.contentType === 'book' ? 'book standard textbook' : 'note academic notes study material');

    const searchCorpus = `${title} ${cleanTitle} ${subject} ${author} ${category} ${year} ${summary} ${contentType}`;
    return tokens.every(token => searchCorpus.includes(token));
  });

  // Results Header Banner
  const resultsHeader = document.createElement('div');
  resultsHeader.className = 'search-results-header';
  resultsHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 4px 10px;border-bottom:1px solid var(--border);margin-bottom:12px;';
  resultsHeader.innerHTML = `
    <div>
      <span style="font-size:12px;font-weight:800;color:var(--text);">Found ${matchedDocs.length} PDF${matchedDocs.length === 1 ? '' : 's'}</span>
      <span style="font-size:11px;color:var(--text-muted);margin-left:4px;">for "${query}"</span>
    </div>
    <button type="button" onclick="clearAppSearch()" style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:6px;padding:3px 8px;font-size:10.5px;font-weight:700;color:#64748B;cursor:pointer;">Clear ✕</button>
  `;
  container.appendChild(resultsHeader);

  if (matchedDocs.length === 0) {
    const emptyBox = document.createElement('div');
    emptyBox.style.cssText = 'text-align:center;padding:36px 16px;background:#FFF;border:1px dashed var(--border);border-radius:12px;color:var(--text-muted);margin-top:6px;';
    emptyBox.innerHTML = `
      <div style="font-size:32px;margin-bottom:8px;">🔍</div>
      <div style="font-weight:700;font-size:13px;color:var(--text);">No PDFs matching "${query}"</div>
      <div style="font-size:11px;margin-top:4px;">Try searching by subject name (e.g. Anatomy, Organon), book title, author, or BHMS year.</div>
    `;
    container.appendChild(emptyBox);
    return;
  }

  // Render nicely arranged matching PDF cards
  matchedDocs.forEach(doc => {
    const card = document.createElement('div');
    card.className = 'book-card-item';
    card.style.cssText = 'cursor:pointer;margin-bottom:10px;';
    card.onclick = () => openPdfViewer(doc.id);

    const isBook = doc.contentType === 'book';
    const cleanTitle = formatDocTitle(doc.title);

    card.innerHTML = `
      <div class="book-spine-cover" style="background:${isBook ? 'linear-gradient(135deg, #008744 0%, #10B981 100%)' : 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)'};border-left-color:${isBook ? '#006D37' : '#B45309'};">
        <span>${isBook ? '📖' : '📝'}</span>
      </div>
      <div class="book-card-details" style="flex:1;min-width:0;">
        <div class="book-card-title" style="font-size:12.5px;font-weight:700;line-height:1.3;">${cleanTitle}</div>
        <div class="book-card-author" style="font-size:11px;color:var(--text-muted);margin-top:2px;">By ${doc.author || 'Faculty Admin'}</div>
        <div class="book-card-meta" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:6px;">
          <span class="badge-tag year" style="font-size:9px;padding:1px 6px;background:#E0F2FE;color:#0369A1;">${doc.year}</span>
          <span class="badge-tag" style="font-size:9px;padding:1px 6px;background:#F1F5F9;color:#334155;">${doc.subject}</span>
          <span class="badge-tag" style="font-size:9px;padding:1px 6px;background:${isBook ? '#DCFCE7' : '#FEF3C7'};color:${isBook ? '#15803D' : '#B45309'};">${isBook ? 'Standard Book' : 'Study Note'}</span>
          ${doc.pages ? `<span style="font-size:10px;color:var(--text-muted);">${doc.pages} pgs</span>` : ''}
          ${doc.size ? `<span style="font-size:10px;color:var(--text-muted);">• ${doc.size}</span>` : ''}
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="btn-doc-open" style="padding:4px 12px;font-size:10.5px;" onclick="event.stopPropagation(); openPdfViewer('${doc.id}')">Read PDF</button>
          <button class="btn-doc-download ${doc.downloaded ? 'downloaded' : ''}" style="padding:4px 8px;font-size:10.5px;" onclick="event.stopPropagation(); toggleDocDownload('${doc.id}')">
            ${doc.downloaded ? '✓ Offline' : '📥 Save'}
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function clearAppSearch() {
  const inputEl = document.getElementById('appSearchInput');
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
  }
  handleAppSearch();
}

function switchAppTab(tabName) {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.app-bottom-nav .app-nav-item').forEach(i => i.classList.remove('active'));

  if (tabName === 'dashboard') {
    document.getElementById('appScreenDashboard').classList.add('active');
    const dNav = document.getElementById('navAppDashboard');
    if (dNav) dNav.classList.add('active');
  } else if (tabName === 'admin') {
    document.getElementById('appScreenAdminDetails').classList.add('active');
    const aNav = document.getElementById('navAppAdmin');
    if (aNav) aNav.classList.add('active');
  } else if (tabName === 'vault') {
    document.getElementById('appScreenVault').classList.add('active');
    const vNav = document.getElementById('navAppVault');
    if (vNav) vNav.classList.add('active');
    renderVaultScreen();
  } else if (tabName === 'profile') {
    document.getElementById('appScreenProfile').classList.add('active');
    const pNav = document.getElementById('navAppProfile');
    if (pNav) pNav.classList.add('active');
    renderUserProfileUI();
  }
}

// ============================================================
// ANTI-PIRACY & MEDICAL CONTENT PROTECTION ENGINE
// ============================================================
window.addEventListener('keydown', function(e) {
  // Block F12 (Inspect Element)
  if (e.key === 'F12' || e.keyCode === 123) {
    e.preventDefault();
    return false;
  }
  // Block Ctrl+U (View Source), Ctrl+S (Save Page), Ctrl+P (Print Textbook)
  if (e.ctrlKey && (e.key === 'u' || e.key === 's' || e.key === 'p' || e.keyCode === 85 || e.keyCode === 83 || e.keyCode === 80)) {
    e.preventDefault();
    return false;
  }
  // Block Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (DevTools)
  if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C' || e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67)) {
    e.preventDefault();
    return false;
  }
}, false);

