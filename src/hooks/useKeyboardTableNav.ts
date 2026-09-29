"use client";

/**
 * useKeyboardTableNav — issue #10
 *
 * Adds full keyboard navigation to any <table> element.
 *
 * Keys supported:
 *   ArrowUp / ArrowDown  — move focus one row up/down within the same column
 *   ArrowLeft / ArrowRight — move focus one cell left/right within the same row
 *   Home                 — jump to first cell in current row
 *   End                  — jump to last cell in current row
 *   PageUp               — jump to first row in current column
 *   PageDown             — jump to last row in current column
 *   Enter / Space        — activate the focused cell (click)
 *
 * Usage:
 *   const tableRef = useKeyboardTableNav<HTMLTableElement>();
 *   return <table ref={tableRef} role="grid"> … </table>;
 *
 * The hook makes all <td> and <th> cells focusable (tabIndex = 0 for the
 * first cell, tabIndex = -1 for the rest) following the ARIA grid pattern.
 */

import { useEffect, useRef } from "react";

export function useKeyboardTableNav<T extends HTMLTableElement = HTMLTableElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const table = ref.current;
    if (!table) return;

    /** Return all interactive cells (td + th) in document order. */
    const getCells = (): HTMLTableCellElement[] =>
      Array.from(table.querySelectorAll<HTMLTableCellElement>("td, th"));

    /** Return a 2-D matrix [row][col] of cells. */
    const getMatrix = (): HTMLTableCellElement[][] => {
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"));
      return rows.map((r) => Array.from(r.querySelectorAll<HTMLTableCellElement>("td, th")));
    };

    /** Find the [row, col] position of a cell in the matrix. */
    const findPosition = (
      matrix: HTMLTableCellElement[][],
      cell: HTMLTableCellElement
    ): [number, number] => {
      for (let r = 0; r < matrix.length; r++) {
        const c = matrix[r].indexOf(cell);
        if (c !== -1) return [r, c];
      }
      return [-1, -1];
    };

    // Initialise tabIndex: first cell is 0, rest are -1 (roving tabindex)
    const cells = getCells();
    cells.forEach((c, i) => {
      c.tabIndex = i === 0 ? 0 : -1;
      // Ensure focusable even when cell contains no interactive child
      if (!c.querySelector("button, a, input, select, textarea")) {
        c.setAttribute("role", "gridcell");
      }
    });

    const focusCell = (cell: HTMLTableCellElement | undefined) => {
      if (!cell) return;
      // Lower current roving focus
      cells.forEach((c) => (c.tabIndex = -1));
      cell.tabIndex = 0;
      cell.focus();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLTableCellElement | null;
      if (!active || !table.contains(active)) return;

      const matrix = getMatrix();
      const [row, col] = findPosition(matrix, active);
      if (row === -1) return;

      const lastRow = matrix.length - 1;
      const lastCol = (matrix[row]?.length ?? 1) - 1;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          focusCell(matrix[Math.max(0, row - 1)]?.[col]);
          break;
        case "ArrowDown":
          e.preventDefault();
          focusCell(matrix[Math.min(lastRow, row + 1)]?.[col]);
          break;
        case "ArrowLeft":
          e.preventDefault();
          focusCell(matrix[row]?.[Math.max(0, col - 1)]);
          break;
        case "ArrowRight":
          e.preventDefault();
          focusCell(matrix[row]?.[Math.min(lastCol, col + 1)]);
          break;
        case "Home":
          e.preventDefault();
          focusCell(matrix[row]?.[0]);
          break;
        case "End":
          e.preventDefault();
          focusCell(matrix[row]?.[lastCol]);
          break;
        case "PageUp":
          e.preventDefault();
          focusCell(matrix[0]?.[col]);
          break;
        case "PageDown":
          e.preventDefault();
          focusCell(matrix[lastRow]?.[col]);
          break;
        case "Enter":
        case " ":
          // Activate: click the first interactive child or the cell itself
          {
            e.preventDefault();
            const child = active.querySelector<HTMLElement>(
              "button:not([disabled]), a[href], input:not([disabled])"
            );
            (child ?? active).click();
          }
          break;
        default:
          break;
      }
    };

    table.addEventListener("keydown", onKeyDown);
    return () => table.removeEventListener("keydown", onKeyDown);
  }, []);

  return ref;
}
