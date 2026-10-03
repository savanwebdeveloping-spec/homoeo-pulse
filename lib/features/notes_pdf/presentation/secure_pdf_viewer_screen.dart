import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_pdfview/flutter_pdfview.dart';
import 'package:screen_protector/screen_protector.dart';
import '../../../core/security/pdf_encryption_service.dart';
import '../../../core/theme/app_theme.dart';
import '../../bookmarks_recents/data/local_cache_service.dart';
import '../domain/pdf_model.dart';
import 'package:dio/dio.dart';
import 'package:path_provider/path_provider.dart';

class SecurePdfViewerScreen extends StatefulWidget {
  final PdfModel pdf;
  const SecurePdfViewerScreen({super.key, required this.pdf});

  @override
  State<SecurePdfViewerScreen> createState() => _SecurePdfViewerScreenState();
}

class _SecurePdfViewerScreenState extends State<SecurePdfViewerScreen> {
  final PdfEncryptionService _encryptionService = PdfEncryptionService();
  final LocalCacheService _cacheService = LocalCacheService();

  PDFViewController? _pdfViewController;
  File? _preparedPdfFile;
  bool _isLoading = true;
  String? _errorMessage;

  int _currentPage = 1;
  int _totalPages = 1;
  bool _isDarkModeInverted = false;
  bool _isBookmarked = false;

  @override
  void initState() {
    super.initState();
    _enableSecurityFlags();
    _isBookmarked = _cacheService.isPdfBookmarked(widget.pdf.id);
    _currentPage = _cacheService.getLastReadPage(widget.pdf.id);
    _loadAndPreparePdf();
  }

  /// Prevent screenshots & screen recording to protect author copyright / anti-piracy
  Future<void> _enableSecurityFlags() async {
    try {
      await ScreenProtector.protectDataLeakageOn();
      await ScreenProtector.preventScreenshotOn();
    } catch (_) {
      // Non-mobile or unsupported platform fallback
    }
  }

  /// Re-enable normal screen capture when leaving the secure viewer
  Future<void> _disableSecurityFlags() async {
    try {
      await ScreenProtector.protectDataLeakageOff();
      await ScreenProtector.preventScreenshotOff();
    } catch (_) {}
  }

