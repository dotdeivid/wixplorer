package com.wixplorer.wixplorer_mobile

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Servicio foreground de Android que muestra una notificación persistente
 * mientras el servidor HTTP de WiXplorer está activo.
 * Esto le indica al sistema que la app tiene trabajo en curso y evita que
 * el proceso sea terminado al pasar a segundo plano.
 */
class WiXplorerForegroundService : Service() {

    companion object {
        const val CHANNEL_ID     = "wixplorer_server"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START   = "com.wixplorer.START"
        const val ACTION_STOP    = "com.wixplorer.STOP"
        const val EXTRA_TEXT     = "notif_text"

        /**
         * Lo registra MainActivity para avisarle a Dart que Android cortó el
         * servicio (límite de tiempo de dataSync en Android 15+) y que el
         * servidor HTTP también tiene que detenerse.
         */
        @Volatile var onSystemStop: (() -> Unit)? = null
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // intent == null: Android recreó el servicio después de matar el
        // proceso. El servidor HTTP vive en el FlutterEngine y ya no existe,
        // así que no hay que mostrar una notificación de "activo".
        if (intent == null || intent.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val text = intent.getStringExtra(EXTRA_TEXT) ?: "Servidor activo"
        val notification = buildNotification(text)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // NOT_STICKY: si el sistema mata el proceso, el servidor muere con él;
        // recrear solo el servicio dejaría una notificación sin servidor.
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** La app se cerró desde recientes: el FlutterEngine (y el servidor) mueren. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * Android 15+: los servicios dataSync tienen un límite de 6 h cada 24 h.
     * Al agotarse hay que detenerse en pocos segundos o el sistema lanza ANR.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        onSystemStop?.invoke()
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun buildNotification(text: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pending = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("WiXplorer")
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pending)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "WiXplorer Servidor",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Mantiene el servidor activo en segundo plano"
                setShowBadge(false)
                enableVibration(false)
                enableLights(false)
            }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }
}
