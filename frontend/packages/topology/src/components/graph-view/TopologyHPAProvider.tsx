import * as React from 'react';
import { TopologyHPAContext, useHPAMapForNamespace } from './components/nodes/useTopologyHPA';

interface TopologyHPAProviderProps {
  namespace: string;
  children: React.ReactNode;
}

/**
 * Provides a pre-computed HPA lookup map to all topology graph nodes.
 *
 * **Why this exists (OCPBUGS-115907)**:
 * Previously every workload node in the topology graph called
 * `useRelatedHPA`, which internally called `useK8sWatchResource` to
 * watch *all* HPAs in the namespace and then scanned the list with
 * `Array.find` to locate the matching one.  With n workload nodes
 * and n HPAs this produced:
 *
 *  - n independent Redux selectors that all fire on every HPA change,
 *    causing n component re-renders;
 *  - O(n) linear scans per node → O(n²) total work per render cycle;
 *  - cascading MobX / layout-engine recalculations in PatternFly
 *    Topology.
 *
 * This provider centralises the watch to a single
 * `useK8sWatchResource` call and builds a `Map<key, HPA>` once,
 * giving each node an O(1) lookup via `useTopologyHPA`.
 */
const TopologyHPAProvider: React.FC<TopologyHPAProviderProps> = ({ namespace, children }) => {
  const contextValue = useHPAMapForNamespace(namespace);
  return <TopologyHPAContext.Provider value={contextValue}>{children}</TopologyHPAContext.Provider>;
};

export default TopologyHPAProvider;
