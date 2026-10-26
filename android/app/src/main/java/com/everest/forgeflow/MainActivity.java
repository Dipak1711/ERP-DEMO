package com.everest.forgeflow;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // our own plugin (printing); the Capacitor plugins from npm are registered automatically
        registerPlugin(NativePrintPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
