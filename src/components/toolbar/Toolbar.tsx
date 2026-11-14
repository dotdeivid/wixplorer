import React from 'react';
import styles from './Toolbar.module.css';
import type { PathNode } from '../../hooks/useMTPDevice';
import type { ViewMode, SortMode, SortDir, GroupMode } from '../layout/AppLayout';
import SortDropdown from './SortDropdown';

/* ─── SVG Icons ──────────────────────────────────────────────────────────── */
const IcoBack = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round">
    <polyline points="8.5,1 3,6.5 8.5,12"/>
  </svg>
);

const IcoForward = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round">
    <polyline points="4.5,1 10,6.5 4.5,12"/>
  </svg>
);

const IcoGrid = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <rect x="1" y="1" width="5.5" height="5.5" rx="1"/>
    <rect x="8.5" y="1" width="5.5" height="5.5" rx="1"/>
    <rect x="1" y="8.5" width="5.5" height="5.5" rx="1"/>
    <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1"/>
  </svg>
);

const IcoList = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <rect x="1" y="2.5" width="13" height="1.5" rx="0.75"/>
    <rect x="1" y="6.75" width="13" height="1.5" rx="0.75"/>
    <rect x="1" y="11" width="13" height="1.5" rx="0.75"/>
  </svg>
);

const IcoColumns = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <rect x="1" y="1" width="4" height="13" rx="1"/>
    <rect x="6" y="1" width="4" height="13" rx="1"/>
    <rect x="11" y="1" width="3" height="13" rx="1"/>
  </svg>
);

const IcoGallery = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <rect x="1" y="1" width="13" height="9" rx="1"/>
    <rect x="1" y="12" width="3" height="2" rx="0.5"/>
    <rect x="6" y="12" width="3" height="2" rx="0.5"/>
    <rect x="11" y="12" width="3" height="2" rx="0.5"/>
  </svg>
);

const IcoChevronDown = () => (
  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round">
    <polyline points="1.5,3 4.5,6 7.5,3"/>
  </svg>
);

const IcoGroup = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor">
    <rect x="1" y="1"   width="13" height="2.5" rx="1.25"/>
    <rect x="1" y="5.5" width="9"  height="2"   rx="1"/>
    <rect x="1" y="9.5" width="11" height="2"   rx="1"/>
    <rect x="1" y="13"  width="6"  height="1.5" rx="0.75"/>
  </svg>
);

const IcoSearch = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round">
    <circle cx="5.5" cy="5.5" r="4"/>
    <line x1="8.5" y1="8.5" x2="12" y2="12"/>
  </svg>
);

const IcoSort = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="2" x2="4" y2="13"/>
    <polyline points="2,11 4,13 6,11"/>
    <line x1="11" y1="13" x2="11" y2="2"/>
    <polyline points="9,4 11,2 13,4"/>
  </svg>
);

