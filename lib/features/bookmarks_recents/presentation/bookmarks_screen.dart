import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../data/local_cache_service.dart';
import '../../notes_pdf/domain/pdf_model.dart';
import '../../notes_pdf/presentation/secure_pdf_viewer_screen.dart';

class BookmarksScreen extends StatefulWidget {
  const BookmarksScreen({super.key});

  @override
  State<BookmarksScreen> createState() => _BookmarksScreenState();
}

class _BookmarksScreenState extends State<BookmarksScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final LocalCacheService _cacheService = LocalCacheService();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Study Vault', style: TextStyle(fontWeight: FontWeight.w800)),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AppTheme.primaryTeal,
          labelColor: AppTheme.primaryTeal,
          unselectedLabelColor: isDark ? Colors.grey[400] : Colors.grey[600],
          tabs: const [
            Tab(icon: Icon(Icons.download_done_rounded), text: 'Offline Vault'),
            Tab(icon: Icon(Icons.bookmark_rounded), text: 'Saved Bookmarks'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildOfflineList(isDark),
          _buildBookmarksList(isDark),
        ],
      ),
    );
  }

  Widget _buildOfflineList(bool isDark) {
    return ValueListenableBuilder(
      valueListenable: _cacheService.offlineMetaListenable,
      builder: (context, _, __) {
        final offlinePdfs = _cacheService.getOfflinePdfs();

        if (offlinePdfs.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.cloud_off_rounded, size: 64, color: Colors.grey[400]),
                const SizedBox(height: 16),
                const Text(
                  'No Offline Notes Saved Yet',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                Text(
                  'Download PDFs to study without internet access.',
                  style: TextStyle(color: Colors.grey[500], fontSize: 13),
                ),
              ],
            ),
          );
        }

        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: offlinePdfs.length,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            final pdf = offlinePdfs[index];
            return _buildVaultTile(pdf, isDark, isOfflineTab: true);
          },
        );
      },
    );
  }

  Widget _buildBookmarksList(bool isDark) {
    return ValueListenableBuilder(
      valueListenable: _cacheService.bookmarksListenable,
      builder: (context, _, __) {
        final bookmarks = _cacheService.getBookmarkedPdfs();

        if (bookmarks.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.bookmark_border_rounded, size: 64, color: Colors.grey[400]),
                const SizedBox(height: 16),
                const Text(
                  'No Bookmarked Topics Yet',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                Text(
                  'Tap the bookmark icon on any document to save it here.',
                  style: TextStyle(color: Colors.grey[500], fontSize: 13),
                ),
              ],
            ),
          );
        }

        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: bookmarks.length,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            final pdf = bookmarks[index];
            return _buildVaultTile(pdf, isDark, isOfflineTab: false);
          },
        );
      },
    );
  }

  Widget _buildVaultTile(PdfModel pdf, bool isDark, {required bool isOfflineTab}) {
    return Container(
      decoration: BoxDecoration(
        color: isDark ? AppTheme.surfaceDark : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isDark ? AppTheme.borderDark : AppTheme.borderLight),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: isOfflineTab
                ? Colors.green.withOpacity(0.12)
                : AppTheme.amberGold.withOpacity(0.12),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(
            isOfflineTab ? Icons.lock_outline_rounded : Icons.bookmark_rounded,
            color: isOfflineTab ? Colors.green : AppTheme.amberGold,
          ),
        ),
        title: Text(
          pdf.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text(
              '${pdf.subjectName} • ${pdf.bhmsYear}',
              style: TextStyle(fontSize: 12, color: isDark ? Colors.grey[400] : Colors.grey[600]),
            ),
            const SizedBox(height: 4),
            Text(
              '${pdf.pageCount} pgs • ${pdf.formattedFileSize}',
              style: TextStyle(fontSize: 11, color: isDark ? Colors.grey[500] : Colors.grey[500]),
            ),
          ],
        ),
        trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 14, color: Colors.grey),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => SecurePdfViewerScreen(pdf: pdf),
            ),
          );
        },
      ),
    );
  }
}
