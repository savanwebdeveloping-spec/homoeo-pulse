import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:firebase_core/firebase_core.dart';
import 'core/theme/app_theme.dart';
import 'core/constants/app_constants.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/presentation/auth_screen.dart';
import 'features/dashboard/presentation/main_scaffold_screen.dart';
import 'features/bookmarks_recents/data/local_cache_service.dart';
import 'features/notifications/notification_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Hive offline storage
  await LocalCacheService().init();

  // Try to initialize Firebase
  try {
    await Firebase.initializeApp();
    await NotificationService().initialize();
  } catch (e) {
    debugPrint('Firebase initialization notice: $e (Running in offline/preview fallback mode)');
  }

  runApp(
    const ProviderScope(
      child: HomoeoPulseApp(),
    ),
  );
}

class HomoeoPulseApp extends ConsumerWidget {
  const HomoeoPulseApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authStateProvider);

    return MaterialApp(
      title: AppConstants.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      home: authState.when(
        data: (user) {
          if (user != null) {
            return const MainScaffoldScreen();
          }
          return const AuthScreen();
        },
        loading: () => const Scaffold(
          body: Center(
            child: CircularProgressIndicator(color: AppTheme.primaryTeal),
          ),
        ),
        error: (_, __) => const AuthScreen(),
      ),
    );
  }
}
