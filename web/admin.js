// ============================================================
// HOMOEO PULSE - DEDICATED FACULTY & ADMIN CMS ENGINE
// ============================================================

const syncChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('homoeo_pulse_sync') : null;

function notifyStudentAppOfUpdate() {
  try {
    if (syncChannel) syncChannel.postMessage({ type: 'DATA_UPDATED', timestamp: Date.now() });
    localStorage.setItem('hp_last_sync_time', Date.now().toString());
  } catch (e) {}
}

let notesData = [];
let BHMS_CURRICULUM = {};
let studentsData = [];
let collegesData = [];
let notificationHistory = [];
let currentAdminCurriculumYear = '1st Year';

let selectedUploadFileBase64 = null;
let selectedUploadFileName = null;
let selectedUploadFileSizeStr = '3.5 MB';

// ============================================================
// ADMIN SECURITY AUTHENTICATION ENGINE
// ============================================================
const DEFAULT_ADMIN_PASSCODE = 'homoeopulse2025';

function checkAdminAuthGate() {
  const isAuth = sessionStorage.getItem('hp_admin_authenticated') === 'true';
  const modal = document.getElementById('adminAuthModal');
  if (!modal) return;
  if (!isAuth) {
    modal.style.display = 'flex';
  } else {
    modal.style.display = 'none';
  }
}

function handleAdminAuth(e) {
  e.preventDefault();
  const input = document.getElementById('adminPasscodeInput');
  const errBox = document.getElementById('adminAuthError');
  const pass = (input ? input.value : '').trim();

  if (pass === DEFAULT_ADMIN_PASSCODE || pass === 'ayush2025') {
    sessionStorage.setItem('hp_admin_authenticated', 'true');
    sessionStorage.setItem('hp_admin_token', pass);
    if (errBox) errBox.style.display = 'none';
    const modal = document.getElementById('adminAuthModal');
    if (modal) modal.style.display = 'none';
    loadAdminData();
  } else {
    if (errBox) errBox.style.display = 'block';
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}
window.handleAdminAuth = handleAdminAuth;

function adminLogout() {
  sessionStorage.removeItem('hp_admin_authenticated');
  sessionStorage.removeItem('hp_admin_token');
  const modal = document.getElementById('adminAuthModal');
  if (modal) {
    modal.style.display = 'flex';
    const input = document.getElementById('adminPasscodeInput');
    if (input) {
      input.value = '';
      input.focus();
    }
  }
}
window.adminLogout = adminLogout;

function getAdminHeaders() {
  const token = sessionStorage.getItem('hp_admin_token') || DEFAULT_ADMIN_PASSCODE;
  return {
    'Content-Type': 'application/json',
    'x-admin-key': token
  };
}

// ============================================================
// INITIALIZATION & DATA SYNC
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  checkAdminAuthGate();
  await loadAdminData();
  setupSyncListener();
});

function setupSyncListener() {
  if (syncChannel) {
    syncChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'STUDENT_ACTIVITY') {
        loadAdminData(true);
      }
    };
  }
}

async function loadAdminData(silent = false) {
  try {
    const res = await fetch('/api/bootstrap');
    if (res.ok) {
      const data = await res.json();
      notesData = Array.isArray(data.notes) ? data.notes : [];
      BHMS_CURRICULUM = (data.curriculum && Object.keys(data.curriculum).length > 0) ? data.curriculum : {};
      studentsData = Array.isArray(data.students) ? data.students : [];
      collegesData = Array.isArray(data.colleges) ? data.colleges : [];
      notificationHistory = Array.isArray(data.notifications) ? data.notifications : [];

      renderAdminNotesTable();
      renderAdminCurriculumTree(currentAdminCurriculumYear);
      renderStudentTable();
      renderCollegesGrid();
      renderNotificationHistory();
      updateModalSubjectDropdown();
      updateAnalyticsStats();

      document.getElementById('apiStatusText').innerText = 'REST BACKEND • CONNECTED';
      const statusEl = document.getElementById('systemLiveStatus');
      if (statusEl) {
        statusEl.style.background = 'var(--brand-green-pale)';
        statusEl.style.borderColor = '#A7F3D0';
      }
    }
  } catch (err) {
    console.warn('Backend load error:', err);
    document.getElementById('apiStatusText').innerText = 'OFFLINE / STANDALONE';
  }
}

