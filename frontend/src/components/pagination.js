import { useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { searchPackage } from "../store/actions/searchActions";
import Icon from "./Icon";
import "./pagination.css";

const Pagination = ({ currentPage, totalPages }) => {
  const dispatch = useDispatch();
  const query = useSelector((state) => state.search.query);
  const orderBy = useSelector((state) => state.search.orderBy);

  // Display page (1-indexed for user display)
  const displayPage = currentPage + 1;
  
  const maxVisibleItems = 5;
  
  // Calculate visible page range
  const { startPage, endPage, pageTiles } = useMemo(() => {
    const start = Math.max(displayPage - Math.floor(maxVisibleItems / 2), 1);
    const end = Math.min(start + maxVisibleItems - 1, totalPages);
    // Adjust start if we're near the end
    const adjustedStart = Math.max(end - maxVisibleItems + 1, 1);
    
    const tiles = Array.from(
      { length: end - adjustedStart + 1 },
      (_, i) => i + adjustedStart
    );
    
    return { startPage: adjustedStart, endPage: end, pageTiles: tiles };
  }, [displayPage, totalPages, maxVisibleItems]);

  const handlePageChange = useCallback((page) => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    dispatch(searchPackage(query, page, orderBy));
  }, [dispatch, query, orderBy]);

  // Don't render pagination if only one page
  if (totalPages <= 1) {
    return null;
  }

  const isFirstPage = displayPage === 1;
  const isLastPage = displayPage === totalPages;

  return (
    <nav aria-label="Package search results pagination" className="pagination">
      <ul className="pagination__list">
        {/* First page */}
        {startPage > 1 && (
          <>
            <li>
              <button type="button" className="pagination__link" onClick={() => handlePageChange(0)}>
                <Icon name="angle-double-left" />
                <span className="visually-hidden">First page</span>
              </button>
            </li>
            {startPage > 2 && (
              <li>
                <span className="pagination__gap" aria-hidden="true">…</span>
              </li>
            )}
          </>
        )}

        {/* Previous */}
        <li>
          <button
            type="button"
            className="pagination__link"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={isFirstPage}
          >
            <Icon name="chevron-left" className="me-1" />
            <span className="d-none d-sm-inline">Previous</span>
            <span className="visually-hidden d-sm-none">Previous page</span>
          </button>
        </li>

        {/* Page numbers */}
        {pageTiles.map((page) => {
          const isActive = displayPage === page;
          return (
            <li key={page}>
              <button
                type="button"
                className={`pagination__link${isActive ? " pagination__link--active" : ""}`}
                onClick={() => handlePageChange(page - 1)}
                aria-current={isActive ? "page" : undefined}
                aria-label={`Page ${page}`}
              >
                {page}
              </button>
            </li>
          );
        })}

        {/* Next */}
        <li>
          <button
            type="button"
            className="pagination__link"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={isLastPage}
          >
            <span className="d-none d-sm-inline">Next</span>
            <span className="visually-hidden d-sm-none">Next page</span>
            <Icon name="chevron-right" className="ms-1" />
          </button>
        </li>

        {/* Last page */}
        {endPage < totalPages && (
          <>
            {endPage < totalPages - 1 && (
              <li>
                <span className="pagination__gap" aria-hidden="true">…</span>
              </li>
            )}
            <li>
              <button type="button" className="pagination__link" onClick={() => handlePageChange(totalPages - 1)}>
                <Icon name="angle-double-right" />
                <span className="visually-hidden">Last page</span>
              </button>
            </li>
          </>
        )}
      </ul>

      {/* Position readout. Announced on every page change, which is the point:
          the buttons alone give no sense of how far through the results you are. */}
      <p className="pagination__status" aria-live="polite">
        Page {displayPage} of {totalPages}
      </p>
    </nav>
  );
};

export default Pagination;
