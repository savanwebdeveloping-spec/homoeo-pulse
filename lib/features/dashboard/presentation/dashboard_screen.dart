import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:percent_indicator/linear_percent_indicator.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/theme/app_theme.dart';
import '../../auth/data/auth_repository.dart';
import '../../subjects/data/subject_repository.dart';
import '../../subjects/domain/subject_model.dart';
import '../../bookmarks_recents/data/local_cache_service.dart';
import '../../bookmarks_recents/domain/reading_progress_model.dart';
import '../../notes_pdf/presentation/pdf_list_screen.dart';
import '../../notes_pdf/presentation/secure_pdf_viewer_screen.dart';
import '../../notes_pdf/domain/pdf_model.dart';

class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  final TextEditingController _searchController = TextEditingController();

  IconData _getSubjectIcon(String iconName) {
    switch (iconName) {
      case 'accessibility_new':
        return Icons.accessibility_new_rounded;
      case 'favorite':
        return Icons.favorite_rounded;
      case 'local_pharmacy':
        return Icons.local_pharmacy_rounded;
      case 'menu_book':
        return Icons.menu_book_rounded;
      case 'spa':
        return Icons.spa_rounded;
      case 'biotech':
        return Icons.biotech_rounded;
      case 'gavel':
        return Icons.gavel_rounded;
      case 'healing':
        return Icons.healing_rounded;
      case 'pregnant_woman':
        return Icons.pregnant_woman_rounded;
      case 'medical_services':
        return Icons.medical_services_rounded;
      case 'find_in_page':
        return Icons.find_in_page_rounded;
      case 'public':
        return Icons.public_rounded;
      case 'fact_check':
        return Icons.fact_check_rounded;
      case 'school':
        return Icons.school_rounded;
      default:
        return Icons.import_contacts_rounded;
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final userProfile = ref.watch(currentUserProfileProvider).value;
    final selectedYear = ref.watch(selectedYearProvider);
    final selectedSubpart = ref.watch(selectedYearSubpartProvider); // 'books' or 'notes'
    final subjectsAsync = ref.watch(subjectsByYearProvider(selectedYear));

    // Get recent read from Hive
    final recents = LocalCacheService().getRecentReads();
    final ReadingProgressModel? lastRead = recents.isNotEmpty ? recents.first : null;

    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            // Top App Bar & Profile Header
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 10),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                'Homoeo Pulse',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                  color: AppTheme.primaryTeal,
                                  letterSpacing: 0.5,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppTheme.amberGold.withOpacity(0.18),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: const Text(
                                  'AYUSH / NCH',
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                    color: AppTheme.amberGold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            userProfile != null ? 'Dr. ${userProfile.displayName}' : 'Welcome, Scholar',
                            style: const TextStyle(
                              fontSize: 22,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -0.3,
                            ),
                          ),
                          Text(
                            userProfile?.collegeName ?? 'Homoeopathic Medical College',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12,
                              color: isDark ? Colors.grey[400] : Colors.grey[600],
                            ),
                          ),
                        ],
                      ),
                    ),
                    // Profile Avatar
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: AppTheme.primaryTeal.withOpacity(0.15),
                      child: Text(
                        (userProfile?.displayName.isNotEmpty ?? false)
                            ? userProfile!.displayName[0].toUpperCase()
                            : 'H',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: AppTheme.primaryTeal,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Search Bar
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Search remedies, organon aphorisms, PYQs...',
                    prefixIcon: const Icon(Icons.search_rounded, color: AppTheme.primaryTeal),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear),
                            onPressed: () => setState(() => _searchController.clear()),
                          )
                        : const Icon(Icons.tune_rounded, size: 20),
                    fillColor: isDark ? AppTheme.surfaceDark : Colors.white,
                  ),
                  onSubmitted: (query) {
                    // Navigate to search
                  },
                ),
              ),
            ),

            // Continue Reading Banner (if student was reading)
            if (lastRead != null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: isDark
                            ? [const Color(0xFF134E4A), const Color(0xFF0F766E)]
                            : [AppTheme.primaryTeal, AppTheme.primaryTealDark],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.primaryTeal.withOpacity(0.25),
                          blurRadius: 16,
                          offset: const Offset(0, 6),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Row(
                                children: [
                                  Icon(Icons.history_rounded, size: 14, color: Colors.white),
                                  SizedBox(width: 4),
                                  Text(
                                    'RESUME STUDY',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 10,
                                      fontWeight: FontWeight.w700,
                                      letterSpacing: 0.8,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              'Page ${lastRead.lastPage} of ${lastRead.totalPages}',
                              style: const TextStyle(color: Colors.white70, fontSize: 12),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Text(
                          lastRead.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${lastRead.subjectName} • ${lastRead.category}',
                          style: TextStyle(color: Colors.white.withOpacity(0.85), fontSize: 12),
                        ),
                        const SizedBox(height: 12),
                        LinearPercentIndicator(
                          lineHeight: 6,
                          percent: lastRead.progressPercentage,
                          backgroundColor: Colors.white.withOpacity(0.2),
                          progressColor: AppTheme.mintAccent,
                          barRadius: const Radius.circular(8),
                          padding: EdgeInsets.zero,
                        ),
                      ],
                    ),
                  ),
                ),
              ),

            // Academic Year Selector Tabs
            SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(20, 16, 20, 10),
                    child: Text(
                      'BHMS Academic Year',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                    ),
                  ),
                  SizedBox(
                    height: 44,
                    child: ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      scrollDirection: Axis.horizontal,
                      itemCount: AppConstants.bhmsYears.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (context, index) {
                        final year = AppConstants.bhmsYears[index];
                        final isSelected = year == selectedYear;
                        return InkWell(
                          onTap: () {
                            ref.read(selectedYearProvider.notifier).state = year;
                          },
                          borderRadius: BorderRadius.circular(20),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? AppTheme.primaryTeal
                                  : (isDark ? AppTheme.surfaceDark : Colors.white),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(
                                color: isSelected
                                    ? AppTheme.primaryTeal
                                    : (isDark ? AppTheme.borderDark : AppTheme.borderLight),
                              ),
                            ),
                            child: Center(
                              child: Text(
                                year,
                                style: TextStyle(
                                  color: isSelected
                                      ? Colors.white
                                      : (isDark ? Colors.grey[300] : Colors.grey[700]),
                                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),

            // 2-Part Subparts Toggle: Books vs Notes
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: BoxDecoration(
                    color: isDark ? AppTheme.surfaceDark : AppTheme.surfaceMutedLight,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: isDark ? AppTheme.borderDark : AppTheme.borderLight),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: InkWell(
                          onTap: () => ref.read(selectedYearSubpartProvider.notifier).state = 'books',
                          borderRadius: BorderRadius.circular(10),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: selectedSubpart == 'books' ? AppTheme.primaryTeal : Colors.transparent,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.menu_book_rounded, size: 16, color: selectedSubpart == 'books' ? Colors.white : (isDark ? Colors.grey[400] : Colors.grey[600])),
                                const SizedBox(width: 6),
                                Text(
                                  'Standard Books',
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700,
                                    color: selectedSubpart == 'books' ? Colors.white : (isDark ? Colors.grey[400] : Colors.grey[600]),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: InkWell(
                          onTap: () => ref.read(selectedYearSubpartProvider.notifier).state = 'notes',
                          borderRadius: BorderRadius.circular(10),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            decoration: BoxDecoration(
                              color: selectedSubpart == 'notes' ? AppTheme.primaryTeal : Colors.transparent,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.note_alt_outlined, size: 16, color: selectedSubpart == 'notes' ? Colors.white : (isDark ? Colors.grey[400] : Colors.grey[600])),
                                const SizedBox(width: 6),
                                Text(
                                  'Study Notes & PYQs',
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700,
                                    color: selectedSubpart == 'notes' ? Colors.white : (isDark ? Colors.grey[400] : Colors.grey[600]),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Section Header
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      selectedSubpart == 'books'
                          ? '$selectedYear • Standard Textbooks'
                          : 'Curriculum Subjects & Notes ($selectedYear)',
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: selectedSubpart == 'books'
                            ? AppTheme.primaryTeal.withOpacity(0.15)
                            : AppTheme.amberGold.withOpacity(0.18),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        selectedSubpart == 'books' ? 'BOOKS CATALOG' : 'ACADEMIC NOTES',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: selectedSubpart == 'books' ? AppTheme.primaryTeal : AppTheme.amberGold,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Subjects Grid / List
            subjectsAsync.when(
              data: (subjects) => SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final subject = subjects[index];
                      return _buildSubjectCard(context, subject, isDark);
                    },
                    itemCount: subjects.length,
                  ),
                ),
              ),
              loading: () => const SliverToBoxAdapter(
                child: Center(
                  child: Padding(
                    padding: EdgeInsets.all(40),
                    child: CircularProgressIndicator(),
                  ),
                ),
              ),
              error: (err, _) => SliverToBoxAdapter(
                child: Center(child: Text('Error loading subjects: $err')),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 30)),
          ],
        ),
      ),
    );
  }

  Widget _buildSubjectCard(BuildContext context, SubjectModel subject, bool isDark) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: isDark ? AppTheme.surfaceDark : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? AppTheme.borderDark : AppTheme.borderLight,
        ),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.all(14),
        leading: Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: AppTheme.primaryTeal.withOpacity(0.12),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(
            _getSubjectIcon(subject.icon),
            color: AppTheme.primaryTeal,
            size: 26,
          ),
        ),
        title: Text(
          subject.name,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text(
              subject.description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                color: isDark ? Colors.grey[400] : Colors.grey[600],
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: isDark ? AppTheme.surfaceMutedDark : AppTheme.surfaceMutedLight,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    subject.code,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.primaryTeal,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '${subject.pdfCount} Materials Available',
                  style: TextStyle(
                    fontSize: 11,
                    color: isDark ? Colors.grey[400] : Colors.grey[500],
                  ),
                ),
              ],
            ),
          ],
        ),
        trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 16, color: Colors.grey),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => PdfListScreen(subject: subject),
            ),
          );
        },
      ),
    );
  }
}
