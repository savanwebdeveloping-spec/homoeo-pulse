class ReadingProgressModel {
  final String pdfId;
  final String title;
  final String subjectName;
  final String bhmsYear;
  final String category;
  final int lastPage;
  final int totalPages;
  final DateTime lastReadTimestamp;
  final bool isBookmarked;
  final bool isDownloaded;

  ReadingProgressModel({
    required this.pdfId,
    required this.title,
    required this.subjectName,
    required this.bhmsYear,
    required this.category,
    required this.lastPage,
    required this.totalPages,
    required this.lastReadTimestamp,
    this.isBookmarked = false,
    this.isDownloaded = false,
  });

  double get progressPercentage {
    if (totalPages <= 0) return 0.0;
    return (lastPage / totalPages).clamp(0.0, 1.0);
  }

  Map<String, dynamic> toMap() {
    return {
      'pdfId': pdfId,
      'title': title,
      'subjectName': subjectName,
      'bhmsYear': bhmsYear,
      'category': category,
      'lastPage': lastPage,
      'totalPages': totalPages,
      'lastReadTimestamp': lastReadTimestamp.toIso8601String(),
      'isBookmarked': isBookmarked,
      'isDownloaded': isDownloaded,
    };
  }

  factory ReadingProgressModel.fromMap(Map<String, dynamic> map) {
    return ReadingProgressModel(
      pdfId: map['pdfId'] ?? '',
      title: map['title'] ?? '',
      subjectName: map['subjectName'] ?? '',
      bhmsYear: map['bhmsYear'] ?? '',
      category: map['category'] ?? '',
      lastPage: map['lastPage'] ?? 1,
      totalPages: map['totalPages'] ?? 1,
      lastReadTimestamp: map['lastReadTimestamp'] != null 
          ? DateTime.parse(map['lastReadTimestamp']) 
          : DateTime.now(),
      isBookmarked: map['isBookmarked'] ?? false,
      isDownloaded: map['isDownloaded'] ?? false,
    );
  }

  ReadingProgressModel copyWith({
    int? lastPage,
    int? totalPages,
    DateTime? lastReadTimestamp,
    bool? isBookmarked,
    bool? isDownloaded,
  }) {
    return ReadingProgressModel(
      pdfId: pdfId,
      title: title,
      subjectName: subjectName,
      bhmsYear: bhmsYear,
      category: category,
      lastPage: lastPage ?? this.lastPage,
      totalPages: totalPages ?? this.totalPages,
      lastReadTimestamp: lastReadTimestamp ?? this.lastReadTimestamp,
      isBookmarked: isBookmarked ?? this.isBookmarked,
      isDownloaded: isDownloaded ?? this.isDownloaded,
    );
  }
}
