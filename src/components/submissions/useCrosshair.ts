import { useEffect, type RefObject } from 'react';

/**
 * Row + column highlight that follows the pointer across a table.
 *
 * A wide grid is genuinely hard to read across: by the twelfth column you
 * have lost which line item you are on, and by the twentieth row you have
 * lost which day. CSS gives you the row for free (`tr:hover`) but has no way
 * to select a COLUMN, so that half is done here.
 *
 * Columns are matched by GEOMETRY, not by `cellIndex`. `cellIndex` is a
 * position in that row's DOM children, and the grouped layout's header spans
 * both ways — `colSpan` for a section, `rowSpan={2}` for the label and total
 * columns — so the same index means a different visual column in the header
 * than in the body. Horizontal extent is what a column actually is, and a
 * table lays its columns out on exact pixel boundaries, so an overlap test is
 * precise rather than approximate. It also lights a spanning section header
 * above whichever of its items you are on, which is what you want anyway.
 *
 * Deliberately imperative. Holding the hovered column in React state would
 * re-render a 12x20 grid on every pixel of pointer movement; toggling two
 * classes on the affected cells costs nothing and never touches the tree.
 */
export function useCrosshair(ref: RefObject<HTMLTableElement | null>, enabled = true): void {
  useEffect(() => {
    const table = ref.current;
    if (!table || !enabled) return;

    /** The hovered cell, so a re-scan is skipped while the pointer stays in it. */
    let current: HTMLTableCellElement | null = null;

    const clear = () => {
      table
        .querySelectorAll('.col-hover, .cell-hover')
        .forEach((n) => n.classList.remove('col-hover', 'cell-hover'));
      current = null;
    };

    /**
     * Mark every cell whose horizontal extent contains `x` (a table-relative
     * offset). Half a pixel of slack keeps a cell that starts exactly on the
     * boundary from being claimed by its left-hand neighbour.
     */
    const markColumn = (x: number) => {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          // The sticky label column is the axis, not a data column: it would
          // otherwise light on every hover, since it is always on screen.
          if (cell.cellIndex === 0) continue;
          const left = cell.offsetLeft;
          if (x >= left + 0.5 && x < left + cell.offsetWidth) {
            cell.classList.add('col-hover');
            break; // one cell per row can contain a given x
          }
        }
      }
    };

    const onMove = (e: MouseEvent) => {
      const cell = (e.target as HTMLElement).closest<HTMLTableCellElement>('td, th');
      if (!cell || !table.contains(cell) || cell.cellIndex === 0) {
        clear();
        return;
      }
      if (cell === current) return;
      clear();
      current = cell;
      markColumn(cell.offsetLeft + cell.offsetWidth / 2);
      cell.classList.add('cell-hover');
    };

    table.addEventListener('mousemove', onMove);
    table.addEventListener('mouseleave', clear);
    return () => {
      table.removeEventListener('mousemove', onMove);
      table.removeEventListener('mouseleave', clear);
      clear();
    };
  }, [ref, enabled]);
}
