package com.homoeopulse.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();

        // 1. Anti-Piracy DRM: Block screenshots and screen recordings across the app
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );

        // 2. Ensure system navigation bar is NEVER hidden / immersive on any phone brand
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        // 3. Apply persistent, visible navigation bar
        applyNavigationBarSettings(window);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Re-enforce navigation bar visibility upon returning to the app
        applyNavigationBarSettings(getWindow());
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyNavigationBarSettings(getWindow());
        }
    }

    private void applyNavigationBarSettings(Window window) {
        if (window == null) return;

        // Solid dark slate (#0F172A) navigation bar:
        // Guarantees that Back, Home, and Recents buttons are ALWAYS 100% visible
        // with crisp white icons on EVERY Android model and never blend into white app content.
        window.setNavigationBarColor(Color.parseColor("#0F172A"));
        window.setStatusBarColor(Color.parseColor("#0F766E"));

        try {
            WindowInsetsControllerCompat insetsController = 
                WindowCompat.getInsetsController(window, window.getDecorView());
            if (insetsController != null) {
                // Permanently show navigation bars & status bars
                insetsController.show(WindowInsetsCompat.Type.navigationBars());
                insetsController.show(WindowInsetsCompat.Type.statusBars());

                // BEHAVIOR_DEFAULT ensures system navigation bar never auto-hides
                insetsController.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);

                // Dark navigation bar background -> white navigation icons
                insetsController.setAppearanceLightNavigationBars(false);

                // Dark status bar background -> white status bar icons
                insetsController.setAppearanceLightStatusBars(false);
            }
        } catch (Exception ignored) {
        }
    }
}

