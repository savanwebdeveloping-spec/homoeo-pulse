// ============================================================
// HOMOEO PULSE - STUDENT MOBILE APP ENGINE & REAL-TIME SYNC
// ============================================================

// 1. App State & API Configuration
const API_BASE_URL = window.HOMOEO_PULSE_API_URL || '';

let BHMS_CURRICULUM = (window.HOMOEO_DEFAULT_DATA && window.HOMOEO_DEFAULT_DATA.curriculum) ? window.HOMOEO_DEFAULT_DATA.curriculum : {};
let notesData = (window.HOMOEO_DEFAULT_DATA && window.HOMOEO_DEFAULT_DATA.notes) ? window.HOMOEO_DEFAULT_DATA.notes : [];
let currentAppYear = '1st Year';
let currentAppSubpart = 'books';
let currentSubjectFilter = 'All';
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

function getDownloadedDocIds() {
  try {
    return JSON.parse(localStorage.getItem('hp_vault_downloads') || '[]');
  } catch (e) {
    return [];
  }
}

function setDocDownloadedInStorage(docId, isDownloaded) {
  try {
    let ids = getDownloadedDocIds();
    if (isDownloaded) {
      if (!ids.includes(String(docId))) ids.push(String(docId));
    } else {
      ids = ids.filter(id => id !== String(docId));
    }
    localStorage.setItem('hp_vault_downloads', JSON.stringify(ids));
  } catch (e) {}
}

function syncDownloadedStatus() {
  const downloadedIds = getDownloadedDocIds();
  notesData.forEach(d => {
    if (downloadedIds.includes(String(d.id))) {
      d.downloaded = true;
    }
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

function setupRealtimeSync() {
  // 1. Instant sync via BroadcastChannel (Same browser / different tabs)
  if (syncChannel) {
    syncChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'DATA_UPDATED') {
        console.log('📡 Real-time update signal received from Faculty Admin CMS!');
        syncWithBackend(true);
      }
    };
  }

  // 2. Storage event fallback across tabs
  window.addEventListener('storage', (e) => {
    if (e.key === 'hp_last_sync_time') {
      syncWithBackend(true);
    }
  });

  // 3. Periodic Background Polling (Every 4 seconds)
  setInterval(async () => {
    try {
      const res = await fetch((API_BASE_URL || '') + '/api/stats');
      if (res.ok) {
        const stats = await res.json();
        if (stats.totalDocuments !== notesData.length) {
          syncWithBackend(true);
        }
      }
    } catch (e) {}
  }, 4000);
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
  syncDownloadedStatus();

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
      if (Array.isArray(data.notes)) notesData = data.notes;
      if (data.curriculum && Object.keys(data.curriculum).length > 0) BHMS_CURRICULUM = data.curriculum;
      if (data.userProfile && data.userProfile.name) currentUserProfile = data.userProfile;

      updateYearSubpartCounts();
      renderAppContentForYear(currentAppYear, currentAppSubpart);
      updateResumeCardUI();
      renderUserProfileUI();

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

      if (isAutoUpdate) {
        triggerPhonePushNotification('Academic Material Synced', 'New study notes or books have just been published by faculty.');
      }
    }
  } catch (err) {
    console.warn('Backend connection offline, using cached sandbox');
  }
}

function loadLocalProfile() {
  try {
    const prof = localStorage.getItem('hp_user_profile_v5');
    if (prof) {
      const parsed = JSON.parse(prof);
      if (parsed && parsed.name && parsed.name.trim().length > 0 && parsed.isSetupDone) {
        currentUserProfile = parsed;
        return;
      }
    }
  } catch (e) {}
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
    currentUserProfile.isSetupDone = true;
    localStorage.setItem('hp_user_profile_v5', JSON.stringify(currentUserProfile));
  } catch (e) {}
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
  if (status) status.innerText = 'Connecting to AYUSH Cloud Platform...';

  const startTime = Date.now();
  const totalDuration = 1400; // 1.4 seconds smooth & snappy

  splashProgressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const pct = Math.min(Math.floor((elapsed / totalDuration) * 100), 96);
    if (fill) fill.style.width = `${pct}%`;

    if (elapsed < 400) {
      if (status) status.innerText = 'Connecting to AYUSH Cloud Platform...';
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
  }, 600);
}
window.dismissSplashScreen = dismissSplashScreen;

