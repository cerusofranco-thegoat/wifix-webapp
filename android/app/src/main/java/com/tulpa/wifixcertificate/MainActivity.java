package com.tulpa.wifixcertificate;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.tulpa.wifixcertificate.plugins.NetworkToolsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NetworkToolsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
