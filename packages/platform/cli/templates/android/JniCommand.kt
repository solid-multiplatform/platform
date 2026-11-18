package __PACKAGE__

object Commands {
    init { System.loadLibrary("__LIB__") }
    @JvmStatic external fun run(): String
}
