import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:encrypt/encrypt.dart' as enc;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:crypto/crypto.dart';
import '../constants/app_constants.dart';

class PdfEncryptionService {
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();
  static const String _keyStorageName = AppConstants.secureStorageKeyAlias;
  
  // Singleton pattern
  static final PdfEncryptionService _instance = PdfEncryptionService._internal();
  factory PdfEncryptionService() => _instance;
  PdfEncryptionService._internal();

  /// Retrieve or generate a 256-bit AES Master Key
  Future<enc.Key> _getMasterKey() async {
    String? storedKey = await _secureStorage.read(key: _keyStorageName);
    if (storedKey == null) {
      final keyBytes = enc.Key.fromSecureRandom(32);
      storedKey = base64Url.encode(keyBytes.bytes);
      await _secureStorage.write(key: _keyStorageName, value: storedKey);
    }
    return enc.Key(base64Url.decode(storedKey));
  }

  /// Get the app sandbox storage directory for offline encrypted materials
  Future<Directory> _getSandboxDirectory() async {
    final appDir = await getApplicationSupportDirectory();
    final encryptedDir = Directory('${appDir.path}/encrypted_vault');
    if (!await encryptedDir.exists()) {
      await encryptedDir.create(recursive: true);
    }
    return encryptedDir;
  }

  /// Hash the PDF ID or URL to a safe filename
  String getSafeEncryptedFileName(String pdfId) {
    final hash = sha256.convert(utf8.encode(pdfId)).toString();
    return '$hash.hpvault';
  }

  /// Check if the PDF is already downloaded and cached locally
  Future<bool> isPdfCached(String pdfId) async {
    final dir = await _getSandboxDirectory();
    final file = File('${dir.path}/${getSafeEncryptedFileName(pdfId)}');
    return await file.exists();
  }

  /// Encrypt and store raw PDF bytes into the secure sandbox
  Future<String> encryptAndSavePdf({
    required String pdfId,
    required Uint8List rawBytes,
  }) async {
    final key = await _getMasterKey();
    // Generate random 16-byte IV for each document
    final iv = enc.IV.fromSecureRandom(16);
    final encrypter = enc.Encrypter(enc.AES(key, mode: enc.AESMode.cbc));

    final encrypted = encrypter.encryptBytes(rawBytes, iv: iv);

    // File structure: [16 bytes IV] + [Ciphertext]
    final payload = BytesBuilder();
    payload.add(iv.bytes);
    payload.add(encrypted.bytes);

    final dir = await _getSandboxDirectory();
    final targetPath = '${dir.path}/${getSafeEncryptedFileName(pdfId)}';
    final targetFile = File(targetPath);
    await targetFile.writeAsBytes(payload.toBytes(), flush: true);

    return targetPath;
  }

  /// Decrypt cached PDF to volatile memory or isolated temp file for in-app viewing
  Future<File> getDecryptedTempPdfFile(String pdfId) async {
    final dir = await _getSandboxDirectory();
    final encryptedFile = File('${dir.path}/${getSafeEncryptedFileName(pdfId)}');

    if (!await encryptedFile.exists()) {
      throw Exception('Encrypted offline file not found for PDF ID: $pdfId');
    }

    final bytes = await encryptedFile.readAsBytes();
    if (bytes.length < 16) {
      throw Exception('Corrupted encrypted file.');
    }

    // Extract IV from first 16 bytes
    final ivBytes = bytes.sublist(0, 16);
    final cipherBytes = bytes.sublist(16);

    final key = await _getMasterKey();
    final iv = enc.IV(ivBytes);
    final encrypter = enc.Encrypter(enc.AES(key, mode: enc.AESMode.cbc));

    final decryptedBytes = encrypter.decryptBytes(enc.Encrypted(cipherBytes), iv: iv);

    // Save to temp cache directory with ephemeral lifecycle
    final tempDir = await getTemporaryDirectory();
    final tempPdf = File('${tempDir.path}/temp_${DateTime.now().millisecondsSinceEpoch}.pdf');
    await tempPdf.writeAsBytes(decryptedBytes, flush: true);

    return tempPdf;
  }

  /// Delete encrypted file from offline cache
  Future<void> deleteCachedPdf(String pdfId) async {
    final dir = await _getSandboxDirectory();
    final file = File('${dir.path}/${getSafeEncryptedFileName(pdfId)}');
    if (await file.exists()) {
      await file.delete();
    }
  }

  /// Get total cache size in bytes
  Future<int> getCachedVaultSizeBytes() async {
    final dir = await _getSandboxDirectory();
    if (!await dir.exists()) return 0;
    int totalSize = 0;
    await for (final file in dir.list(recursive: false, followLinks: false)) {
      if (file is File) {
        totalSize += await file.length();
      }
    }
    return totalSize;
  }
}