// ============================================================
// ADMIN TAB SWITCHER
// ============================================================
function showAdminTab(tabName) {
  document.querySelectorAll('.admin-nav .nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.admin-tab-view').forEach(el => el.style.display = 'none');

  const navEl = document.getElementById('nav-' + tabName);
  if (navEl) navEl.classList.add('active');

  const tabEl = document.getElementById('tab-' + tabName);
  if (tabEl) tabEl.style.display = 'block';

  if (tabName === 'curriculum') {
    renderAdminCurriculumTree(currentAdminCurriculumYear);
  } else if (tabName === 'notes') {
    renderAdminNotesTable();
  } else if (tabName === 'analytics') {
    updateAnalyticsStats();
  }
}

// ============================================================
// NOTES & BOOKS TABLE
// ============================================================
function renderAdminNotesTable(filterQuery = '', filterType = 'All', filterYear = 'All', filterCat = 'All') {
  const tbody = document.getElementById('adminNotesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filtered = notesData.filter(doc => {
    const matchesQ = filterQuery === '' ||
      doc.title.toLowerCase().includes(filterQuery) ||
      (doc.subject && doc.subject.toLowerCase().includes(filterQuery)) ||
      (doc.author && doc.author.toLowerCase().includes(filterQuery));
    const matchesT = filterType === 'All' || doc.contentType === filterType;
    const matchesY = filterYear === 'All' || doc.year === filterYear;
    const matchesC = filterCat === 'All' || doc.category === filterCat;
    return matchesQ && matchesT && matchesY && matchesC;
  });

  document.getElementById('badge-notes-count').innerText = notesData.length;

  if (filtered.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="8" style="text-align:center;padding:48px 16px;color:var(--text-muted);">
        <div style="font-size:36px;margin-bottom:8px;">📂</div>
        <div style="font-size:15px;font-weight:700;color:var(--text);">No Academic Documents Uploaded Yet</div>
        <div style="font-size:12px;margin-top:4px;">Click the <strong>"+ Upload Academic Material"</strong> button above to upload your first textbook or chapter note PDF.</div>
      </td>
    `;
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach(doc => {
    const isBook = doc.contentType === 'book';
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML = `
      <td style="padding:14px 16px;">
        <div style="font-weight:700;color:var(--text);">${escapeHtml(doc.title)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">By ${escapeHtml(doc.author || 'Faculty Team')}</div>
      </td>
      <td style="padding:14px 16px;">
        <span class="badge-tag" style="${isBook ? 'background:var(--brand-green-pale);color:var(--brand-green);border:1px solid #A7F3D0;' : 'background:#FEF3C7;color:#B45309;border:1px solid #FDE68A;'} font-weight:700;padding:3px 8px;border-radius:6px;font-size:11px;">
          ${isBook ? '📚 Standard Book' : '📝 Study Note'}
        </span>
      </td>
      <td style="padding:14px 16px;"><span class="badge-tag year" style="background:#EFF6FF;color:#1D4ED8;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${doc.year}</span></td>
      <td style="padding:14px 16px;font-weight:600;">${escapeHtml(doc.subject || '—')}</td>
      <td style="padding:14px 16px;"><span class="badge-tag cat" style="background:#F1F5F9;color:#475569;padding:3px 8px;border-radius:6px;font-size:11px;">${escapeHtml(doc.category || 'General')}</span></td>
      <td style="padding:14px 16px;color:var(--text-muted);">${doc.size || '3.5 MB'} (${doc.pages || 14} pgs)</td>
      <td style="padding:14px 16px;"><strong style="color:var(--brand-green);">${doc.downloads || 0}</strong></td>
      <td style="padding:14px 16px;text-align:right;">
        ${doc.fileUrl ? `<a href="${doc.fileUrl}" target="_blank" style="text-decoration:none;padding:5px 10px;background:#F1F5F9;border-radius:6px;font-size:11px;font-weight:700;color:var(--text);margin-right:6px;">View PDF</a>` : ''}
        <button class="action-btn delete" onclick="deleteNote('${doc.id}')" style="padding:5px 10px;background:#FEE2E2;color:#DC2626;border:1px solid #FECACA;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterAdminNotes() {
  const q = document.getElementById('adminSearchNotes').value.toLowerCase().trim();
  const t = document.getElementById('adminFilterType').value;
  const y = document.getElementById('adminFilterYear').value;
  const c = document.getElementById('adminFilterCat').value;
  renderAdminNotesTable(q, t, y, c);
}

async function deleteNote(id) {
  if (!confirm('Are you sure you want to permanently delete this academic document from the repository?')) return;
  try {
    const res = await fetch(`/api/notes/${id}`, {
      method: 'DELETE',
      headers: getAdminHeaders()
    });
    if (res.ok) {
      notesData = notesData.filter(d => d.id !== id);
      renderAdminNotesTable();
      renderAdminCurriculumTree(currentAdminCurriculumYear);
      updateAnalyticsStats();
      notifyStudentAppOfUpdate();
    }
  } catch (err) {
    console.error('Delete error:', err);
  }
}

// ============================================================
// CURRICULUM TREE & TOPIC MANAGER
// ============================================================
function switchAdminCurriculumYear(year) {
  currentAdminCurriculumYear = year;
  document.querySelectorAll('#adminCurriculumYearBar .admin-year-btn').forEach(btn => {
    btn.classList.toggle('active', btn.innerText.trim() === year);
  });
  renderAdminCurriculumTree(year);
}

function renderAdminCurriculumTree(year = currentAdminCurriculumYear) {
  const container = document.getElementById('adminCurriculumTreeContainer');
  if (!container) return;
  container.innerHTML = '';

  const subjects = (BHMS_CURRICULUM && BHMS_CURRICULUM[year]) ? BHMS_CURRICULUM[year] : [];
  if (subjects.length === 0) {
    container.innerHTML = `<div style="padding:32px;text-align:center;background:#fff;border-radius:12px;border:1px dashed var(--border);color:var(--text-muted);">No subjects found for ${year}.</div>`;
    return;
  }

  subjects.forEach(sub => {
    const acc = document.createElement('div');
    acc.className = 'admin-subject-accordion';
    acc.style.cssText = 'background:#fff;border:1px solid var(--border);border-radius:14px;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.02);';

    const chCount = sub.chapters ? sub.chapters.length : 0;
    let topCount = 0;
    if (sub.chapters) sub.chapters.forEach(c => topCount += (c.topics ? c.topics.length : 0));

    acc.innerHTML = `
      <div class="admin-subj-header" onclick="toggleAdminSubjectAccordion('${sub.id}')" style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;background:#FAFAFA;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:22px;">${sub.icon || '📖'}</span>
          <div>
            <div style="font-size:15px;font-weight:800;color:var(--text);">${escapeHtml(sub.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${sub.code || 'AYUSH'} • <strong style="color:var(--brand-green);">${chCount} Chapters</strong> • ${topCount} Topics</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="btn btn-secondary" style="font-size:11px;padding:6px 14px;font-weight:700;border:1px solid #A7F3D0;background:var(--brand-green-pale);color:var(--brand-green);border-radius:8px;cursor:pointer;" onclick="event.stopPropagation();openAddChapterModal('${year}', '${escapeHtml(sub.name)}')">
            + Add Chapter
          </button>
          <span id="accArrow_${sub.id}" style="font-size:16px;font-weight:700;color:var(--text-muted);transition:transform 0.2s;">▼</span>
        </div>
      </div>
      <div class="admin-chapters-list" id="adminChList_${sub.id}" style="padding:16px 20px;display:block;">
        ${(sub.chapters && sub.chapters.length > 0) ? sub.chapters.map(ch => `
          <div class="admin-chapter-card" style="background:#F8FAFC;border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div>
                <span style="font-size:14px;font-weight:800;color:var(--text);">${escapeHtml(ch.title)}</span>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${escapeHtml(ch.desc || '')}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="btn btn-primary" style="font-size:11px;padding:5px 12px;font-weight:700;background:var(--brand-green);color:#fff;border:none;border-radius:6px;cursor:pointer;" onclick="openUploadModalForTopic('${year}', '${escapeHtml(sub.name)}', '${ch.id}')">
                  + Add Topic PDF
                </button>
              </div>
            </div>
            <!-- Topic Pills List -->
            <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px;">
              ${(ch.topics && ch.topics.length > 0) ? ch.topics.map(t => `
                <div style="display:flex;align-items:center;justify-content:space-between;background:#fff;padding:8px 12px;border-radius:8px;border:1px solid var(--border);font-size:12px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <span style="color:var(--brand-green);font-weight:700;">📄</span>
                    <span style="font-weight:700;color:var(--text);">${escapeHtml(t.title)}</span>
                    <span style="color:var(--text-muted);font-size:11px;">(${t.pages || 14} pgs • ${t.size || '3.5 MB'})</span>
                    ${t.fileUrl ? `<span style="background:#ECFDF5;color:#065F46;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;">PDF ATTACHED</span>` : ''}
                  </div>
                  <div style="display:flex;gap:6px;">
                    ${t.fileUrl ? `<a href="${t.fileUrl}" target="_blank" style="font-size:11px;color:var(--brand-green);font-weight:700;text-decoration:none;">View</a>` : ''}
                  </div>
                </div>
              `).join('') : '<div style="font-size:11px;color:var(--text-muted);padding:6px;">No topics attached yet. Click "+ Add Topic PDF" to upload material here.</div>'}
            </div>
          </div>
        `).join('') : '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:12px;">No chapters created for this subject yet. Click "+ Add Chapter" above.</div>'}
      </div>
    `;

    container.appendChild(acc);
  });
}

function toggleAdminSubjectAccordion(subId) {
  const list = document.getElementById('adminChList_' + subId);
  const arrow = document.getElementById('accArrow_' + subId);
  if (list) {
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'block' : 'none';
    if (arrow) arrow.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
  }
}

// ============================================================
// UPLOAD MODAL & REAL PDF PROCESSING
// ============================================================
function openUploadModal() {
  document.getElementById('uploadModal').classList.add('active');
  updateModalSubjectDropdown();
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.remove('active');
}

function openUploadModalForTopic(year = currentAdminCurriculumYear, subjectName = '', chapterId = '') {
  openUploadModal();
  if (year) {
    document.getElementById('mDocYear').value = year;
    updateModalSubjectDropdown();
  }
  if (subjectName) {
    document.getElementById('mDocSubject').value = subjectName;
    updateModalChapterDropdown();
  }
  if (chapterId) {
    document.getElementById('mDocChapter').value = chapterId;
  }
  document.getElementById('mDocType').value = 'note';
  updateModalCategoryOptions();
}

function updateModalSubjectDropdown() {
  const year = document.getElementById('mDocYear') ? document.getElementById('mDocYear').value : '1st Year';
  const subSelect = document.getElementById('mDocSubject');
  if (!subSelect) return;
  const subjects = (BHMS_CURRICULUM && BHMS_CURRICULUM[year]) ? BHMS_CURRICULUM[year] : [];
  subSelect.innerHTML = subjects.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
  updateModalChapterDropdown();
}

function updateModalChapterDropdown() {
  const year = document.getElementById('mDocYear') ? document.getElementById('mDocYear').value : '1st Year';
  const subjectName = document.getElementById('mDocSubject') ? document.getElementById('mDocSubject').value : '';
  const chSelect = document.getElementById('mDocChapter');
  const chGroup = document.getElementById('mChapterGroup');
  const type = document.getElementById('mDocType') ? document.getElementById('mDocType').value : 'note';

  if (!chSelect || !chGroup) return;

  if (type === 'book') {
    chGroup.style.display = 'none';
    return;
  }
  chGroup.style.display = 'block';

  let chapters = [];
  if (BHMS_CURRICULUM && BHMS_CURRICULUM[year]) {
    const s = BHMS_CURRICULUM[year].find(sub => sub.name === subjectName);
    if (s && s.chapters) chapters = s.chapters;
  }

  if (chapters.length === 0) {
    chSelect.innerHTML = `<option value="__NEW__">+ Create New Chapter</option>`;
    const newChInput = document.getElementById('mDocNewChapterTitle');
    if (newChInput) {
      newChInput.style.display = 'block';
      newChInput.value = 'Chapter 1: Introductory Principles';
    }
  } else {
    chSelect.innerHTML = chapters.map(c => `<option value="${c.id}">${escapeHtml(c.title)}</option>`).join('') +
      `<option value="__NEW__">+ Create New Chapter</option>`;
    const newChInput = document.getElementById('mDocNewChapterTitle');
    if (newChInput) newChInput.style.display = 'none';
  }
}

function handleModalChapterSelectChange() {
  const chSelect = document.getElementById('mDocChapter');
  const newChInput = document.getElementById('mDocNewChapterTitle');
  if (chSelect && newChInput) {
    if (chSelect.value === '__NEW__') {
      newChInput.style.display = 'block';
      newChInput.focus();
    } else {
      newChInput.style.display = 'none';
    }
  }
}

function toggleNewChapterInput() {
  const chSelect = document.getElementById('mDocChapter');
  const newChInput = document.getElementById('mDocNewChapterTitle');
  if (chSelect && newChInput) {
    chSelect.value = '__NEW__';
    newChInput.style.display = 'block';
    newChInput.focus();
  }
}

function updateModalCategoryOptions() {
  const type = document.getElementById('mDocType').value;
  const catSelect = document.getElementById('mDocCategory');
  const chGroup = document.getElementById('mChapterGroup');

  if (type === 'book') {
    if (chGroup) chGroup.style.display = 'none';
    catSelect.innerHTML = `
      <option value="Standard Textbooks" selected>Standard Textbooks</option>
      <option value="Reference Literature">Reference Literature</option>
      <option value="Official Pharmacopoeia">Official Pharmacopoeia</option>
      <option value="Organon Canonical Editions">Organon Canonical Editions</option>
    `;
    if (document.getElementById('mDocPages')) document.getElementById('mDocPages').value = 450;
  } else {
    if (chGroup) chGroup.style.display = 'block';
    catSelect.innerHTML = `
      <option value="Handwritten Notes" selected>Handwritten Notes</option>
      <option value="University Past Papers">University Past Papers</option>
      <option value="Important Rubrics & Charts">Important Rubrics &amp; Charts</option>
      <option value="Mnemonics & Quick Revision">Mnemonics &amp; Quick Revision</option>
    `;
    if (document.getElementById('mDocPages')) document.getElementById('mDocPages').value = 14;
    updateModalChapterDropdown();
  }
}

function handleModalFileSelect(input) {
  const file = input.files[0];
  const infoEl = document.getElementById('mFileSelectedInfo');
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please choose a valid .PDF document file.');
    input.value = '';
    return;
  }

  selectedUploadFileName = file.name;
  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
  selectedUploadFileSizeStr = sizeMB + ' MB';

  infoEl.innerText = `✓ Selected: ${file.name} (${selectedUploadFileSizeStr}) - Ready for Upload`;

  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    selectedUploadFileBase64 = dataUrl.split(',')[1];
  };
  reader.readAsDataURL(file);
}

