package __PACKAGE__

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.*
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

interface Result {
    fun complete(value: String)
    fun failed(reason: String)
}

object Commands {
    /** Call in response to a user action while the activity is visible. */
    @JvmStatic fun run(context: Context, result: Result) {
        val handler = Handler(Looper.getMainLooper())
        val done = AtomicBoolean(false)
        val timeout = Runnable {
            if (done.compareAndSet(false, true)) result.failed("Service response timed out")
        }
        val receiver = object : ResultReceiver(handler) {
            override fun onReceiveResult(code: Int, data: Bundle?) {
                if (!done.compareAndSet(false, true)) return
                handler.removeCallbacks(timeout)
                if (code == 0) result.complete(data?.getString("value").orEmpty())
                else result.failed("Service work failed")
            }
        }
        val intent = Intent(context, PluginService::class.java).putExtra("result", receiver)
        handler.postDelayed(timeout, 10000)
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
            else context.startService(intent)
        } catch (e: Exception) {
            handler.removeCallbacks(timeout)
            if (done.compareAndSet(false, true)) result.failed(e.message ?: "Service unavailable")
        }
    }
}

class PluginService : Service() {
    private val worker = Executors.newSingleThreadExecutor()
    override fun onBind(intent: Intent?) = null
    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val channel = "__LIB__"
        val notification = if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(channel, "__PLUGIN__", NotificationManager.IMPORTANCE_LOW))
            Notification.Builder(this, channel)
        } else Notification.Builder(this)
        startForeground(1 + (channel.hashCode() and 0x3fffffff),
            notification.setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("__PLUGIN__ is running").build())
        val receiver = intent?.getParcelableExtra<ResultReceiver>("result")
        worker.execute {
            try {
                // Replace this bounded job with the app's short background work.
                receiver?.send(0, Bundle().apply { putString("value", "__PLUGIN__ service") })
            } catch (e: Exception) { receiver?.send(1, null) }
            finally { stopSelfResult(startId) }
        }
        return START_NOT_STICKY
    }
    override fun onDestroy() { worker.shutdownNow(); super.onDestroy() }
}