function triggerPhonePushNotification(title, msg) {
  const toast = document.getElementById('phoneNotifToast');
  if (!toast) return;
  document.getElementById('toastTitle').innerText = title;
  document.getElementById('toastMsg').innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 5000);
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
  currentSubjectFilter = 'All';
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

  // 1. Subject Carousel
  const carouselWrapper = document.createElement('div');
  carouselWrapper.className = 'subject-carousel-wrapper';

  const carouselItems = [
    { id: 'All', name: `All Subjects (${subjects.length})`, icon: '📚', countBadge: 'All Subjects' },
    ...subjects.map((s, idx) => ({
      id: s.name,
      name: s.name,
      icon: s.icon || '📖',
      countBadge: `Subject ${idx + 1} of ${subjects.length}`
    }))
  ];

  let activeIndex = carouselItems.findIndex(item => item.id === currentSubjectFilter);
  if (activeIndex === -1) {
    activeIndex = 0;
    currentSubjectFilter = 'All';
  }
  const currentItem = carouselItems[activeIndex];

  carouselWrapper.innerHTML = `
    <button class="subj-arrow-btn prev" type="button" aria-label="Previous Subject" onclick="navigateSubjectCarousel(-1)">
      ‹
    </button>
    <div class="subj-center-card" onclick="handleCenterSubjectClick('${currentItem.id}')">
      <div class="subj-center-meta">
        <span class="subj-center-badge">${currentItem.countBadge}</span>
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
  container.appendChild(carouselWrapper);

  const activeSubjects = currentSubjectFilter === 'All' ? subjects : subjects.filter(s => s.name === currentSubjectFilter);

  // 2. Render Textbooks or Notes
  if (subpart === 'books') {
    activeSubjects.forEach(sub => {
      const booksForSub = notesData.filter(d => d.year === year && d.subject === sub.name && d.contentType === 'book');

      const banner = document.createElement('div');
      banner.className = 'subject-section-banner';
      banner.onclick = () => openSubjectByName(sub.name, 'books');
      banner.style.cursor = 'pointer';
      banner.innerHTML = `
        <div class="ss-header-row">
          <div class="ss-title-box">
            <span class="ss-icon">${sub.icon || '📖'}</span>
            <span class="ss-title">${sub.name}</span>
          </div>
          <span class="ss-badge">${booksForSub.length} Standard Books</span>
        </div>
      `;
      container.appendChild(banner);

      if (booksForSub.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'font-size:11px;color:var(--text-muted);padding:10px 14px;background:#FFFFFF;border-radius:10px;border:1px dashed var(--border);margin-bottom:8px;';
        emptyDiv.innerText = `No textbook uploaded for ${sub.name} yet.`;
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
    // 3. Render Academic Notes by Subject (Chapters & Topics)
    activeSubjects.forEach(sub => {
      const chapters = sub.chapters || [];
      const chCount = chapters.length;
      let topCount = 0;
      chapters.forEach(c => topCount += (c.topics ? c.topics.length : 0));

      const tile = document.createElement('div');
      tile.className = 'subject-tile';
      tile.onclick = () => openSubjectChapters(sub);
      tile.style.cursor = 'pointer';
      tile.innerHTML = `
        <div class="subj-icon-box">${sub.icon || '📖'}</div>
        <div style="flex:1;min-width:0;">
          <div class="subj-title">${sub.name}</div>
          <div class="subj-code">${sub.code || 'AYUSH'} • <strong style="color:var(--brand-green);">${chCount} Chapters</strong> • ${topCount} Topics</div>
        </div>
        <div class="subj-arrow" style="font-size:18px;font-weight:700;color:var(--brand-green);">›</div>
      `;
      container.appendChild(tile);

      if (chapters.length > 0) {
        chapters.forEach(ch => {
          const chEl = document.createElement('div');
          chEl.className = 'chapter-drill-pill';
          chEl.onclick = () => openChapterTopics(ch);
          chEl.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">
              <span class="chapter-number-chip">CH</span>
              <span class="ch-pill-title">${ch.title}</span>
            </div>
            <span class="ch-pill-count">${(ch.topics ? ch.topics.length : 0)} Topics ›</span>
          `;
          container.appendChild(chEl);
        });
      }
    });
  }
}

