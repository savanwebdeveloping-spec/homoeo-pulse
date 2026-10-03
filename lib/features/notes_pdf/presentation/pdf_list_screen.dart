import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/theme/app_theme.dart';
import '../../subjects/domain/subject_model.dart';
import '../data/pdf_repository.dart';
import '../domain/pdf_model.dart';
import '../../bookmarks_recents/data/local_cache_service.dart';
import 'secure_pdf_viewer_screen.dart';

class PdfListScreen extends ConsumerStatefulWidget {
  final SubjectModel subject;
  const PdfListScreen({super.key, required this.subject});

  @override
  ConsumerState<PdfListScreen> createState() => _PdfListScreenState();
}

class _PdfListScreenState extends ConsumerState<PdfListScreen> {
  String _selectedCategory = 'All Material';
  String _searchQuery = '';
  final Map<String, double> _downloadProgress = {};

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final pdfsAsync = ref.watch(pdfListBySubjectProvider(widget.subject.id));

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.subject.name,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            Text(
              '${widget.subject.code} • ${widget.subject.year}',
              style: TextStyle(fontSize: 12, color: isDark ? Colors.grey[400] : Colors.grey[600]),
            ),
          ],
        ),
      ),
      body: Column(
        children: [
          // Search Field
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search notes, authors or topics...',
                prefixIcon: const Icon(Icons.search, size: 20),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                fillColor: isDark ? AppTheme.surfaceDark : Colors.white,
              ),
              onChanged: (val) {
                setState(() => _searchQuery = val.toLowerCase().trim());
              },
            ),
          ),

          // Category Chips Filter
          SizedBox(
            height: 42,
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              scrollDirection: Axis.horizontal,
              itemCount: AppConstants.pdfCategories.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final category = AppConstants.pdfCategories[index];
                final isSelected = category == _selectedCategory;
                return ChoiceChip(
                  label: Text(category),
                  selected: isSelected,
                  selectedColor: AppTheme.primaryTeal.withOpacity(0.18),
                  backgroundColor: isDark ? AppTheme.surfaceDark : Colors.white,
                  labelStyle: TextStyle(
                    color: isSelected ? AppTheme.primaryTeal : (isDark ? Colors.grey[300] : Colors.grey[700]),
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    fontSize: 12,
                  ),
                  side: BorderSide(
                    color: isSelected ? AppTheme.primaryTeal : (isDark ? AppTheme.borderDark : AppTheme.borderLight),
                  ),
                  onSelected: (selected) {
                    if (selected) setState(() => _selectedCategory = category);
                  },
                );
              },
            ),
          ),
          const SizedBox(height: 12),

          // PDF List
          Expanded(
            child: pdfsAsync.when(
              data: (pdfs) {
                final filtered = pdfs.where((pdf) {
                  final matchesCat = _selectedCategory == 'All Material' || pdf.category == _selectedCategory;
                  final matchesSearch = _searchQuery.isEmpty ||
                      pdf.title.toLowerCase().contains(_searchQuery) ||
                      pdf.authorOrFaculty.toLowerCase().contains(_searchQuery) ||
                      pdf.tags.any((t) => t.toLowerCase().contains(_searchQuery));
                  return matchesCat && matchesSearch;
                }).toList();

                if (filtered.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.menu_book_outlined, size: 56, color: Colors.grey[400]),
                        const SizedBox(height: 12),
                        Text(
                          'No documents found for this filter',
                          style: TextStyle(color: Colors.grey[500], fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  );
                }

                return ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) {
                    final pdf = filtered[index];
                    return _buildPdfCard(context, pdf, isDark);
                  },
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(child: Text('Failed to load notes: $err')),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPdfCard(BuildContext context, PdfModel pdf, bool isDark) {
    final localCache = LocalCacheService();
    final isDownloaded = localCache.isPdfDownloaded(pdf.id);
    final isBookmarked = localCache.isPdfBookmarked(pdf.id);
    final downloadProgress = _downloadProgress[pdf.id];

    return Container(
      decoration: BoxDecoration(
        color: isDark ? AppTheme.surfaceDark : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? AppTheme.borderDark : AppTheme.borderLight,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => SecurePdfViewerScreen(pdf: pdf),
              ),
            );
          },
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // PDF Icon with badge
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.primaryTeal.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Icon(
                        Icons.picture_as_pdf_rounded,
                        color: AppTheme.coralRed,
                        size: 28,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            pdf.title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'By ${pdf.authorOrFaculty}',
                            style: TextStyle(
                              fontSize: 12,
                              color: isDark ? Colors.grey[400] : Colors.grey[600],
                            ),
                          ),
                        ],
                      ),
                    ),
                    // Bookmark action
                    IconButton(
                      icon: Icon(
                        isBookmarked ? Icons.bookmark_rounded : Icons.bookmark_border_rounded,
                        color: isBookmarked ? AppTheme.amberGold : Colors.grey,
                      ),
                      onPressed: () async {
                        await localCache.toggleBookmark(pdf);
                        setState(() {});
                      },
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  pdf.description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    color: isDark ? Colors.grey[300] : Colors.grey[700],
                  ),
                ),
                const SizedBox(height: 12),

                // Meta row: Pages, Size, Offline Status, Download action
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: isDark ? AppTheme.surfaceMutedDark : AppTheme.surfaceMutedLight,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        pdf.category,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.primaryTeal,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${pdf.pageCount} pgs • ${pdf.formattedFileSize}',
                      style: TextStyle(
                        fontSize: 11,
                        color: isDark ? Colors.grey[400] : Colors.grey[500],
                      ),
                    ),
                    const Spacer(),

                    // Download / Offline Status Action
                    if (downloadProgress != null)
                      SizedBox(
                        width: 28,
                        height: 28,
                        child: CircularProgressIndicator(
                          value: downloadProgress,
                          strokeWidth: 2.5,
                          color: AppTheme.primaryTeal,
                        ),
                      )
                    else if (isDownloaded)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.green.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.check_circle_outline, size: 14, color: Colors.green),
                            SizedBox(width: 4),
                            Text(
                              'Offline Ready',
                              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.green),
                            ),
                          ],
                        ),
                      )
                    else
                      IconButton(
                        icon: const Icon(Icons.download_for_offline_outlined, color: AppTheme.primaryTeal),
                        tooltip: 'Download encrypted offline copy',
                        onPressed: () async {
                          setState(() => _downloadProgress[pdf.id] = 0.0);
                          try {
                            await ref.read(pdfRepositoryProvider).downloadAndSecurePdf(
                                  pdf: pdf,
                                  onProgress: (p) {
                                    setState(() => _downloadProgress[pdf.id] = p);
                                  },
                                );
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Downloaded & saved to secure offline vault!')),
                            );
                          } catch (e) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Download failed: $e')),
                            );
                          } finally {
                            setState(() => _downloadProgress.remove(pdf.id));
                          }
                        },
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
