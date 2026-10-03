# 🌿 Homoeo Pulse — Academic & Clinical PDF Companion for BHMS Students

A production-grade mobile application built specifically for Bachelor of Homeopathic Medicine and Surgery (BHMS) medical students. Provides year-wise academic PDF notes, standard textbooks, solved university question papers (PYQs), and study materials with secure offline reading support and anti-piracy protections.

---

## 📱 Tech Stack

- **Mobile Framework**: Flutter 3.x (Dart 3)
- **Architecture**: Feature-First Clean Architecture
- **State Management & DI**: Riverpod (`flutter_riverpod`)
- **Backend & Cloud**: Google Firebase (Firebase Authentication, Cloud Firestore, Firebase Storage, Cloud Messaging)
- **Local Cache & Offline Storage**: Hive Flutter + Flutter Secure Storage
- **Cryptographic Engine**: AES-256 (CBC mode) sandbox encryption for anti-piracy PDF caching
- **PDF Engine & DRM**: `flutter_pdfview` + `screen_protector` (`FLAG_SECURE` screenshot prevention)
- **Web Admin CMS**: Standalone Vanilla HTML5/CSS3/JS Web Portal

---

## 🗂️ Project Directory Structure

```
Homie pulse/
├── admin_cms/
│   └── index.html                         # Full-featured Web Admin CMS Dashboard
├── firestore.rules                        # Role-based Cloud Firestore Security Rules
├── storage.rules                          # Cloud Storage Anti-Tamper & Size Rules
├── DATABASE_SCHEMA.md                     # Database schema, indices & DRM architecture
├── pubspec.yaml                           # Flutter dependencies & metadata
└── lib/
    ├── main.dart                          # App entry point, Riverpod provider & router
    ├── core/
    │   ├── constants/
    │   │   └── app_constants.dart         # Complete BHMS curriculum by year & categories
    │   ├── theme/
    │   │   └── app_theme.dart             # Medical teal & navy design system (Light/Dark)
    │   └── security/
    │       └── pdf_encryption_service.dart # AES-256 file encryption & vault decrypter
    └── features/
        ├── auth/
        │   ├── data/
        │   │   └── auth_repository.dart   # Email/password & Google Sign-In with Firestore
        │   ├── domain/
        │   │   └── user_model.dart        # BHMS user model (Year, College, Role)
        │   └── presentation/
        │       ├── auth_screen.dart       # Login & Registration with Year/College selector
        │       └── profile_screen.dart    # Student profile, year switcher & vault stats
        ├── dashboard/
        │   └── presentation/
        │       ├── main_scaffold_screen.dart # Persistent bottom navigation
        │       └── dashboard_screen.dart     # Year tabs, Resume Read banner, Subject grid
        ├── subjects/
        │   ├── data/
        │   │   └── subject_repository.dart   # Year-based Firestore stream & curriculum seed
        │   └── domain/
        │       └── subject_model.dart        # Subject data entity with course codes
        ├── notes_pdf/
        │   ├── data/
        │   │   └── pdf_repository.dart       # PDF streaming, Dio background downloader
        │   ├── domain/
        │   │   └── pdf_model.dart            # Document metadata (pages, size, category)
        │   └── presentation/
        │       ├── pdf_list_screen.dart      # Category tabs, live search, download actions
        │       └── secure_pdf_viewer_screen.dart # DRM viewer, dark mode, jump to page
        ├── bookmarks_recents/
        │   ├── data/
        │   │   └── local_cache_service.dart  # Hive box wrapper for recents & bookmarks
        │   ├── domain/
        │   │   └── reading_progress_model.dart # Last page read & progress calculation
        │   └── presentation/
        │       └── bookmarks_screen.dart     # Offline Vault & Saved Bookmarks list
        └── notifications/
            └── notification_service.dart     # FCM topics for university exam & notes alerts
```

---

## 🚀 Key Features Implemented

### 1. Medical-Grade UI/UX
- Tailored color palette using Deep Medical Teal (`#0F766E`), Mint Accent (`#2DD4BF`), and Dark Navy (`#090D16`).
- Dark mode inversion reading filter to prevent eye fatigue during late-night clinical study.
- Complete canonical BHMS syllabus for **1st, 2nd, 3rd, 4th Year, and Internship**.

### 2. Anti-Piracy In-App Secure Viewer
- **Screenshot & Screen Recording Blocker**: Prevents students from capturing screens via OS `FLAG_SECURE`.
- **Encrypted Local Vault**: Offline downloads are encrypted with AES-256 on the device sandbox (`.hpvault`). Even if device is rooted, raw PDF files cannot be extracted.
- **On-the-fly In-Memory Decryption**: Only loaded in volatile memory when viewing.
- **Jump to Page Dialog** and **Pinch-to-Zoom**.

### 3. Study Continuity & Offline Access
- **Resume Where Left Off**: Automatically tracks last page read and displays a progress card on the dashboard.
- **One-Tap Bookmarks**: Save essential remedy keynotes, organon aphorisms, or surgery chapters.
- **Offline Vault**: Filter downloaded documents and study anywhere without internet.

### 4. Admin CMS Web Portal
- Located in `admin_cms/index.html`.
- Allows faculty and admins to upload PDFs, assign BHMS Year, select dynamic curriculum subjects, and tag categories (PYQs, Notes, Textbooks).

---

## 🛠️ How to Run the Project

### Running the Mobile App:
```bash
# 1. Install dependencies
flutter pub get

# 2. Run code generation (if needed)
dart run build_runner build

# 3. Launch the app on Android / iOS emulator or physical device
flutter run
```

### Running the Web Admin CMS:
Simply open `admin_cms/index.html` in any web browser or serve it using any HTTP server:
```bash
npx serve admin_cms
```
