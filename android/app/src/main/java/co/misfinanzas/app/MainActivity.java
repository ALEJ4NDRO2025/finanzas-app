package co.misfinanzas.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

/**
 * Envoltorio nativo de Mis Finanzas: abre la app web en pantalla completa.
 * Solo navega dentro del dominio de la app; cualquier otro enlace se abre en el navegador.
 */
public class MainActivity extends Activity {
    private static final Uri APP = Uri.parse(BuildConfig.APP_URL);
    private WebView web;
    private boolean offline = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0D1017"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // el fondo animado del acceso
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " MisFinanzasAndroid/" + BuildConfig.VERSION_NAME);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("https".equals(u.getScheme()) && APP.getHost().equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });

        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBackOrExit);
        }

        if (state != null) web.restoreState(state);
        else web.loadUrl(APP.toString());
    }

    private void goBackOrExit() {
        if (!offline && web.canGoBack()) web.goBack();
        else finish();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { goBackOrExit(); }

    // Pantalla sin conexión con los colores de la app y un botón para reintentar.
    private void showOffline() {
        offline = true;
        String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<body style='margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1017;color:#edf0f6;"
            + "font:16px system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box'>"
            + "<div><h1 style='font-size:24px;margin:0 0 8px'>Sin conexión</h1>"
            + "<p style='color:#96a0b5;margin:0 0 24px'>Revisa tu internet y vuelve a intentar.</p>"
            + "<a href='" + APP + "' style='display:inline-block;background:#f4c84a;color:#191407;font-weight:600;"
            + "padding:14px 28px;border-radius:14px;text-decoration:none'>Reintentar</a></div></body>";
        web.loadDataWithBaseURL(APP.toString(), html, "text/html", "utf-8", null);
        web.postDelayed(() -> offline = false, 500);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush(); // conserva la sesión aunque Android cierre la app
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
