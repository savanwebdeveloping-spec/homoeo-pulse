import 'package:cloud_firestore/cloud_firestore.dart';

class UserModel {
  final String uid;
  final String email;
  final String displayName;
  final String bhmsYear; // '1st Year', '2nd Year', '3rd Year', '4th Year', 'Internship'
  final String collegeName;
  final String? photoUrl;
  final String role; // 'student' or 'admin'
  final DateTime createdAt;
  final DateTime lastActive;

  UserModel({
    required this.uid,
    required this.email,
    required this.displayName,
    required this.bhmsYear,
    required this.collegeName,
    this.photoUrl,
    this.role = 'student',
    required this.createdAt,
    required this.lastActive,
  });

  bool get isAdmin => role == 'admin';

  Map<String, dynamic> toMap() {
    return {
      'uid': uid,
      'email': email,
      'displayName': displayName,
      'bhmsYear': bhmsYear,
      'collegeName': collegeName,
      'photoUrl': photoUrl,
      'role': role,
      'createdAt': Timestamp.fromDate(createdAt),
      'lastActive': Timestamp.fromDate(lastActive),
    };
  }

  factory UserModel.fromMap(Map<String, dynamic> map, String docId) {
    return UserModel(
      uid: docId,
      email: map['email'] ?? '',
      displayName: map['displayName'] ?? 'BHMS Student',
      bhmsYear: map['bhmsYear'] ?? '1st Year',
      collegeName: map['collegeName'] ?? 'Homoeopathic Medical College',
      photoUrl: map['photoUrl'],
      role: map['role'] ?? 'student',
      createdAt: (map['createdAt'] as Timestamp?)?.toDate() ?? DateTime.now(),
      lastActive: (map['lastActive'] as Timestamp?)?.toDate() ?? DateTime.now(),
    );
  }

  UserModel copyWith({
    String? displayName,
    String? bhmsYear,
    String? collegeName,
    String? photoUrl,
    String? role,
    DateTime? lastActive,
  }) {
    return UserModel(
      uid: uid,
      email: email,
      displayName: displayName ?? this.displayName,
      bhmsYear: bhmsYear ?? this.bhmsYear,
      collegeName: collegeName ?? this.collegeName,
      photoUrl: photoUrl ?? this.photoUrl,
      role: role ?? this.role,
      createdAt: createdAt,
      lastActive: lastActive ?? this.lastActive,
    );
  }
}
