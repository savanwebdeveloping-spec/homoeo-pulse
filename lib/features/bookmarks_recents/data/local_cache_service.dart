import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import '../../../core/constants/app_constants.dart';
import '../domain/reading_progress_model.dart';
import '../../notes_pdf/domain/pdf_model.dart';

class LocalCacheService {
  static final LocalCacheService _instance = LocalCacheService._internal();
  factory LocalCacheService() => _instance;
  LocalCacheService._internal();

  late Box _bookmarksBox;
  late Box _recentsBox;
  late Box _offlineMetaBox;

  Future<void> init() async {
    await Hive.initFlutter();
    _bookmarksBox = await Hive.openBox(AppConstants.hiveBoxBookmarks);
    _recentsBox = await Hive.openBox(AppConstants.hiveBoxRecentReads);
    _offlineMetaBox = await Hive.openBox(AppConstants.hiveBoxOfflinePdfs);
  }

  // --- RECENT READS & RESUME POSITION ---
  Future<void> saveReadingProgress({
    required PdfModel pdf,
    required int currentPage,
    required int totalPages,
  }) async {
    final existingData = _recentsBox.get(pdf.id);
    bool isBookmarked = false;
    if (existingData != null) {
      final existing = ReadingProgressModel.fromMap(Map<String, dynamic>.from(existingData));
      isBookmarked = existing.isBookmarked;
    } else {
      isBookmarked = isPdfBookmarked(pdf.id);
    }

    final progress = ReadingProgressModel(
      pdfId: pdf.id,
      title: pdf.title,
      subjectName: pdf.subjectName,
      bhmsYear: pdf.bhmsYear,
      category: pdf.category,
      lastPage: currentPage,
      totalPages: totalPages,
      lastReadTimestamp: DateTime.now(),
      isBookmarked: isBookmarked,
      isDownloaded: isPdfDownloaded(pdf.id),
    );

    await _recentsBox.put(pdf.id, progress.toMap());
  }

  int getLastReadPage(String pdfId) {
    final data = _recentsBox.get(pdfId);
    if (data == null) return 1;
    final progress = ReadingProgressModel.fromMap(Map<String, dynamic>.from(data));
    return progress.lastPage;
  }

  List<ReadingProgressModel> getRecentReads() {
    final List<ReadingProgressModel> list = [];
    for (final key in _recentsBox.keys) {
      final data = _recentsBox.get(key);
      if (data != null) {
        list.add(ReadingProgressModel.fromMap(Map<String, dynamic>.from(data)));
      }
    }
    list.sort((a, b) => b.lastReadTimestamp.compareTo(a.lastReadTimestamp));
    return list;
  }

  // --- BOOKMARKS ---
  bool isPdfBookmarked(String pdfId) {
    return _bookmarksBox.containsKey(pdfId);
  }

  Future<void> toggleBookmark(PdfModel pdf) async {
    if (isPdfBookmarked(pdf.id)) {
      await _bookmarksBox.delete(pdf.id);
    } else {
      await _bookmarksBox.put(pdf.id, pdf.toMap());
    }
  }

  List<PdfModel> getBookmarkedPdfs() {
    final List<PdfModel> list = [];
    for (final key in _bookmarksBox.keys) {
      final data = _bookmarksBox.get(key);
      if (data != null) {
        list.add(PdfModel.fromMap(Map<String, dynamic>.from(data), key.toString()));
      }
    }
    return list;
  }

  // --- OFFLINE METADATA ---
  bool isPdfDownloaded(String pdfId) {
    return _offlineMetaBox.containsKey(pdfId);
  }

  Future<void> recordPdfDownload(PdfModel pdf) async {
    await _offlineMetaBox.put(pdf.id, pdf.toMap());
  }

  Future<void> removePdfDownload(String pdfId) async {
    await _offlineMetaBox.delete(pdfId);
  }

  List<PdfModel> getOfflinePdfs() {
    final List<PdfModel> list = [];
    for (final key in _offlineMetaBox.keys) {
      final data = _offlineMetaBox.get(key);
      if (data != null) {
        list.add(PdfModel.fromMap(Map<String, dynamic>.from(data), key.toString()));
      }
    }
    return list;
  }

  // ValueNotifier listeners for reactive UI
  ValueListenable<Box> get bookmarksListenable => _bookmarksBox.listenable();
  ValueListenable<Box> get recentsListenable => _recentsBox.listenable();
  ValueListenable<Box> get offlineMetaListenable => _offlineMetaBox.listenable();
}
