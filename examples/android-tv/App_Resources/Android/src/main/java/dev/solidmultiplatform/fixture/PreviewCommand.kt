package dev.solidmultiplatform.fixture

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import java.io.File
import java.io.DataInputStream
import java.util.concurrent.atomic.AtomicBoolean

/** NativeScript invokes both methods on the main thread. */
interface PreviewResult {
    fun complete(rgbaBase64: String)
    fun failed(reason: String)
}

/** One request owns one bundled process. The UI thread only starts or cancels it. */
class PreviewCommand(context: Context, private val result: PreviewResult) {
    private val binary = File(context.applicationInfo.nativeLibraryDir, "libsolid_preview.so")
    private val main = Handler(Looper.getMainLooper())
    private val started = AtomicBoolean()
    private val finished = AtomicBoolean()
    @Volatile private var child: Process? = null
    private val timeout = Runnable { finish(null, "Native preview timed out") }

    fun start() {
        check(Looper.myLooper() == Looper.getMainLooper())
        check(started.compareAndSet(false, true)) { "A preview command runs once" }
        if (finished.get()) return
        main.postDelayed(timeout, 5000)
        Thread({
            try {
                val process = ProcessBuilder(binary.absolutePath)
                    .redirectErrorStream(true)
                    .start()
                child = process
                try {
                    if (finished.get()) return@Thread
                    process.outputStream.close()
                    val pixels = ByteArray(8 * 8 * 4)
                    DataInputStream(process.inputStream).use {
                        it.readFully(pixels)
                        check(it.read() == -1) { "Unexpected preview payload size" }
                    }
                    check(process.waitFor() == 0) { "Native preview exited with an error" }
                    val encoded = Base64.encodeToString(pixels, Base64.NO_WRAP)
                    main.post { finish(encoded, null) }
                } finally {
                    process.destroy()
                    child = null
                }
            } catch (error: Exception) {
                main.post { finish(null, error.message ?: "Native preview failed") }
            }
        }, "solid-preview").start()
    }

    fun cancel() {
        main.post { finish(null, "Native preview cancelled") }
    }

    private fun finish(pixels: String?, error: String?) {
        if (!finished.compareAndSet(false, true)) return
        main.removeCallbacks(timeout)
        child?.destroy()
        if (pixels == null) result.failed(requireNotNull(error)) else result.complete(pixels)
    }
}
