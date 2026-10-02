import React from 'react';
import './SkeletonLoader.css';

/**
 * Skeleton loading component for improved perceived performance.
 * Shows animated placeholders while content is loading.
 */

// Basic skeleton shape.
//
// The width/height/borderRadius props are genuinely per-call-site (a 300px
// title bar is not a 100% one), so they stay inline; the colours, motion and
// everything else live in SkeletonLoader.css. `fill` was a JS default that no
// caller ever passed, so the default radius comes from CSS now.
export const Skeleton = ({
  width = '100%',
  height = '1rem',
  className = '',
  circle = false
}) => (
  <div
    className={`skeleton${circle ? ' skeleton--circle' : ''} ${className}`}
    style={{ width, height }}
    aria-hidden="true"
  />
);

// Text line skeleton
export const SkeletonText = ({ lines = 1, lastLineWidth = '60%' }) => (
  <div className="skeleton-text">
    {Array.from({ length: lines }).map((_, index) => (
      <Skeleton 
        key={index}
        width={index === lines - 1 ? lastLineWidth : '100%'}
        height="0.875rem"
        className="skeleton-line"
      />
    ))}
  </div>
);

// Avatar skeleton
export const SkeletonAvatar = ({ size = 60 }) => (
  <Skeleton
    width={`${size}px`}
    height={`${size}px`}
    circle
  />
);

// Card skeleton for package items
export const SkeletonPackageCard = () => (
  <div className="skeleton-package-card" aria-label="Loading package...">
    <div className="skeleton-package-header">
      <SkeletonAvatar size={60} />
      <div className="skeleton-package-info">
        <Skeleton width="40%" height="1.25rem" />
        <Skeleton width="30%" height="0.875rem" />
      </div>
    </div>
    <div className="skeleton-package-body">
      <SkeletonText lines={2} lastLineWidth="80%" />
    </div>
    <div className="skeleton-package-tags">
      <Skeleton className="skeleton--pill" width="60px" height="24px" />
      <Skeleton className="skeleton--pill" width="80px" height="24px" />
      <Skeleton className="skeleton--pill" width="50px" height="24px" />
    </div>
  </div>
);

// List skeleton for search results
export const SkeletonPackageList = ({ count = 5 }) => (
  <div className="skeleton-package-list" role="status" aria-live="polite">
    <span className="visually-hidden">Loading packages...</span>
    {Array.from({ length: count }).map((_, index) => (
      <SkeletonPackageCard key={index} />
    ))}
  </div>
);

// Dashboard card skeleton
export const SkeletonDashboardCard = () => (
  <div className="skeleton-dashboard-card">
    <Skeleton width="60%" height="1.25rem" />
    <Skeleton width="40%" height="0.875rem" className="mt-2" />
    <div className="mt-3">
      <SkeletonText lines={2} />
    </div>
    <div className="skeleton-card-actions mt-3">
      <Skeleton className="skeleton--pill" width="120px" height="32px" />
      <Skeleton className="skeleton--pill" width="120px" height="32px" />
    </div>
  </div>
);

// Table row skeleton
//
// The column widths were randomised with Math.random() in render, so the
// layout shifted on every re-render. Derived from the index instead.
export const SkeletonTableRow = ({ columns = 4 }) => (
  <tr className="skeleton-table-row">
    {Array.from({ length: columns }).map((_, index) => (
      <td key={index}>
        <Skeleton width={`${60 + ((index * 13) % 30)}%`} height="1rem" />
      </td>
    ))}
  </tr>
);

// Full page loading overlay
export const LoadingOverlay = ({ message = 'Loading...' }) => (
  <div className="loading-overlay" role="status" aria-live="polite">
    <div className="loading-content">
      <div className="loading-spinner" />
      <p>{message}</p>
    </div>
  </div>
);

// Inline loading spinner
export const LoadingSpinner = ({ size = 'md', className = '' }) => {
  const sizeClasses = {
    sm: 'spinner-sm',
    md: 'spinner-md',
    lg: 'spinner-lg'
  };
  
  return (
    <div 
      className={`inline-spinner ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label="Loading"
    >
      <span className="visually-hidden">Loading...</span>
    </div>
  );
};

// Named export object for all skeleton components
const SkeletonLoaders = {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonPackageCard,
  SkeletonPackageList,
  SkeletonDashboardCard,
  SkeletonTableRow,
  LoadingOverlay,
  LoadingSpinner
};

export default SkeletonLoaders;
