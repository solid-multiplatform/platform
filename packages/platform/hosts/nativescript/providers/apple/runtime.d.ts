// What the NativeScript iOS typings leave out. The only hand-written native
// declarations of the Apple providers.

declare namespace NSObject {
  /**
   * Defines an Objective-C subclass of NSObject whose methods are the given
   * functions, conforming to the given protocols.
   */
  function extend<T extends object>(
    methods: T & ThisType<NSObject & T>,
    options?: { name?: string; protocols?: readonly object[] },
  ): { new (): NSObject & T };
}