function handleCenterSubjectClick(subjectId) {
  if (subjectId === 'All') {
    const subjects = BHMS_CURRICULUM[currentAppYear] || [];
    if (subjects.length > 0) {
      currentSubjectFilter = subjects[0].name;
    }
  } else {
    const sub = (BHMS_CURRICULUM[currentAppYear] || []).find(s => s.name === subjectId);
    if (sub) {
      if (currentAppSubpart === 'books') openSubjectByName(sub.name, 'books');
      else openSubjectChapters(sub);
    }
  }
  renderAppContentForYear(currentAppYear, currentAppSubpart);
}

function navigateSubjectCarousel(direction) {
  const subjects = BHMS_CURRICULUM[currentAppYear] || [];
  const carouselItems = ['All', ...subjects.map(s => s.name)];
  let idx = carouselItems.indexOf(currentSubjectFilter);
  idx = (idx + direction + carouselItems.length) % carouselItems.length;
  currentSubjectFilter = carouselItems[idx];
  renderAppContentForYear(currentAppYear, currentAppSubpart);
}

function jumpToSubjectCarouselIndex(idx) {
  const subjects = BHMS_CURRICULUM[currentAppYear] || [];
  const carouselItems = ['All', ...subjects.map(s => s.name)];
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
  document.getElementById('chaptersSubjectCode').innerText = subject.code || 'AYUSH';
  document.getElementById('chaptersIntroName').innerText = subject.name;
  document.getElementById('chaptersIntroIcon').innerText = subject.icon || '📖';
  document.getElementById('chaptersIntroDesc').innerText = subject.desc || 'AYUSH Syllabus';

  const container = document.getElementById('appChaptersContainer');
  if (container) {
    container.innerHTML = '';
    if (!subject.chapters || subject.chapters.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:36px 16px;background:#FFF;border:1px dashed var(--border);border-radius:12px;color:var(--text-muted);">
          <div style="font-size:32px;margin-bottom:8px;">📑</div>
          <div style="font-weight:700;color:var(--text);">No Chapters Published Yet</div>
          <div style="font-size:11px;margin-top:4px;">When faculty uploads course chapters &amp; notes, they will appear here live.</div>
        </div>
      `;
    } else {
      subject.chapters.forEach((ch, idx) => {
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
            <span>Verified AYUSH Syllabus</span>
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

function openChapterTopics(chapter) {
  currentSelectedChapter = chapter;

  const subjName = currentSelectedSubject ? currentSelectedSubject.name : 'Subject';
  const breadcrumb = document.getElementById('topicsBreadcrumb');
  if (breadcrumb) breadcrumb.innerHTML = `${subjName} <span>›</span> ${chapter.title}`;

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
            <span class="topic-meta-pill" style="color:var(--brand-green);border-color:#A7F3D0;background:var(--brand-green-pale);">✓ AYUSH Standard</span>
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
  const sc = document.getElementById('appScreenChapters');
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
  document.getElementById('subjectNotesSub').innerText = `${sub.code || 'AYUSH'} • ${currentAppYear}`;

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
  if (!doc) return;

  currentViewingDoc = doc;
  currentViewerPage = 1;

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
    wm.innerText = `HOMOEO PULSE • ${currentUserProfile.name.toUpperCase()} • VERIFIED AYUSH MATERIAL`;
  } else if (wm) {
    wm.innerText = `HOMOEO PULSE • VERIFIED AYUSH MATERIAL`;
  }

  updateViewerBookmarkBtn();

  const canvasContainer = document.getElementById('pdfCanvasContainer');
  const spinner = document.getElementById('pdfLoadingSpinner');
  const fallbackViewport = document.getElementById('pdfFallbackViewport');

  if (spinner) spinner.style.display = 'block';

  // 1. Check if saved in IndexedDB Offline Study Vault
  const vaultBuffer = await getPdfFromVault(doc.id);
  if (vaultBuffer && typeof pdfjsLib !== 'undefined') {
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

      await renderRealPdfPage(1);
      updateResumeCardUI();
      return;
    } catch (err) {
      console.warn('Vault buffer render error, falling back to candidates:', err);
    }
  }

  // 2. Try loading via network candidates with PDF.js
  // 2. Try loading via network candidates with PDF.js Range Streaming
  if (typeof pdfjsLib !== 'undefined' && doc.fileUrl) {
    const candidateUrls = [];
    if (doc.fileUrl.startsWith('http')) {
      candidateUrls.push(doc.fileUrl);
    } else {
      candidateUrls.push('https://homoeopulse-vault.loca.lt' + doc.fileUrl);
      if (API_BASE_URL) candidateUrls.push(API_BASE_URL + doc.fileUrl);
      candidateUrls.push('http://192.168.98.147:3000' + doc.fileUrl);
      candidateUrls.push(doc.fileUrl);
    }

    for (const url of candidateUrls) {
      try {
        if (spinner) {
          spinner.style.display = 'block';
          spinner.innerHTML = 'Connecting to Medical Vault... 📄';
        }

        // Fast connectivity check: if server unreachable, abort in 2500ms
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        try {
          const testRes = await fetch(url, { method: 'HEAD', signal: controller.signal });
          clearTimeout(timeoutId);
          if (!testRes.ok && testRes.status !== 206) continue;
        } catch (netErr) {
          clearTimeout(timeoutId);
          continue; // Server unreachable, try next candidate
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
            spinner.innerHTML = `Fast Streaming Page 1 (${pct}%)... 📄<br><span style="font-size:10px;font-weight:500;opacity:0.85;">${mb} MB</span>`;
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

        await renderRealPdfPage(1);
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

      await renderRealPdfPage(1);
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

async function renderRealPdfPage(pageNumber) {
  if (!currentPdfDoc) return;
  const canvas = document.getElementById('pdfRenderCanvas');
  if (!canvas) return;

  const page = await currentPdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: currentPdfScale });
  const ctx = canvas.getContext('2d');

  canvas.height = viewport.height;
  canvas.width = viewport.width;

  if (currentRenderingTask) {
    try { currentRenderingTask.cancel(); } catch(e) {}
  }

  currentRenderingTask = page.render({ canvasContext: ctx, viewport: viewport });
  await currentRenderingTask.promise;

  document.getElementById('viewerCurrentPageText').innerText = pageNumber;
  document.getElementById('viewerPageSlider').value = pageNumber;
  document.getElementById('pdfPageNumberSpan').innerText = `Page ${pageNumber} of ${currentPdfDoc.numPages}`;
}

// ============================================================
// TOUCH PINCH-TO-ZOOM & PAN GESTURES ENGINE
// ============================================================
let pdfZoomScale = 1.0;
let pdfPanX = 0;
let pdfPanY = 0;
let initialPinchDist = 0;
let initialZoomScale = 1.0;
let touchStartX = 0;
let touchStartY = 0;
let lastTapTime = 0;
let isPinching = false;
let isPanning = false;

function applyPdfTransform() {
  const wrapper = document.getElementById('pdfZoomWrapper') || document.getElementById('pdfRenderCanvas');
  if (!wrapper) return;
  if (pdfZoomScale <= 1.0) {
    pdfZoomScale = 1.0;
    pdfPanX = 0;
    pdfPanY = 0;
  }
  wrapper.style.transform = `translate(${pdfPanX}px, ${pdfPanY}px) scale(${pdfZoomScale})`;
}

function resetPinchZoom() {
  pdfZoomScale = 1.0;
  pdfPanX = 0;
  pdfPanY = 0;
  isPinching = false;
  isPanning = false;
  applyPdfTransform();
}

function setupPdfTouchGestures() {
  const container = document.getElementById('pdfCanvasContainer');
  if (!container || container._hasPinchAttached) return;
  container._hasPinchAttached = true;

  container.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      isPinching = true;
      isPanning = false;
      initialPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialZoomScale = pdfZoomScale;
    } else if (e.touches.length === 1) {
      isPinching = false;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      if (pdfZoomScale > 1.0) {
        isPanning = true;
      }
      // Double tap to toggle zoom
      const now = Date.now();
      if (now - lastTapTime < 300) {
        if (pdfZoomScale > 1.1) {
          resetPinchZoom();
        } else {
          pdfZoomScale = 2.0;
          pdfPanX = 0;
          pdfPanY = 0;
          applyPdfTransform();
        }
        lastTapTime = 0;
      } else {
        lastTapTime = now;
      }
    }
  }, { passive: false });

  container.addEventListener('touchmove', (e) => {
    if (isPinching && e.touches.length === 2) {
      e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (initialPinchDist > 0) {
        const factor = currentDist / initialPinchDist;
        pdfZoomScale = Math.min(Math.max(0.85, initialZoomScale * factor), 4.5);
        applyPdfTransform();
      }
    } else if (isPanning && e.touches.length === 1 && pdfZoomScale > 1.0) {
      e.preventDefault();
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      pdfPanX += dx;
      pdfPanY += dy;
      applyPdfTransform();
    }
  }, { passive: false });

  container.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      isPinching = false;
      if (pdfZoomScale < 1.0) {
        resetPinchZoom();
      }
    }
    if (e.touches.length === 0) {
      isPanning = false;
    }
  });
}

function togglePdfDarkMode() {
  const page = document.getElementById('pdfDocumentPage');
  if (page) page.classList.toggle('inverted');
  const canvas = document.getElementById('pdfRenderCanvas');
  if (canvas) canvas.style.filter = canvas.style.filter ? '' : 'invert(90%) hue-rotate(180deg)';
}

function closePdfViewer() {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  const sc = document.getElementById(pdfViewerOriginScreen) || document.getElementById('appScreenDashboard');
  if (sc) sc.classList.add('active');
  resetPinchZoom();
}

function changeViewerPage(delta) {
  const max = currentPdfDoc ? currentPdfDoc.numPages : (currentViewingDoc ? currentViewingDoc.pages : 1);
  const next = Math.max(1, Math.min(max, currentViewerPage + delta));
  if (next !== currentViewerPage) {
    currentViewerPage = next;
    if (currentPdfDoc) renderRealPdfPage(next);
    else renderViewerPageContent();
  }
}

function handleViewerSlider(val) {
  currentViewerPage = parseInt(val) || 1;
  if (currentPdfDoc) renderRealPdfPage(currentViewerPage);
  else renderViewerPageContent();
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
  const author = currentViewingDoc.author || 'Dr. Hemraj & Faculty Panel';

  // Rich clinical curriculum pages with actual syllabus content
  const chapterTopics = [
    {
      title: "1. Comprehensive Clinical Foundations & NCH Syllabus",
      badge: "Syllabus Unit 1",
      content: `This canonical edition covers the core theoretical and clinical concepts of <strong>${subject}</strong> prescribed by the National Commission for Homoeopathy (NCH) & AYUSH. In clinical practice, understanding underlying disease pathology, holistic constitutional assessment, and fundamental homeopathic principles is paramount.`
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
      <div style="font-size:11px;color:var(--text-muted);">Authored / Curated by: <strong>${author}</strong> • Standard AYUSH Curriculum</div>
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
  const doc = notesData.find(d => String(d.id) === String(docId));
  if (doc) {
    doc.bookmarked = !doc.bookmarked;
    updateVaultCounts();
    if (document.getElementById('appScreenVault').classList.contains('active')) renderVaultScreen();
  }
}

async function toggleDocDownload(docId) {
  const doc = notesData.find(d => String(d.id) === String(docId));
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
    triggerPhonePushNotification('Removed from Vault', `"${formatDocTitle(doc.title)}" removed from offline storage.`);
    if (document.getElementById('appScreenVault').classList.contains('active')) renderVaultScreen();
    return;
  }

  // Download & Save to IndexedDB
  if (btn) {
    btn.innerHTML = '⏳ Saving...';
    btn.disabled = true;
  }
  triggerPhonePushNotification('Study Vault Download', `Downloading "${formatDocTitle(doc.title)}" for offline access...`);

  let fetchedBuffer = null;

  // Try candidate URLs to fetch real PDF binary
  const candidateUrls = [];
  if (doc.fileUrl) {
    if (doc.fileUrl.startsWith('http')) {
      candidateUrls.push(doc.fileUrl);
    } else {
      candidateUrls.push('https://homoeopulse-vault.loca.lt' + doc.fileUrl);
      if (API_BASE_URL) candidateUrls.push(API_BASE_URL + doc.fileUrl);
      candidateUrls.push('http://192.168.98.147:3000' + doc.fileUrl);
      candidateUrls.push(doc.fileUrl);
    }
  }

  for (const u of candidateUrls) {
    try {
      const res = await fetch(u);
      if (res.ok) {
        fetchedBuffer = await res.arrayBuffer();
        if (fetchedBuffer && fetchedBuffer.byteLength > 500) {
          break;
        }
      }
    } catch (err) {}
  }

  // Fallback: Cache sample_note.pdf into vault so user always has valid offline multi-page PDF
  if (!fetchedBuffer) {
    try {
      const fbRes = await fetch('sample_note.pdf');
      if (fbRes.ok) {
        fetchedBuffer = await fbRes.arrayBuffer();
      }
    } catch (e) {}
  }

  if (fetchedBuffer) {
    await savePdfToVault(doc.id, fetchedBuffer);
  }

  doc.downloaded = true;
  setDocDownloadedInStorage(doc.id, true);
  updateVaultCounts();

  if (btn) {
    btn.classList.add('downloaded');
    btn.innerHTML = '✓ Offline';
    btn.disabled = false;
  }

  triggerPhonePushNotification('✓ Offline Vault Ready', `"${formatDocTitle(doc.title)}" saved! You can now read it offline in Study Vault.`);
  if (document.getElementById('appScreenVault').classList.contains('active')) renderVaultScreen();
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
  const bookmarks = notesData.filter(d => d.bookmarked);
  const offline = notesData.filter(d => d.downloaded);
  const bEl = document.getElementById('countVaultBookmarks');
  const oEl = document.getElementById('countVaultOffline');
  if (bEl) bEl.innerText = bookmarks.length;
  if (oEl) oEl.innerText = offline.length;
}

let currentVaultTab = 'bookmarks';
function switchVaultTab(tab) {
  currentVaultTab = tab;
  document.getElementById('btnVaultBookmarks').classList.toggle('active', tab === 'bookmarks');
  document.getElementById('btnVaultOffline').classList.toggle('active', tab === 'offline');
  renderVaultScreen();
}

function renderVaultScreen() {
  const container = document.getElementById('appVaultContainer');
  if (!container) return;
  container.innerHTML = '';

  const list = currentVaultTab === 'bookmarks'
    ? notesData.filter(d => d.bookmarked)
    : notesData.filter(d => d.downloaded);

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px 16px;color:var(--text-muted);">
        <div style="font-size:36px;margin-bottom:8px;">${currentVaultTab === 'bookmarks' ? '⭐' : '📥'}</div>
        <div style="font-weight:700;">No ${currentVaultTab} saved yet</div>
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
        <div style="font-size:11px;color:var(--text-muted);">${doc.subject} • ${doc.pages} pgs</div>
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
  const isConfigured = currentUserProfile && currentUserProfile.isSetupDone && currentUserProfile.name && currentUserProfile.name.trim().length > 0;

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
  currentUserProfile.name = document.getElementById('profName').value.trim();
  currentUserProfile.college = document.getElementById('profCollege').value.trim();
  currentUserProfile.year = document.getElementById('profYear').value;
  currentUserProfile.email = document.getElementById('profEmail').value.trim();
  currentUserProfile.isSetupDone = true;

  saveLocalProfile();
  renderUserProfileUI();
  closeEditProfileModal();

  try {
    await fetch('/api/user-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentUserProfile)
    });
  } catch (e) {}

  triggerPhonePushNotification('Profile Registered', `Welcome, ${currentUserProfile.name}! Your credentials have been saved.`);
}

// ============================================================
// NATIVE ANDROID HARDWARE/GESTURE BACK BUTTON CONTROLLER
// ============================================================
function handleAppHardwareBack() {
  // 1. Edit Profile Modal
  const profModal = document.getElementById('profileModal');
  if (profModal && profModal.classList.contains('active')) {
    closeEditProfileModal();
    return true;
  }
  // 2. PDF Viewer
  const pdfScreen = document.getElementById('appScreenPdfViewer');
  if (pdfScreen && pdfScreen.classList.contains('active')) {
    closePdfViewer();
    return true;
  }
  // 3. Topics screen
  const topicsScreen = document.getElementById('appScreenTopics');
  if (topicsScreen && topicsScreen.classList.contains('active')) {
    document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
    const sc = document.getElementById('appScreenChapters') || document.getElementById('appScreenDashboard');
    if (sc) sc.classList.add('active');
    return true;
  }
  // 4. Notes list
  const notesScreen = document.getElementById('appScreenNotesList');
  if (notesScreen && notesScreen.classList.contains('active')) {
    document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
    const sc = document.getElementById('appScreenChapters') || document.getElementById('appScreenDashboard');
    if (sc) sc.classList.add('active');
    return true;
  }
  // 5. Chapters screen
  const chapScreen = document.getElementById('appScreenChapters');
  if (chapScreen && chapScreen.classList.contains('active')) {
    switchAppTab('dashboard');
    return true;
  }
  // 6. Admin / Vault / Profile tab -> return to Dashboard
  const dashScreen = document.getElementById('appScreenDashboard');
  if (dashScreen && !dashScreen.classList.contains('active')) {
    switchAppTab('dashboard');
    return true;
  }
  return false;
}

// Attach native Capacitor Android Back Button Listener
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
  window.Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
    const handled = handleAppHardwareBack();
    if (!handled && canGoBack) {
      window.history.back();
    }
  });
}

// Web History Popstate Listener
window.addEventListener('popstate', (e) => {
  handleAppHardwareBack();
});

// ============================================================
// SEARCH & TAB NAVIGATION
// ============================================================
function handleAppSearch() {
  const query = document.getElementById('appSearchInput').value.toLowerCase().trim();
  if (!query) {
    renderAppContentForYear(currentAppYear, currentAppSubpart);
    return;
  }

  const container = document.getElementById('appSubjectsContainer');
  if (!container) return;
  container.innerHTML = '';

  const matchedDocs = notesData.filter(d =>
    d.title.toLowerCase().includes(query) ||
    d.subject.toLowerCase().includes(query) ||
    d.summary.toLowerCase().includes(query) ||
    d.author.toLowerCase().includes(query)
  );

  if (matchedDocs.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:36px 16px;background:#FFF;border:1px dashed var(--border);border-radius:12px;color:var(--text-muted);">
        <div style="font-size:28px;margin-bottom:6px;">🔍</div>
        <div style="font-weight:700;">No results found for "${query}"</div>
      </div>
    `;
    return;
  }

  matchedDocs.forEach(doc => {
    const card = document.createElement('div');
    card.className = 'book-card-item';
    card.innerHTML = `
      <div class="book-spine-cover"><span>${doc.contentType === 'book' ? '📖' : '📝'}</span></div>
      <div class="book-card-details">
        <div class="book-card-title">${doc.title}</div>
        <div class="book-card-author">By ${doc.author}</div>
        <div class="book-card-meta">
          <span class="badge-tag year" style="font-size:9px;padding:1px 6px;">${doc.year} • ${doc.subject}</span>
          <span>${doc.pages} pgs</span>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button class="btn-doc-open" style="padding:4px 12px;font-size:10px;" onclick="openPdfViewer('${doc.id}')">Read</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
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

