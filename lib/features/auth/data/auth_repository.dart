import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../domain/user_model.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    auth: FirebaseAuth.instance,
    firestore: FirebaseFirestore.instance,
    googleSignIn: GoogleSignIn(),
  );
});

final authStateProvider = StreamProvider<User?>((ref) {
  return ref.watch(authRepositoryProvider).authStateChanges;
});

final currentUserProfileProvider = StreamProvider<UserModel?>((ref) {
  final authState = ref.watch(authStateProvider).value;
  if (authState == null) {
    return Stream.value(null);
  }
  return ref.watch(authRepositoryProvider).getUserProfileStream(authState.uid);
});

class AuthRepository {
  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;
  final GoogleSignIn _googleSignIn;

  AuthRepository({
    required FirebaseAuth auth,
    required FirebaseFirestore firestore,
    required GoogleSignIn googleSignIn,
  })  : _auth = auth,
        _firestore = firestore,
        _googleSignIn = googleSignIn;

  Stream<User?> get authStateChanges => _auth.authStateChanges();

  User? get currentUser => _auth.currentUser;

  Stream<UserModel?> getUserProfileStream(String uid) {
    return _firestore.collection('users').doc(uid).snapshots().map((doc) {
      if (!doc.exists || doc.data() == null) return null;
      return UserModel.fromMap(doc.data()!, doc.id);
    });
  }

  Future<UserModel?> getUserProfile(String uid) async {
    final doc = await _firestore.collection('users').doc(uid).get();
    if (!doc.exists || doc.data() == null) return null;
    return UserModel.fromMap(doc.data()!, doc.id);
  }

  /// Sign In with Email and Password
  Future<UserCredential> signInWithEmailPassword({
    required String email,
    required String password,
  }) async {
    try {
      final credential = await _auth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      // Update last active
      if (credential.user != null) {
        await _firestore.collection('users').doc(credential.user!.uid).update({
          'lastActive': FieldValue.serverTimestamp(),
        });
      }
      return credential;
    } catch (e) {
      rethrow;
    }
  }

  /// Sign Up with Email and Password
  Future<UserCredential> signUpWithEmailPassword({
    required String email,
    required String password,
    required String displayName,
    required String bhmsYear,
    required String collegeName,
  }) async {
    try {
      final credential = await _auth.createUserWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );

      final user = credential.user;
      if (user != null) {
        await user.updateDisplayName(displayName);

        final userModel = UserModel(
          uid: user.uid,
          email: user.email ?? email,
          displayName: displayName,
          bhmsYear: bhmsYear,
          collegeName: collegeName,
          photoUrl: user.photoURL,
          role: 'student',
          createdAt: DateTime.now(),
          lastActive: DateTime.now(),
        );

        await _firestore.collection('users').doc(user.uid).set(userModel.toMap());
      }
      return credential;
    } catch (e) {
      rethrow;
    }
  }

  /// Google Sign-In
  Future<UserCredential> signInWithGoogle() async {
    try {
      final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
      if (googleUser == null) {
        throw Exception('Google Sign In was cancelled by student.');
      }

      final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
      final AuthCredential credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      final userCredential = await _auth.signInWithCredential(credential);
      final user = userCredential.user;

      if (user != null) {
        final doc = await _firestore.collection('users').doc(user.uid).get();
        if (!doc.exists) {
          // Initial profile record with default 1st Year (user can update on onboarding)
          final userModel = UserModel(
            uid: user.uid,
            email: user.email ?? '',
            displayName: user.displayName ?? 'BHMS Student',
            bhmsYear: '1st Year',
            collegeName: 'Homoeopathic Medical College',
            photoUrl: user.photoURL,
            role: 'student',
            createdAt: DateTime.now(),
            lastActive: DateTime.now(),
          );
          await _firestore.collection('users').doc(user.uid).set(userModel.toMap());
        } else {
          await _firestore.collection('users').doc(user.uid).update({
            'lastActive': FieldValue.serverTimestamp(),
          });
        }
      }

      return userCredential;
    } catch (e) {
      rethrow;
    }
  }

  /// Update Profile (Year, College, Name)
  Future<void> updateUserProfile({
    required String uid,
    required String displayName,
    required String bhmsYear,
    required String collegeName,
  }) async {
    await _firestore.collection('users').doc(uid).update({
      'displayName': displayName,
      'bhmsYear': bhmsYear,
      'collegeName': collegeName,
      'lastActive': FieldValue.serverTimestamp(),
    });
  }

  /// Sign Out
  Future<void> signOut() async {
    await Future.wait([
      _auth.signOut(),
      _googleSignIn.signOut(),
    ]);
  }
}
