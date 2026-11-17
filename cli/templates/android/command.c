#include <jni.h>
JNIEXPORT jstring JNICALL __SYMBOL__(JNIEnv *env, jclass klass) {
    (void)klass;
    return (*env)->NewStringUTF(env, "__PLUGIN__ native library");
}
