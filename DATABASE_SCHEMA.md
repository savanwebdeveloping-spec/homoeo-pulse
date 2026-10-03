# 🏥 Homoeo Pulse — Database Schema & Architecture Specification

## 1. Cloud Firestore Architecture

Homoeo Pulse is designed with a high-read-throughput, low-latency document architecture specifically indexed for academic year filtering and full-text keyword searches.

```
firestore-root
│
├── users/{userId}                          (Student & Faculty Profiles)
├── subjects/{subjectId}                    (Curriculum Subject Catalog)
├── pdfs/{pdfId}                            (Academic PDFs, Books, PYQs)
└── categories/{categoryId}                 (Tagging & Taxonomy)
```

---

### Collection: `users`
Document ID: `userId` (Matches Firebase Auth `uid`)

| Field Name | Type | Description | Indexing |
| :--- | :--- | :--- | :--- |
| `uid` | String | Unique user ID from Firebase Auth | Primary Key |
| `email` | String | Student email address | Indexed |
| `displayName` | String | Student full name (e.g., Dr. A. Sharma) | |
| `bhmsYear` | String | `1st Year`, `2nd Year`, `3rd Year`, `4th Year`, `Internship` | Indexed |
| `collegeName` | String | Enrolled Homoeopathic Medical College | |
| `photoUrl` | String? | Profile image URL (Firebase Storage) | |
| `role` | String | `student` or `admin` | Indexed |
| `createdAt` | Timestamp | Account creation timestamp | |
| `lastActive` | Timestamp | Heartbeat of last session | Indexed |

---

### Collection: `subjects`
Document ID: `subjectId` (e.g. `anat_1`, `phys_1`, `org_1`, `rep_4`)

| Field Name | Type | Description | Indexing |
| :--- | :--- | :--- | :--- |
| `id` | String | Canonical subject identifier | Primary Key |
| `name` | String | Subject title (e.g., Organon of Medicine) | |
| `code` | String | University course code (e.g., ORG-104) | |
| `year` | String | `1st Year`, `2nd Year`, `3rd Year`, `4th Year`, `Internship` | Compound Index |
| `description`| String | Syllabus scope and high-yield coverage | |
| `icon` | String | Material icon name | |
| `pdfCount` | Integer | Total active documents under this subject | |
| `sortOrder` | Integer | Official curriculum order | ASC Sorted |

---

### Collection: `pdfs`
Document ID: `pdfId` (Auto-generated UUID or Firestore ID)

| Field Name | Type | Description | Indexing |
| :--- | :--- | :--- | :--- |
| `id` | String | Unique Document ID | Primary Key |
| `title` | String | Document Title | Compound Index |
| `authorOrFaculty` | String | Author / Faculty Member / University Board | Indexed |
| `subjectId` | String | Foreign Key referencing `subjects/{subjectId}` | Compound Index |
| `subjectName` | String | Denormalized subject title for fast queries | |
| `bhmsYear` | String | Academic Year (`1st Year`, etc.) | Compound Index |
| `category` | String | `Handwritten Notes`, `Standard Textbooks`, `University Past Papers (PYQs)`, `Important Rubrics & Charts`, `Mnemonics & Quick Revision` | Compound Index |
| `description` | String | Chapter summary, question trends, syllabus tags | |
| `fileUrl` | String | Secure Firebase Storage download URL | |
| `fileSizeBytes`| Integer | Raw size in bytes | |
| `pageCount` | Integer | Total page count | |
| `uploadDate` | Timestamp | Publication timestamp | DESC Sorted |
| `downloadCount`| Integer | Counter of student offline downloads | DESC Sorted |
| `tags` | Array<String> | Search keywords (e.g. `["Lachesis", "Miasms", "PYQ"]`) | Array-Contains |
| `isFeatured` | Boolean | Highlighted on dashboard carousel | |

---

## 2. Firestore Composite Indexes Required

Add the following to `firestore.indexes.json` or create via Firebase Console:

1. **Year & Subject Query**:
   - Collection: `pdfs`
   - Fields: `bhmsYear` ASC, `subjectId` ASC, `uploadDate` DESC
2. **Category & Year Query**:
   - Collection: `pdfs`
   - Fields: `bhmsYear` ASC, `category` ASC, `uploadDate` DESC
3. **Download Leaderboard Query**:
   - Collection: `pdfs`
   - Fields: `subjectId` ASC, `downloadCount` DESC

---

## 3. Local Offline Storage & Anti-Piracy Architecture (Hive + AES-256)

To prevent piracy, files are **never** stored as open `.pdf` files in the device's public `Downloads` directory.

### Encryption Pipeline:
1. **Key Generation**: A 256-bit AES master cryptographic key is generated and stored in the hardware-backed keystore via `flutter_secure_storage`.
2. **In-Flight Encryption**: When a student taps *Download for Offline View*, raw PDF chunks received via `Dio` are encrypted in memory using AES-256-CBC with PKCS7 padding and a random 16-byte IV.
3. **Sandbox Persistence**: Stored at:
   `app_flutter/encrypted_vault/{sha256(pdfId)}.hpvault`
4. **On-The-Fly Decryption**: The in-app viewer (`SecurePdfViewerScreen`) decrypts the bytes into volatile memory or an ephemeral file destroyed immediately on screen exit (`dispose()`).
5. **Anti-Leakage**: `FLAG_SECURE` / `ScreenProtector.preventScreenshotOn()` prevents screenshots, screen recording, and task-switcher previews.

### Local Hive Boxes:
- `homoeo_pulse_bookmarks`: Map of `pdfId -> PdfModel`
- `homoeo_pulse_recents`: Map of `pdfId -> ReadingProgressModel` (last page read, percentage, timestamp)
- `homoeo_pulse_offline_meta`: Map of `pdfId -> PdfModel`
