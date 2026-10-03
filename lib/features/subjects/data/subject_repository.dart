import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/constants/app_constants.dart';
import '../domain/subject_model.dart';

final selectedYearProvider = StateProvider<String>((ref) => '1st Year');
final selectedYearSubpartProvider = StateProvider<String>((ref) => 'books'); // 'books' or 'notes'

final subjectRepositoryProvider = Provider<SubjectRepository>((ref) {
  return SubjectRepository(firestore: FirebaseFirestore.instance);
});

final subjectsByYearProvider = StreamProvider.family<List<SubjectModel>, String>((ref, year) {
  return ref.watch(subjectRepositoryProvider).getSubjectsForYear(year);
});

class SubjectRepository {
  final FirebaseFirestore _firestore;

  SubjectRepository({required FirebaseFirestore firestore}) : _firestore = firestore;

  /// Get live stream of subjects for a given BHMS year
  Stream<List<SubjectModel>> getSubjectsForYear(String year) {
    return _firestore
        .collection('subjects')
        .where('year', isEqualTo: year)
        .snapshots()
        .map((snapshot) {
      if (snapshot.docs.isEmpty) {
        // Fallback to built-in curriculum seed if remote collection is empty
        final localSubjects = AppConstants.yearWiseSubjects[year] ?? [];
        return localSubjects.asMap().entries.map((e) {
          final s = e.value;
          return SubjectModel(
            id: s['id']!,
            name: s['name']!,
            code: s['code']!,
            year: year,
            description: s['description']!,
            icon: s['icon']!,
            pdfCount: 12 + e.key * 3, // realistic sample counts
            sortOrder: e.key,
          );
        }).toList();
      }

      final subjects = snapshot.docs.map((doc) => SubjectModel.fromMap(doc.data(), doc.id)).toList();
      subjects.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      return subjects;
    });
  }

  /// Seed initial canonical BHMS curriculum subjects to Firestore
  Future<void> seedDefaultCurriculum() async {
    final batch = _firestore.batch();
    for (final entry in AppConstants.yearWiseSubjects.entries) {
      final year = entry.key;
      final subjects = entry.value;
      for (int i = 0; i < subjects.length; i++) {
        final sub = subjects[i];
        final docRef = _firestore.collection('subjects').doc(sub['id']);
        batch.set(docRef, {
          'name': sub['name'],
          'code': sub['code'],
          'year': year,
          'description': sub['description'],
          'icon': sub['icon'],
          'pdfCount': 0,
          'sortOrder': i,
        }, SetOptions(merge: true));
      }
    }
    await batch.commit();
  }
}
