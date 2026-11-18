// Weak intern pool for identity-sensitive PDF objects.
//
// `PDFRef` and `PDFName` must return the *same* instance for a given key while
// any document using that instance is alive, because PDFContext/PDFDict use
// object identity as Map keys. A module-level strong Map therefore used to
// retain every parsed name/ref forever in long-lived processes (issue #1799).
//
// This pool keeps WeakRefs plus a FinalizationRegistry. When an object is
// collected, the entry is removed only if the dead WeakRef is still the one
// stored for that key, so a late finalizer cannot delete a newer replacement.

interface InternPool<T extends object> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

const WeakRefCtor = (globalThis as any).WeakRef;
const FinalizationRegistryCtor = (globalThis as any).FinalizationRegistry;

interface HeldValue {
  key: string;
  ref: any;
}

export const createInternPool = <T extends object>(): InternPool<T> => {
  // Old browsers/runtimes without WeakRef keep the historical behavior. The
  // API is unchanged; only the memory characteristics differ.
  if (
    typeof WeakRefCtor !== 'function' ||
    typeof FinalizationRegistryCtor !== 'function'
  ) {
    const strong = new Map<string, T>();
    return {
      get: (key: string) => strong.get(key),
      set: (key: string, value: T) => {
        strong.set(key, value);
      },
    };
  }

  const pool = new Map<string, any>();
  const registry = new FinalizationRegistryCtor((held: HeldValue) => {
    if (pool.get(held.key) === held.ref) pool.delete(held.key);
  });

  return {
    get: (key: string): T | undefined => {
      const ref = pool.get(key);
      return ref === undefined ? undefined : ref.deref();
    },
    set: (key: string, value: T): void => {
      const oldRef = pool.get(key);
      if (oldRef !== undefined) registry.unregister(oldRef);

      const ref = new WeakRefCtor(value);
      pool.set(key, ref);
      registry.register(value, { key, ref } as HeldValue, ref);
    },
  };
};