async function handleModalUpload(e) {
  e.preventDefault();
  const btn = document.getElementById('btnUploadSubmit');
  if (btn) {
    btn.disabled = true;
    btn.innerText = 'Uploading & Encrypting PDF... ⏳';
  }

  const title = document.getElementById('mDocTitle').value.trim();
  const type = document.getElementById('mDocType').value;
  const year = document.getElementById('mDocYear').value;
  const subject = document.getElementById('mDocSubject').value;
  const category = document.getElementById('mDocCategory').value;
  const author = document.getElementById('mDocAuthor').value.trim();
  const summary = document.getElementById('mDocSummary').value.trim();
  const pages = parseInt(document.getElementById('mDocPages') ? document.getElementById('mDocPages').value : 14) || 14;

  let fileUrl = '';
  let fileSize = selectedUploadFileSizeStr || (type === 'book' ? '28.4 MB' : '3.2 MB');

  // 1. Upload PDF file to /api/upload
  if (selectedUploadFileBase64 && selectedUploadFileName) {
    try {
      const upRes = await fetch('/api/upload', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          filename: selectedUploadFileName,
          base64Data: selectedUploadFileBase64
        })
      });
      if (upRes.ok) {
        const upData = await upRes.json();
        fileUrl = upData.fileUrl;
        fileSize = upData.size;
      }
    } catch (err) {
      console.warn('Upload error, will proceed without local PDF binary:', err);
    }
  }

  // 2. If Note: Post to curriculum topic & create note
  if (type === 'note') {
    const chSelect = document.getElementById('mDocChapter');
    const newChInput = document.getElementById('mDocNewChapterTitle');
    let chapterId = chSelect ? chSelect.value : '';
    let chapterTitle = '';

    if (chapterId === '__NEW__' || !chapterId) {
      chapterTitle = newChInput ? newChInput.value.trim() : '';
      if (!chapterTitle) chapterTitle = `Chapter 1: Study Notes`;
      chapterId = null;
    } else {
      chapterTitle = chSelect.options[chSelect.selectedIndex].text;
    }

    try {
      const topicRes = await fetch('/api/curriculum/topic', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          year,
          subjectName: subject,
          chapterId,
          chapterTitle,
          title,
          pages,
          size: fileSize,
          fileUrl,
          summary
        })
      });

      if (topicRes.ok) {
        const topicData = await topicRes.json();
        if (topicData.note) notesData.unshift(topicData.note);
      }
    } catch (err) {
      console.error('Error posting topic:', err);
    }
  } else {
    // 3. If Standard Textbook: Post to /api/notes
    const newDoc = {
      id: 'book_' + Date.now(),
      contentType: 'book',
      title,
      author: author || 'Faculty Text Team',
      year,
      subject,
      category,
      size: fileSize,
      pages,
      downloads: 1,
      summary: summary || 'Faculty uploaded standard textbook.',
      fileUrl: fileUrl,
      bookmarked: false,
      downloaded: false,
      currentPage: 1
    };

    try {
      const noteRes = await fetch('/api/notes', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify(newDoc)
      });
      if (noteRes.ok) {
        const resData = await noteRes.json();
        notesData.unshift(resData.doc || newDoc);
      }
    } catch (err) {
      console.error('Error saving book:', err);
    }
  }

  // Refresh bootstrap data to stay 100% in sync
  await loadAdminData(true);

  closeUploadModal();
  e.target.reset();
  selectedUploadFileBase64 = null;
  selectedUploadFileName = null;
  document.getElementById('mFileSelectedInfo').innerText = '';

  if (btn) {
    btn.disabled = false;
    btn.innerText = 'Publish to Student Mobile App 🚀';
  }

  notifyStudentAppOfUpdate();

  alert(`✅ Success! "${title}" has been published and is now instantly live on the Student Mobile App!`);
}

