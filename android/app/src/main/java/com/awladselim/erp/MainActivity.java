package com.awladselim.erp;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureVaultPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        normalizeWebViewRendering();
    }

    @Override
    public void onResume() {
        super.onResume();
        normalizeWebViewRendering();
    }

    private void normalizeWebViewRendering() {
        if (this.bridge == null) return;
        WebView webView = this.bridge.getWebView();
        if (webView == null) return;

        WebSettings settings = webView.getSettings();
        // Prevent OS accessibility font-size scaling from breaking ERP tables/buttons
        settings.setTextZoom(100);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);

        // Enforce consistent Light Design System even when Android Dark Theme is enabled
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            settings.setAlgorithmicDarkeningAllowed(false);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            @SuppressWarnings("deprecation")
            int forceDarkOff = WebSettings.FORCE_DARK_OFF;
            settings.setForceDark(forceDarkOff);
        }
    }
}
