package dev.solidmultiplatform.video;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.Trace;
import android.view.LayoutInflater;
import androidx.annotation.Keep;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Builds engines away from UI input dispatch. Player access and callbacks use the main looper. */
@Keep
public final class AndroidPlayerFactory {
    @Keep
    public interface Callback {
        void ready(ExoPlayer player, PlayerView view);
        void failed(String message);
    }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final ThreadPoolExecutor WORKER = new ThreadPoolExecutor(
            0, 1, 10, TimeUnit.SECONDS, new LinkedBlockingQueue<>());

    private AndroidPlayerFactory() {}

    public static Request create(Context context, Callback callback) {
        Request request = new Request(context.getApplicationContext(), callback);
        // Enqueue inflation first. The worker's completion posts to the same FIFO
        // looper, so it sees the finished view without blocking either thread.
        MAIN.post(request::inflate);
        WORKER.execute(request);
        return request;
    }

    @Keep
    public static final class Request implements Runnable {
        private final Context context;
        private volatile Callback callback;
        private PlayerView view;

        private Request(Context context, Callback callback) {
            this.context = context;
            this.callback = callback;
        }

        /** Called by the adapter on the application looper. */
        public void cancel() {
            callback = null;
            view = null;
            WORKER.remove(this);
        }

        private void inflate() {
            if (callback == null) return;
            Trace.beginSection("SolidVideo.inflateView");
            try {
                int layout = context.getResources().getIdentifier(
                        "solid_multiplatform_video_player", "layout", context.getPackageName());
                view = layout == 0 ? new PlayerView(context)
                        : (PlayerView) LayoutInflater.from(context).inflate(layout, null);
            } catch (RuntimeException | LinkageError error) {
                fail(error.toString());
            } finally {
                Trace.endSection();
            }
        }

        private void fail(String message) {
            Callback recipient = callback;
            cancel();
            if (recipient != null) recipient.failed(message);
        }

        @Override public void run() {
            if (callback == null) return;
            Trace.beginSection("SolidVideo.buildEngine");
            try {
                ExoPlayer engine = new ExoPlayer.Builder(context).setLooper(Looper.getMainLooper()).build();
                MAIN.post(() -> {
                    Callback recipient = callback;
                    PlayerView prepared = view;
                    callback = null;
                    view = null;
                    if (recipient != null) recipient.ready(engine, prepared);
                    else engine.release();
                });
            } catch (RuntimeException | LinkageError error) {
                MAIN.post(() -> fail(error.toString()));
            } finally {
                Trace.endSection();
            }
        }
    }
}