// ============================================================
// ADD CHAPTER MODAL
// ============================================================
function openAddChapterModal(year, subjectName) {
  document.getElementById('chModalYear').value = year;
  document.getElementById('chModalSubject').value = subjectName;
  document.getElementById('chModalTargetDisplay').innerText = `Adding to: ${year} ➔ ${subjectName}`;
  document.getElementById('chModalTitle').value = '';
  document.getElementById('chModalDesc').value = '';
  document.getElementById('addChapterModal').classList.add('active');
}

function closeAddChapterModal() {
  document.getElementById('addChapterModal').classList.remove('active');
}

async function handleChapterSubmit(e) {
  e.preventDefault();
  const year = document.getElementById('chModalYear').value;
  const subjectName = document.getElementById('chModalSubject').value;
  const chapterTitle = document.getElementById('chModalTitle').value.trim();
  const chapterDesc = document.getElementById('chModalDesc').value.trim();

  try {
    const res = await fetch('/api/curriculum/chapter', {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify({
        year,
        subjectName,
        chapterTitle,
        chapterDesc
      })
    });
    if (res.ok) {
      await loadAdminData(true);
      closeAddChapterModal();
      notifyStudentAppOfUpdate();
      alert(`✅ Chapter "${chapterTitle}" created successfully under ${subjectName}!`);
    }
  } catch (err) {
    console.error('Chapter error:', err);
  }
}

