#include <jni.h>
JNIEXPORT jstring JNICALL Java___JNI___Commands_run(JNIEnv *env, jclass klass) {
    (void)klass;
    return (*env)->NewStringUTF(env, "__PLUGIN__ native library");
}
