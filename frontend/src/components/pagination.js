import { useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  MDBPagination,
  MDBPaginationItem,
  MDBPaginationLink,
} from "mdb-react-ui-kit";
import { searchPackage } from "../store/actions/searchActions";

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
    // Scroll to top for better UX
    window.scrollTo({ top: 0, behavior: 'smooth' });
    dispatch(searchPackage(query, page, orderBy));
  }, [dispatch, query, orderBy]);

  // Don't render pagination if only one page
  if (totalPages <= 1) {
    return null;
  }

  const isFirstPage = displayPage === 1;
  const isLastPage = displayPage === totalPages;

  return (
    <nav aria-label="Package search results pagination" className="d-flex justify-content-center mt-4">
      <MDBPagination className="mb-0">
        {/* First page button */}
        {startPage > 1 && (
          <>
            <MDBPaginationItem>
              <MDBPaginationLink
                onClick={() => handlePageChange(0)}
                aria-label="Go to first page"
                style={{ cursor: 'pointer' }}
              >
                <i className="fas fa-angle-double-left" aria-hidden="true"></i>
                <span className="visually-hidden">First</span>
              </MDBPaginationLink>
            </MDBPaginationItem>
            {startPage > 2 && (
              <MDBPaginationItem disabled>
                <MDBPaginationLink>…</MDBPaginationLink>
              </MDBPaginationItem>
            )}
          </>
        )}

        {/* Previous button */}
        <MDBPaginationItem disabled={isFirstPage}>
          <MDBPaginationLink
            onClick={isFirstPage ? undefined : () => handlePageChange(currentPage - 1)}
            aria-label="Go to previous page"
            aria-disabled={isFirstPage}
            style={{ cursor: isFirstPage ? 'not-allowed' : 'pointer' }}
          >
            <i className="fas fa-chevron-left me-1" aria-hidden="true"></i>
            <span className="d-none d-sm-inline">Previous</span>
          </MDBPaginationLink>
        </MDBPaginationItem>

        {/* Page numbers */}
        {pageTiles.map((page) => {
          const isActive = displayPage === page;
          return (
            <MDBPaginationItem key={page} active={isActive}>
              <MDBPaginationLink
                onClick={isActive ? undefined : () => handlePageChange(page - 1)}
                aria-label={isActive ? `Current page, page ${page}` : `Go to page ${page}`}
                aria-current={isActive ? 'page' : undefined}
                style={{ cursor: isActive ? 'default' : 'pointer' }}
              >
                {page}
              </MDBPaginationLink>
            </MDBPaginationItem>
          );
        })}

        {/* Next button */}
        <MDBPaginationItem disabled={isLastPage}>
          <MDBPaginationLink
            onClick={isLastPage ? undefined : () => handlePageChange(currentPage + 1)}
            aria-label="Go to next page"
            aria-disabled={isLastPage}
            style={{ cursor: isLastPage ? 'not-allowed' : 'pointer' }}
          >
            <span className="d-none d-sm-inline">Next</span>
            <i className="fas fa-chevron-right ms-1" aria-hidden="true"></i>
          </MDBPaginationLink>
        </MDBPaginationItem>

        {/* Last page button */}
        {endPage < totalPages && (
          <>
            {endPage < totalPages - 1 && (
              <MDBPaginationItem disabled>
                <MDBPaginationLink>…</MDBPaginationLink>
              </MDBPaginationItem>
            )}
            <MDBPaginationItem>
              <MDBPaginationLink
                onClick={() => handlePageChange(totalPages - 1)}
                aria-label="Go to last page"
                style={{ cursor: 'pointer' }}
              >
                <i className="fas fa-angle-double-right" aria-hidden="true"></i>
                <span className="visually-hidden">Last</span>
              </MDBPaginationLink>
            </MDBPaginationItem>
          </>
        )}
      </MDBPagination>
      
      {/* Page info for screen readers and mobile */}
      <span className="ms-3 align-self-center text-muted small d-none d-md-inline">
        Page {displayPage} of {totalPages}
      </span>
    </nav>
  );
};

export default Pagination;