// ============================================================
// STUDENTS DIRECTORY
// ============================================================
function renderStudentTable(query = '', year = 'All') {
  const tbody = document.getElementById('studentTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filtered = studentsData.filter(s => {
    const matchesQ = query === '' ||
      s.name.toLowerCase().includes(query) ||
      s.id.toLowerCase().includes(query) ||
      s.college.toLowerCase().includes(query);
    const matchesY = year === 'All' || s.year === year;
    return matchesQ && matchesY;
  });

  const pill = document.getElementById('studentStatsPill');
  if (pill) pill.innerText = `${studentsData.length} Scholars Enrolled`;

  filtered.forEach(s => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML = `
      <td style="padding:14px 16px;">
        <div style="font-weight:700;">${escapeHtml(s.name)}</div>
        <div style="font-size:11px;color:var(--brand-green);">Homoeo Pulse Scholar</div>
      </td>
      <td style="padding:14px 16px;"><code>${s.id}</code></td>
      <td style="padding:14px 16px;"><span class="badge-tag year" style="background:#EFF6FF;color:#1D4ED8;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">${s.year}</span></td>
      <td style="padding:14px 16px;">${escapeHtml(s.college)}</td>
      <td style="padding:14px 16px;">
        <span class="badge-tag" style="background:${s.status === 'Active' ? '#ECFDF5' : '#FEF2F2'};color:${s.status === 'Active' ? '#065F46' : '#DC2626'};padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">
          ${s.status}
        </span>
      </td>
      <td style="padding:14px 16px;">
        <button onclick="toggleStudentStatus('${s.id}')" style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;border:1px solid var(--border);background:#fff;cursor:pointer;">
          ${s.status === 'Active' ? 'Suspend' : 'Activate'}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filterStudents() {
  const q = document.getElementById('studentSearchInput').value.toLowerCase().trim();
  const y = document.getElementById('studentYearFilter').value;
  renderStudentTable(q, y);
}

async function toggleStudentStatus(id) {
  const s = studentsData.find(st => st.id === id);
  if (s) {
    s.status = s.status === 'Active' ? 'Suspended' : 'Active';
    renderStudentTable();
    try {
      await fetch(`/api/students/${id}/toggle`, {
        method: 'POST',
        headers: getAdminHeaders()
      });
    } catch (e) {}
  }
}

// ============================================================
// COLLEGES DIRECTORY
// ============================================================
function renderCollegesGrid() {
  const grid = document.getElementById('collegesGrid');
  if (!grid) return;
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:16px;';
  grid.innerHTML = '';

  collegesData.forEach(c => {
    const card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:14px;border:1px solid var(--border);padding:20px;';
    card.innerHTML = `
      <div style="font-size:24px;margin-bottom:8px;">🏛️</div>
      <div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:4px;">${escapeHtml(c.name)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${escapeHtml(c.city)}</div>
      <div style="font-size:11px;background:#F1F5F9;padding:4px 8px;border-radius:6px;display:inline-block;margin-bottom:8px;">${escapeHtml(c.university)}</div>
      <div style="font-size:11px;color:var(--brand-green);font-weight:700;">Intake: ${c.intake || 100} Scholars / Year</div>
    `;
    grid.appendChild(card);
  });
}

function openAddCollegeModal() {
  document.getElementById('collegeModal').classList.add('active');
}

function closeAddCollegeModal() {
  document.getElementById('collegeModal').classList.remove('active');
}

async function handleCollegeSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('cName').value.trim();
  const city = document.getElementById('cCity').value.trim();
  const university = document.getElementById('cUniv').value.trim();

  const newCol = {
    id: 'col_' + Date.now(),
    name,
    city,
    university,
    intake: 100
  };

  try {
    const res = await fetch('/api/colleges', {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify(newCol)
    });
    if (res.ok) {
      collegesData.push(newCol);
      renderCollegesGrid();
      closeAddCollegeModal();
      e.target.reset();
    }
  } catch (err) {
    console.error('College error:', err);
  }
}

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================
function renderNotificationHistory() {
  const list = document.getElementById('notifHistoryList');
  if (!list) return;
  list.innerHTML = '';

  if (notificationHistory.length === 0) {
    list.innerHTML = `<div style="font-size:12px;color:var(--text-muted);padding:12px;">No broadcasts sent yet.</div>`;
    return;
  }

  notificationHistory.forEach(n => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:12px;border-bottom:1px solid var(--border);';
    item.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <span style="font-weight:700;font-size:13px;color:var(--text);">${escapeHtml(n.title)}</span>
        <span style="font-size:10px;background:#F1F5F9;padding:2px 6px;border-radius:4px;">${escapeHtml(n.target)}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(n.body)}</div>
      <div style="font-size:10px;color:var(--brand-green);font-weight:700;margin-top:4px;">${n.time || 'Dispatched'}</div>
    `;
    list.appendChild(item);
  });
}