/* ─── Props ──────────────────────────────────────────────────────────────── */
interface ToolbarProps {
  isConnected: boolean;
  currentPath: PathNode[];
  onNavigateOut: () => void;
  onNavigateForward: () => void;
  canGoForward: boolean;
  isLoading: boolean;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  sortMode: SortMode;
  sortDir: SortDir;
  onSortChange: (s: SortMode) => void;
  onNavigateToPathIndex: (index: number) => void;
  groupMode: GroupMode;
  onGroupModeChange: (g: GroupMode) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

/** id del campo de búsqueda, para enfocarlo con ⌘F. */
export const SEARCH_INPUT_ID = 'toolbar-search';

const VIEW_MODES: { mode: ViewMode; icon: React.ReactNode; title: string }[] = [
  { mode: 'grid',    icon: <IcoGrid />,    title: 'Íconos'   },
  { mode: 'list',    icon: <IcoList />,    title: 'Lista'    },
  { mode: 'columns', icon: <IcoColumns />, title: 'Columnas' },
  { mode: 'gallery', icon: <IcoGallery />, title: 'Galería'  },
];


const Toolbar: React.FC<ToolbarProps> = ({
  isConnected,
  currentPath,
  onNavigateOut,
  onNavigateForward,
  canGoForward,
  isLoading,
  viewMode,
  onViewModeChange,
  sortMode,
  sortDir,
  onSortChange,
  onNavigateToPathIndex,
  groupMode,
  onGroupModeChange,
  searchQuery,
  onSearchChange,
}) => {
  const canGoBack = isConnected && currentPath.length > 1;
  // Breadcrumb: si la ruta es larga se muestran la raíz, "…" y las dos últimas
  const crumbs = currentPath.length > 4
    ? [
        { node: currentPath[0], index: 0 },
        null,
        ...currentPath.slice(-2).map((node, i) => ({ node, index: currentPath.length - 2 + i })),
      ]
    : currentPath.map((node, index) => ({ node, index }));

  return (
    <div className={styles.toolbar}>
      {/* Back / Forward */}
      <div className={styles.navGroup}>
        <button
          className={styles.navBtn}
          onClick={onNavigateOut}
          disabled={!canGoBack || isLoading}
          title="Atrás"
          aria-label="Atrás"
        >
          <IcoBack />
        </button>
        <button className={styles.navBtn}
          onClick={onNavigateForward}
          disabled={!canGoForward || isLoading}
          title="Adelante"
          aria-label="Adelante"
        >
          <IcoForward />
        </button>
      </div>

      {/* Ruta actual */}
      {isConnected && crumbs.length > 0 && (
        <nav className={styles.breadcrumb} aria-label="Ubicación">
          <ol>
            {crumbs.map((c, i) => {
              if (!c) return <li key="gap" className={styles.crumbGap} aria-hidden="true">…</li>;
              const isCurrent = c.index === currentPath.length - 1;
              return (
                <li key={c.node.id} className={styles.crumbItem}>
                  {i > 0 && <span className={styles.crumbSep} aria-hidden="true">›</span>}
                  {isCurrent ? (
                    <span className={styles.crumbCurrent} aria-current="location" title={c.node.name}>{c.node.name}</span>
                  ) : (
                    <button type="button" className={styles.crumbLink} title={c.node.name}
                      onClick={() => onNavigateToPathIndex(c.index)} disabled={isLoading}>
                      {c.node.name}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className={styles.spacer} />

      {isLoading && <span className={styles.loader} role="status">Cargando…</span>}

      {/* View mode buttons */}
      <div className={styles.viewGroup} role="group" aria-label="Vista">
        {VIEW_MODES.map(({ mode, icon, title }) => (
          <button
            key={mode}
            type="button"
            className={`${styles.viewBtn} ${viewMode === mode ? styles.active : ''}`}
            onClick={() => onViewModeChange(mode)}
            title={title}
            aria-label={title}
            aria-pressed={viewMode === mode}
          >
            {icon}
          </button>
        ))}
      </div>

      {/* Sort dropdown */}
      <SortDropdown
        sortMode={sortMode}
        sortDir={sortDir}
        onSortChange={onSortChange}
        triggerClassName={styles.groupBtn}
        triggerContent={
          <>
            <IcoSort />
            <IcoChevronDown />
          </>
        }
      />

      {/* Group toggle button */}
      <button
        type="button"
        className={`${styles.groupToggleBtn} ${groupMode === 'kind' ? styles.active : ''}`}
        onClick={() => onGroupModeChange(groupMode === 'kind' ? 'none' : 'kind')}
        title="Agrupar por tipo"
        aria-label="Agrupar por tipo"
        aria-pressed={groupMode === 'kind'}
      >
        <IcoGroup />
      </button>

      <div className={styles.sep} />

      {/* Search */}
      <div className={styles.searchBox} role="search">
        <span className={styles.searchIcon} aria-hidden="true"><IcoSearch /></span>
        <input
          id={SEARCH_INPUT_ID}
          className={styles.searchInput}
          type="search"
          placeholder="Buscar"
          aria-label="Buscar en esta carpeta"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && searchQuery) { e.preventDefault(); e.stopPropagation(); onSearchChange(''); }
          }}
          disabled={!isConnected}
        />
      </div>
    </div>
  );
};

export default Toolbar;
