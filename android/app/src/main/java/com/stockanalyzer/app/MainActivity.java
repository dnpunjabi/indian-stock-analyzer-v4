package com.stockanalyzer.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
    
    @Override
    public void onStart() {
        super.onStart();
        WebView webView = this.bridge.getWebView();
        if (webView != null) {
            webView.addJavascriptInterface(new WebAppInterface(this, webView), "AndroidPrint");
        }
    }
}

class WebAppInterface {
    Context mContext;
    WebView mWebView;

    WebAppInterface(Context c, WebView w) {
        mContext = c;
        mWebView = w;
    }

    @JavascriptInterface
    public void print() {
        mWebView.post(new Runnable() {
            @Override
            public void run() {
                PrintManager printManager = (PrintManager) mContext.getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter printAdapter = mWebView.createPrintDocumentAdapter("Stock Analyzer Report");
                String jobName = "Stock Analyzer Document";
                printManager.print(jobName, printAdapter, new PrintAttributes.Builder().build());
            }
        });
    }
}
