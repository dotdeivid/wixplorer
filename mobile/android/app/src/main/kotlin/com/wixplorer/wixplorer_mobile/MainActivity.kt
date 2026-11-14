package com.wixplorer.wixplorer_mobile

import android.content.Intent
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        val channel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "com.wixplorer/foreground",
        )

        // El sistema detuvo el servicio por su cuenta → avisar a Dart.
        WiXplorerForegroundService.onSystemStop = {
            runOnUiThread { channel.invokeMethod("onSystemStop", null) }
        }

        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    val text = call.argument<String>("text") ?: "Servidor activo"
                    val intent = Intent(this, WiXplorerForegroundService::class.java).apply {
                        action = WiXplorerForegroundService.ACTION_START
                        putExtra(WiXplorerForegroundService.EXTRA_TEXT, text)
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(intent)
                    } else {
                        startService(intent)
                    }
                    result.success(null)
                }
                "stop" -> {
                    val intent = Intent(this, WiXplorerForegroundService::class.java).apply {
                        action = WiXplorerForegroundService.ACTION_STOP
                    }
                    startService(intent)
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        WiXplorerForegroundService.onSystemStop = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
