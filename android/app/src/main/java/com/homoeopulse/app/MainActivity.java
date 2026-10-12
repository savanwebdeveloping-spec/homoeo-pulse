package com.homoeopulse.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
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

        // 2. Ensure system bars are never fullscreen / translucent
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        // 3. Crucial: Tell Android window that decor MUST fit system windows
        // This ensures the app display begins BELOW the selfie camera and sits ABOVE the back button
        WindowCompat.setDecorFitsSystemWindows(window, true);

        // 4. Set insets padding on root content view to physically push content
        // below the selfie camera punch hole / notch and above the bottom navigation bar
        applySystemBarPaddings(window);

        // 5. Apply persistent navigation bar colors and visibility
        applyNavigationBarSettings(window);

        // 6. Enable native WebView touch pinch-to-zoom
        enableWebViewZoom();
    }

    @Override
    public void onResume() {
        super.onResume();
        applySystemBarPaddings(getWindow());
        applyNavigationBarSettings(getWindow());
        enableWebViewZoom();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applySystemBarPaddings(getWindow());
            applyNavigationBarSettings(getWindow());
            enableWebViewZoom();
        }
    }

    private void applySystemBarPaddings(Window window) {
        if (window == null) return;
        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            ViewCompat.setOnApplyWindowInsetsListener(contentView, (v, insets) -> {
                Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                // Top padding: below selfie camera / notch
                // Bottom padding: above system back button bar
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            contentView.requestApplyInsets();
        }
    }

    private void applyNavigationBarSettings(Window window) {
        if (window == null) return;

        // Solid dark slate (#0F172A) navigation bar
        // Buttons (Back, Home, Recents) are always 100% visible with crisp white icons
        window.setNavigationBarColor(Color.parseColor("#0F172A"));
        window.setStatusBarColor(Color.parseColor("#0F766E"));

        try {
            WindowInsetsControllerCompat insetsController = 
                WindowCompat.getInsetsController(window, window.getDecorView());
            if (insetsController != null) {
                insetsController.show(WindowInsetsCompat.Type.navigationBars());
                insetsController.show(WindowInsetsCompat.Type.statusBars());
                insetsController.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
                insetsController.setAppearanceLightNavigationBars(false);
                insetsController.setAppearanceLightStatusBars(false);
            }
        } catch (Exception ignored) {
        }
    }

    private void enableWebViewZoom() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                android.webkit.WebView webView = getBridge().getWebView();
                webView.post(() -> {
                    try {
                        android.webkit.WebSettings ws = webView.getSettings();
                        ws.setSupportZoom(true);
                        ws.setBuiltInZoomControls(true);
                        ws.setDisplayZoomControls(false); // Enable pinch gestures
                        ws.setLoadWithOverviewMode(true);
                        ws.setUseWideViewPort(true);
                    } catch (Exception ignored) {}
                });
            }
        } catch (Exception ignored) {
        }
    }
}