  /// Prepare the PDF: if encrypted offline vault copy exists, decrypt to temp file.
  /// Otherwise, download to volatile isolated file.
  Future<void> _loadAndPreparePdf() async {
    setState(() => _isLoading = true);
    try {
      final isOffline = await _encryptionService.isPdfCached(widget.pdf.id);
      if (isOffline) {
        _preparedPdfFile = await _encryptionService.getDecryptedTempPdfFile(widget.pdf.id);
      } else {
        // Stream / download temporary isolated copy
        final tempDir = await getTemporaryDirectory();
        final tempPath = '${tempDir.path}/stream_${widget.pdf.id}.pdf';
        final file = File(tempPath);

        if (!await file.exists()) {
          final dio = Dio();
          await dio.download(widget.pdf.fileUrl, tempPath);
        }
        _preparedPdfFile = file;
      }
    } catch (e) {
      _errorMessage = 'Failed to load document: $e';
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// Persist current reading position to Hive
  void _saveProgress() {
    _cacheService.saveReadingProgress(
      pdf: widget.pdf,
      currentPage: _currentPage,
      totalPages: _totalPages,
    );
  }

  /// Prompt student to jump directly to any page
  void _showJumpToPageDialog() {
    final controller = TextEditingController(text: _currentPage.toString());
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Jump to Page', style: TextStyle(fontWeight: FontWeight.w700)),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.number,
          autofocus: true,
          decoration: InputDecoration(
            labelText: 'Page Number (1 - $_totalPages)',
            border: const OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              final target = int.tryParse(controller.text);
              if (target != null && target >= 1 && target <= _totalPages) {
                _pdfViewController?.setPage(target - 1);
                Navigator.pop(ctx);
              }
            },
            child: const Text('Go'),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _saveProgress();
    _disableSecurityFlags();
    // Clean up temporary decrypted memory file
    if (_preparedPdfFile != null && _preparedPdfFile!.existsSync()) {
      _preparedPdfFile!.delete().catchError((_) => _preparedPdfFile!);
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isThemeDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: _isDarkModeInverted ? Colors.black : (isThemeDark ? AppTheme.bgDark : Colors.white),
      appBar: AppBar(
        title: Text(
          widget.pdf.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
        actions: [
          // Jump to Page
          IconButton(
            icon: const Icon(Icons.pin_outlined),
            tooltip: 'Jump to Page',
            onPressed: _totalPages > 1 ? _showJumpToPageDialog : null,
          ),
          // Dark Mode Reading Invert Filter
          IconButton(
            icon: Icon(_isDarkModeInverted ? Icons.light_mode : Icons.dark_mode_outlined),
            tooltip: 'Toggle Inverted Reading Mode',
            onPressed: () {
              setState(() => _isDarkModeInverted = !_isDarkModeInverted);
            },
          ),
          // Bookmark Toggle
          IconButton(
            icon: Icon(
              _isBookmarked ? Icons.bookmark_rounded : Icons.bookmark_border_rounded,
              color: _isBookmarked ? AppTheme.amberGold : null,
            ),
            tooltip: 'Bookmark Document',
            onPressed: () async {
              await _cacheService.toggleBookmark(widget.pdf);
              setState(() => _isBookmarked = !_isBookmarked);
            },
          ),
        ],
      ),
      body: Stack(
        children: [
          if (_isLoading)
            const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(color: AppTheme.primaryTeal),
                  SizedBox(height: 16),
                  Text('Decrypting and loading document securely...'),
                ],
              ),
            )
          else if (_errorMessage != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.error_outline, size: 48, color: AppTheme.coralRed),
                    const SizedBox(height: 12),
                    Text(_errorMessage!, textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: _loadAndPreparePdf,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            )
          else if (_preparedPdfFile != null)
            // ColorFiltered applies dark mode invert shader for night reading
            ColorFiltered(
              colorFilter: _isDarkModeInverted
                  ? const ColorFilter.matrix([
                      -1.0, 0.0, 0.0, 0.0, 255.0, // Red
                      0.0, -1.0, 0.0, 0.0, 255.0, // Green
                      0.0, 0.0, -1.0, 0.0, 255.0, // Blue
                      0.0, 0.0, 0.0, 1.0, 0.0,    // Alpha
                    ])
                  : const ColorFilter.matrix([
                      1.0, 0.0, 0.0, 0.0, 0.0,
                      0.0, 1.0, 0.0, 0.0, 0.0,
                      0.0, 0.0, 1.0, 0.0, 0.0,
                      0.0, 0.0, 0.0, 1.0, 0.0,
                    ]),
              child: PDFView(
                filePath: _preparedPdfFile!.path,
                enableSwipe: true,
                swipeHorizontal: false,
                autoSpacing: true,
                pageFling: true,
                defaultPage: _currentPage > 0 ? _currentPage - 1 : 0,
                fitPolicy: FitPolicy.BOTH,
                preventLinkNavigation: false,
                onViewCreated: (PDFViewController controller) {
                  _pdfViewController = controller;
                },
                onPageChanged: (int? page, int? total) {
                  if (page != null && total != null) {
                    setState(() {
                      _currentPage = page + 1;
                      _totalPages = total;
                    });
                    _saveProgress();
                  }
                },
                onError: (error) {
                  setState(() => _errorMessage = error.toString());
                },
              ),
            ),

          // Bottom Floating Page Indicator Pill
          if (!_isLoading && _errorMessage == null)
            Positioned(
              bottom: 24,
              left: 0,
              right: 0,
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.75),
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.3),
                        blurRadius: 8,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: Text(
                    'Page $_currentPage of $_totalPages',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
