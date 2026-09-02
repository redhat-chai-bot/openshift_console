import { createContext, useContext, useMemo, useRef } from 'react';
import { useK8sWatchResource } from '@console/internal/components/utils/k8s-watch-hook';
import { HorizontalPodAutoscalerModel } from '@console/internal/models';
import { HorizontalPodAutoscalerKind } from '@console/internal/module/k8s';

/**
 * Build a lookup key for an HPA's scaleTargetRef.
 * The key matches what `doesHpaMatch` from hpa-utils compares:
 *   ref.apiVersion === workload.apiVersion
 *   ref.kind       === workload.kind
 *   ref.name       === workload.metadata.name
 */
const buildHPAKey = (apiVersion: string, kind: string, name: string): string =>
  `${apiVersion}/${kind}/${name}`;

/**
 * A read-only map from workload identity to the matching HPA.
 * Keyed by `"apiVersion/kind/name"` of the HPA's scaleTargetRef.
 */
export type HPAMap = Map<string, HorizontalPodAutoscalerKind>;

export interface TopologyHPAContextValue {
  hpaMap: HPAMap;
  loaded: boolean;
  error: string;
}

const EMPTY_MAP: HPAMap = new Map();

/**
 * React context that holds a pre-computed HPA lookup map.
 *
 * Used by `useTopologyHPA` to avoid O(n) per-node HPA scans.
 * The provider (`TopologyHPAProvider`) should wrap the topology graph-view
 * so that all workload nodes share a single HPA watch.
 */
export const TopologyHPAContext = createContext<TopologyHPAContextValue>({
  hpaMap: EMPTY_MAP,
  loaded: false,
  error: undefined,
});
TopologyHPAContext.displayName = 'TopologyHPAContext';

/**
 * Build an HPAMap from the list of HPAs.
 * Pure function, no side-effects.
 */
const buildHPAMap = (hpas: HorizontalPodAutoscalerKind[]): HPAMap => {
  const map: HPAMap = new Map();
  for (const hpa of hpas) {
    const ref = hpa?.spec?.scaleTargetRef;
    if (ref?.apiVersion && ref?.kind && ref?.name) {
      map.set(buildHPAKey(ref.apiVersion, ref.kind, ref.name), hpa);
    }
  }
  return map;
};

/**
 * Produce a fingerprint that changes only when the set of HPAs
 * or their data actually changes — NOT on every Redux reference change.
 * Uses uid + resourceVersion, which is cheap and definitive.
 */
const hpaFingerprint = (hpas: HorizontalPodAutoscalerKind[]): string => {
  if (!hpas?.length) return '';
  // Sort by uid for stability (order may vary across Redux updates)
  return hpas
    .map((h) => `${h.metadata?.uid}:${h.metadata?.resourceVersion}`)
    .sort()
    .join(',');
};

/**
 * Hook for the HPAProvider: watches all HPAs in a namespace and
 * returns a stable `TopologyHPAContextValue`.
 *
 * Stability: the returned `hpaMap` only changes when the actual
 * HPA data changes (tracked via uid+resourceVersion fingerprint),
 * not on every Redux state reference change.
 */
export const useHPAMapForNamespace = (namespace: string): TopologyHPAContextValue => {
  const [hpas, loaded, error] = useK8sWatchResource<HorizontalPodAutoscalerKind[]>({
    kind: HorizontalPodAutoscalerModel.kind,
    namespace,
    optional: true,
    isList: true,
  });

  // Track the previous fingerprint and map so we can preserve referential
  // identity when the data hasn't actually changed.
  const prevRef = useRef<{ fingerprint: string; map: HPAMap }>({
    fingerprint: '',
    map: EMPTY_MAP,
  });

  const hpaMap = useMemo(() => {
    if (!hpas || !loaded || error) {
      return EMPTY_MAP;
    }
    const fp = hpaFingerprint(hpas);
    if (fp === prevRef.current.fingerprint) {
      return prevRef.current.map;
    }
    const newMap = buildHPAMap(hpas);
    prevRef.current = { fingerprint: fp, map: newMap };
    return newMap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hpas, loaded, error]);

  return useMemo(() => ({ hpaMap, loaded, error }), [hpaMap, loaded, error]);
};

/**
 * Per-node hook: O(1) lookup of the HPA targeting a specific workload.
 *
 * Replaces `useRelatedHPA` inside the topology graph view.
 * Falls back gracefully when no TopologyHPAContext provider is mounted
 * (returns `[undefined, false, undefined]`).
 *
 * @returns `[matchingHpa, loaded, error]` — same shape as `useRelatedHPA`
 */
export const useTopologyHPA = (
  workloadAPI: string,
  workloadKind: string,
  workloadName: string,
): [HorizontalPodAutoscalerKind | undefined, boolean, string] => {
  const { hpaMap, loaded, error } = useContext(TopologyHPAContext);

  return useMemo(() => {
    if (!loaded || error || !workloadAPI || !workloadKind || !workloadName) {
      return [undefined, loaded, error];
    }
    const key = buildHPAKey(workloadAPI, workloadKind, workloadName);
    return [hpaMap.get(key), loaded, error];
  }, [hpaMap, loaded, error, workloadAPI, workloadKind, workloadName]);
};
