import 'package:cloud_firestore/cloud_firestore.dart';

class PdfModel {
  final String id;
  final String title;
  final String authorOrFaculty;
  final String subjectId;
  final String subjectName;
  final String bhmsYear;
  final String category; // 'Handwritten Notes', 'Standard Textbooks', 'University Past Papers (PYQs)', etc.
  final String description;
  final String fileUrl;
  final int fileSizeBytes;
  final int pageCount;
  final DateTime uploadDate;
  final int downloadCount;
  final List<String> tags;
  final bool isFeatured;

  PdfModel({
    required this.id,
    required this.title,
    required this.authorOrFaculty,
    required this.subjectId,
    required this.subjectName,
    required this.bhmsYear,
    required this.category,
    required this.description,
    required this.fileUrl,
    required this.fileSizeBytes,
    required this.pageCount,
    required this.uploadDate,
    this.downloadCount = 0,
    this.tags = const [],
    this.isFeatured = false,
  });

  String get formattedFileSize {
    if (fileSizeBytes <= 0) return 'Unknown size';
    final double mb = fileSizeBytes / (1024 * 1024);
    if (mb >= 1.0) {
      return '${mb.toStringAsFixed(1)} MB';
    } else {
      final double kb = fileSizeBytes / 1024;
      return '${kb.toStringAsFixed(0)} KB';
    }
  }

  Map<String, dynamic> toMap() {
    return {
      'title': title,
      'authorOrFaculty': authorOrFaculty,
      'subjectId': subjectId,
      'subjectName': subjectName,
      'bhmsYear': bhmsYear,
      'category': category,
      'description': description,
      'fileUrl': fileUrl,
      'fileSizeBytes': fileSizeBytes,
      'pageCount': pageCount,
      'uploadDate': Timestamp.fromDate(uploadDate),
      'downloadCount': downloadCount,
      'tags': tags,
      'isFeatured': isFeatured,
    };
  }

  factory PdfModel.fromMap(Map<String, dynamic> map, String docId) {
    return PdfModel(
      id: docId,
      title: map['title'] ?? '',
      authorOrFaculty: map['authorOrFaculty'] ?? 'Homoeopathic Faculty',
      subjectId: map['subjectId'] ?? '',
      subjectName: map['subjectName'] ?? '',
      bhmsYear: map['bhmsYear'] ?? '1st Year',
      category: map['category'] ?? 'Handwritten Notes',
      description: map['description'] ?? '',
      fileUrl: map['fileUrl'] ?? '',
      fileSizeBytes: map['fileSizeBytes'] ?? 0,
      pageCount: map['pageCount'] ?? 0,
      uploadDate: (map['uploadDate'] as Timestamp?)?.toDate() ?? DateTime.now(),
      downloadCount: map['downloadCount'] ?? 0,
      tags: List<String>.from(map['tags'] ?? []),
      isFeatured: map['isFeatured'] ?? false,
    );
  }
}