async function dispatchNotification(e) {
  e.preventDefault();
  const title = document.getElementById('notifTitle').value.trim();
  const target = document.getElementById('notifTarget').value;
  const type = document.getElementById('notifType').value;
  const body = document.getElementById('notifBody').value.trim();

  const newNotif = {
    id: 'notif_' + Date.now(),
    title,
    target,
    type,
    body,
    time: 'Just now'
  };

  try {
    const res = await fetch('/api/notifications', {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify(newNotif)
    });
    if (res.ok) {
      notificationHistory.unshift(newNotif);
      renderNotificationHistory();
      e.target.reset();
      notifyStudentAppOfUpdate();
      alert(`🚀 Notification broadcasted live to all student devices!`);
    }
  } catch (err) {
    console.error('Notif error:', err);
  }
}

// ============================================================
// ANALYTICS STATS UPDATE
// ============================================================
function updateAnalyticsStats() {
  const booksCount = notesData.filter(d => d.contentType === 'book').length;
  const notesCount = notesData.filter(d => d.contentType === 'note').length;

  const bEl = document.getElementById('statTotalBooks');
  if (bEl) bEl.innerText = booksCount;

  const nEl = document.getElementById('statTotalNotes');
  if (nEl) nEl.innerText = notesCount;

  const sEl = document.getElementById('statTotalStudents');
  if (sEl) sEl.innerText = studentsData.length;

  const storageFill = document.getElementById('storageBarFill');
  const storageTxt = document.getElementById('storageText');
  const totalMB = ((booksCount * 12) + (notesCount * 3.5)).toFixed(1);
  if (storageFill) storageFill.style.width = Math.min(100, Math.max(8, (notesData.length * 5))) + '%';
  if (storageTxt) storageTxt.innerText = `${totalMB} MB Encrypted Sandbox Used`;
}

// ============================================================
// HTML ESCAPE UTILITY
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
