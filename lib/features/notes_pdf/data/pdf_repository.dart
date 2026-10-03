import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../domain/pdf_model.dart';
import '../../bookmarks_recents/data/local_cache_service.dart';
import '../../../core/security/pdf_encryption_service.dart';

final pdfRepositoryProvider = Provider<PdfRepository>((ref) {
  return PdfRepository(
    firestore: FirebaseFirestore.instance,
    encryptionService: PdfEncryptionService(),
    cacheService: LocalCacheService(),
  );
});

final pdfListBySubjectProvider = StreamProvider.family<List<PdfModel>, String>((ref, subjectId) {
  return ref.watch(pdfRepositoryProvider).getPdfsForSubject(subjectId);
});

final searchPdfQueryProvider = StateProvider<String>((ref) => '');
final selectedCategoryFilterProvider = StateProvider<String>((ref) => 'All Material');

class PdfRepository {
  final FirebaseFirestore _firestore;
  final PdfEncryptionService _encryptionService;
  final LocalCacheService _cacheService;
  final Dio _dio = Dio();

  PdfRepository({
    required FirebaseFirestore firestore,
    required PdfEncryptionService encryptionService,
    required LocalCacheService cacheService,
  })  : _firestore = firestore,
        _encryptionService = encryptionService,
        _cacheService = cacheService;

  /// Stream of PDFs for a particular Subject
  Stream<List<PdfModel>> getPdfsForSubject(String subjectId) {
    return _firestore
        .collection('pdfs')
        .where('subjectId', isEqualTo: subjectId)
        .snapshots()
        .map((snapshot) {
      if (snapshot.docs.isEmpty) {
        // Return dummy sample documents for immediate preview/development
        return _generateSamplePdfs(subjectId);
      }
      return snapshot.docs.map((doc) => PdfModel.fromMap(doc.data(), doc.id)).toList();
    });
  }

  /// Global Search across subjects, topics, and authors
  Future<List<PdfModel>> searchPdfs({
    required String query,
    String? year,
    String? category,
  }) async {
    Query q = _firestore.collection('pdfs');
    if (year != null && year.isNotEmpty) {
      q = q.where('bhmsYear', isEqualTo: year);
    }
    if (category != null && category != 'All Material') {
      q = q.where('category', isEqualTo: category);
    }

    final snapshot = await q.get();
    final lowerQuery = query.toLowerCase().trim();

    return snapshot.docs
        .map((doc) => PdfModel.fromMap(doc.data() as Map<String, dynamic>, doc.id))
        .where((pdf) {
      if (lowerQuery.isEmpty) return true;
      return pdf.title.toLowerCase().contains(lowerQuery) ||
          pdf.authorOrFaculty.toLowerCase().contains(lowerQuery) ||
          pdf.subjectName.toLowerCase().contains(lowerQuery) ||
          pdf.tags.any((tag) => tag.toLowerCase().contains(lowerQuery));
    }).toList();
  }

  /// Download and Encrypt PDF locally for secure offline consumption
  Future<void> downloadAndSecurePdf({
    required PdfModel pdf,
    required Function(double progress) onProgress,
  }) async {
    try {
      final response = await _dio.get<List<int>>(
        pdf.fileUrl,
        options: Options(responseType: ResponseType.bytes),
        onReceiveProgress: (received, total) {
          if (total != -1) {
            onProgress(received / total);
          }
        },
      );

      if (response.data == null) {
        throw Exception('Failed to download PDF bytes');
      }

      // Encrypt and persist to sandbox
      await _encryptionService.encryptAndSavePdf(
        pdfId: pdf.id,
        rawBytes: Uint8List.fromList(response.data!),
      );

      // Record offline metadata in Hive
      await _cacheService.recordPdfDownload(pdf);

      // Increment remote counter in Firestore
      _firestore.collection('pdfs').doc(pdf.id).update({
        'downloadCount': FieldValue.increment(1),
      }).catchError((_) {});
    } catch (e) {
      rethrow;
    }
  }

  /// Helper to generate sample BHMS PDFs if Firestore is fresh
  List<PdfModel> _generateSamplePdfs(String subjectId) {
    return [
      PdfModel(
        id: '${subjectId}_sample_1',
        title: 'High-Yield Clinical Notes & Exam Mnemonics',
        authorOrFaculty: 'Dr. S. K. Banerjee (MD Hom.)',
        subjectId: subjectId,
        subjectName: 'Academic Notes',
        bhmsYear: '1st Year',
        category: 'Handwritten Notes',
        description: 'Comprehensive handwritten summary covering high-frequency university questions with diagrams.',
        fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        fileSizeBytes: 4200000,
        pageCount: 48,
        uploadDate: DateTime.now().subtract(const Duration(days: 4)),
        downloadCount: 312,
        tags: ['High Yield', 'Mnemonics', 'Exam Prep'],
        isFeatured: true,
      ),
      PdfModel(
        id: '${subjectId}_sample_2',
        title: 'Last 10 Years Solved University Question Papers',
        authorOrFaculty: 'AYUSH Central Examination Board',
        subjectId: subjectId,
        subjectName: 'Question Bank',
        bhmsYear: '1st Year',
        category: 'University Past Papers (PYQs)',
        description: 'Year-wise solved papers with standard mark-scheme answers and rubric keys.',
        fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        fileSizeBytes: 8900000,
        pageCount: 112,
        uploadDate: DateTime.now().subtract(const Duration(days: 12)),
        downloadCount: 780,
        tags: ['PYQs', 'MUHS', 'WBUHS', 'RGUHS'],
        isFeatured: false,
      ),
      PdfModel(
        id: '${subjectId}_sample_3',
        title: 'Master Reference & Quick Revision Flowcharts',
        authorOrFaculty: 'Prof. J. T. Kent & Editorial Team',
        subjectId: subjectId,
        subjectName: 'Reference Flowcharts',
        bhmsYear: '1st Year',
        category: 'Important Rubrics & Charts',
        description: 'Visual flowcharts, differential diagnostic matrices, and key remedy tables.',
        fileUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        fileSizeBytes: 3100000,
        pageCount: 34,
        uploadDate: DateTime.now().subtract(const Duration(days: 2)),
        downloadCount: 520,
        tags: ['Charts', 'Revision', 'Flowcharts'],
        isFeatured: true,
      ),
    ];
  }
}
