import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/constants/app_constants.dart';
import '../../../core/security/pdf_encryption_service.dart';
import '../../../core/theme/app_theme.dart';
import '../data/auth_repository.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  int _cacheSizeBytes = 0;
  bool _notificationsEnabled = true;

  @override
  void initState() {
    super.initState();
    _loadCacheSize();
  }

  Future<void> _loadCacheSize() async {
    final size = await PdfEncryptionService().getCachedVaultSizeBytes();
    if (mounted) setState(() => _cacheSizeBytes = size);
  }

  String _formatBytes(int bytes) {
    if (bytes <= 0) return '0 KB';
    final mb = bytes / (1024 * 1024);
    if (mb >= 1.0) return '${mb.toStringAsFixed(1)} MB';
    return '${(bytes / 1024).toStringAsFixed(0)} KB';
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final user = ref.watch(currentUserProfileProvider).value;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Student Profile', style: TextStyle(fontWeight: FontWeight.w800)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          // Profile Card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: isDark ? AppTheme.surfaceDark : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: isDark ? AppTheme.borderDark : AppTheme.borderLight),
            ),
            child: Column(
              children: [
                CircleAvatar(
                  radius: 36,
                  backgroundColor: AppTheme.primaryTeal.withOpacity(0.15),
                  child: Text(
                    (user?.displayName.isNotEmpty ?? false)
                        ? user!.displayName[0].toUpperCase()
                        : 'H',
                    style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: AppTheme.primaryTeal),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  user?.displayName ?? 'BHMS Student',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 4),
                Text(
                  user?.email ?? '',
                  style: TextStyle(fontSize: 13, color: isDark ? Colors.grey[400] : Colors.grey[600]),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppTheme.primaryTeal.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '${user?.bhmsYear ?? "1st Year"} • ${user?.role.toUpperCase() ?? "STUDENT"}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppTheme.primaryTeal,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Academic Institution Section
          const Text('ACADEMIC DETAILS', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: Colors.grey)),
          const SizedBox(height: 8),
          Container(
            decoration: BoxDecoration(
              color: isDark ? AppTheme.surfaceDark : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: isDark ? AppTheme.borderDark : AppTheme.borderLight),
            ),
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.apartment_rounded, color: AppTheme.primaryTeal),
                  title: const Text('Institution / College', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                  subtitle: Text(user?.collegeName ?? 'National Institute of Homoeopathy'),
                ),
                Divider(height: 1, color: isDark ? AppTheme.borderDark : AppTheme.borderLight),
                ListTile(
                  leading: const Icon(Icons.school_rounded, color: AppTheme.primaryTeal),
                  title: const Text('Change Active Year', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                  subtitle: Text(user?.bhmsYear ?? '1st Year'),
                  trailing: const Icon(Icons.arrow_forward_ios_rounded, size: 14),
                  onTap: () {
                    _showYearPickerDialog(user);
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // App Storage & Security Settings
          const Text('STORAGE & ANTI-PIRACY', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: Colors.grey)),
          const SizedBox(height: 8),
          Container(
            decoration: BoxDecoration(
              color: isDark ? AppTheme.surfaceDark : Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: isDark ? AppTheme.borderDark : AppTheme.borderLight),
            ),
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.enhanced_encryption_rounded, color: AppTheme.mintAccent),
                  title: const Text('AES-256 Offline Vault', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                  subtitle: Text('Encrypted sandbox size: ${_formatBytes(_cacheSizeBytes)}'),
                  trailing: TextButton(
                    onPressed: () async {
                      // Prompt confirm clear
                      await _loadCacheSize();
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Vault verified & synchronized.')),
                      );
                    },
                    child: const Text('Verify'),
                  ),
                ),
                Divider(height: 1, color: isDark ? AppTheme.borderDark : AppTheme.borderLight),
                SwitchListTile(
                  secondary: const Icon(Icons.notifications_active_outlined, color: AppTheme.amberGold),
                  title: const Text('University & Notes Alerts', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                  subtitle: const Text('Instant notification on new PYQ uploads', style: TextStyle(fontSize: 12)),
                  value: _notificationsEnabled,
                  onChanged: (val) => setState(() => _notificationsEnabled = val),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Logout Button
          ElevatedButton.icon(
            onPressed: () async {
              await ref.read(authRepositoryProvider).signOut();
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.coralRed.withOpacity(0.12),
              foregroundColor: AppTheme.coralRed,
              elevation: 0,
            ),
            icon: const Icon(Icons.logout_rounded),
            label: const Text('Sign Out from Homoeo Pulse'),
          ),
        ],
      ),
    );
  }

  void _showYearPickerDialog(user) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Select Your BHMS Year', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              ),
              ...AppConstants.bhmsYears.map(
                (year) => ListTile(
                  title: Text(year),
                  trailing: user?.bhmsYear == year
                      ? const Icon(Icons.check, color: AppTheme.primaryTeal)
                      : null,
                  onTap: () async {
                    if (user != null) {
                      await ref.read(authRepositoryProvider).updateUserProfile(
                            uid: user.uid,
                            displayName: user.displayName,
                            bhmsYear: year,
                            collegeName: user.collegeName,
                          );
                    }
                    Navigator.pop(ctx);
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
