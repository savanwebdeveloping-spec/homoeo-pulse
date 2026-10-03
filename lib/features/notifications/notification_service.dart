import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  final FirebaseMessaging _fcm = FirebaseMessaging.instance;

  Future<void> initialize() async {
    try {
      final settings = await _fcm.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );

      if (settings.authorizationStatus == AuthorizationStatus.authorized) {
        debugPrint('FCM Authorization Granted');
      }

      // Subscribe to general BHMS university exam announcement channel
      await _fcm.subscribeToTopic('bhms_announcements');
      await _fcm.subscribeToTopic('new_notes_uploaded');

      // Foreground message handler
      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        debugPrint('Received foreground notification: ${message.notification?.title}');
      });

      // Background open handler
      FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        debugPrint('User tapped notification: ${message.data}');
      });
    } catch (e) {
      debugPrint('Notification initialization warning: $e');
    }
  }

  /// Subscribe student to their specific academic year topic (e.g. 'year_1st', 'year_2nd')
  Future<void> updateYearSubscription(String bhmsYear) async {
    final cleanTag = bhmsYear.toLowerCase().replaceAll(' ', '_');
    try {
      await _fcm.subscribeToTopic('bhms_$cleanTag');
    } catch (e) {
      debugPrint('Error subscribing to year topic: $e');
    }
  }
}
