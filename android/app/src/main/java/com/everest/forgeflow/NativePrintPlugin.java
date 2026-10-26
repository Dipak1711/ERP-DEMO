package com.everest.forgeflow;

import android.app.Activity;
import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens Android's own print dialog (which also has "Save as PDF") for:
 *   printHtml({ title, html })  a finished HTML document, loaded in a hidden WebView first
 *   printPage({ title })        the page that is on screen
 * A WebView does nothing for window.print(), so the web app calls this instead (src/native/native.ts).
 */
@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {

    // kept until the next print: the document must not be freed while the print dialog is still open
    private WebView printView;

    @PluginMethod
    public void printHtml(final PluginCall call) {
        final String html = call.getString("html");
        final String title = call.getString("title", "Document");
        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                final WebView view = new WebView(activity);
                final boolean landscape = html.contains("landscape");
                view.setWebViewClient(new WebViewClient() {
                    private boolean started = false;

                    @Override
                    public void onPageFinished(WebView v, String url) {
                        if (started) return;
                        started = true;
                        try {
                            start(activity, v, title, landscape);
                            call.resolve();
                        } catch (Exception e) {
                            call.reject(e.getMessage());
                        }
                    }
                });
                printView = view;
                view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void printPage(final PluginCall call) {
        final String title = call.getString("title", "Document");
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                start(activity, getBridge().getWebView(), title, false);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    private void start(Activity activity, WebView view, String title, boolean landscape) {
        PrintManager manager = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
        PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(title);
        PrintAttributes.Builder attrs = new PrintAttributes.Builder().setMediaSize(landscape ? PrintAttributes.MediaSize.ISO_A4.asLandscape() : PrintAttributes.MediaSize.ISO_A4);
        manager.print(title, adapter, attrs.build());
    }
}
