package __PACKAGE__

import android.os.Build

object Commands {
    @JvmStatic fun run(): String = "__PLUGIN__ Android API " + Build.VERSION.SDK_INT
}
