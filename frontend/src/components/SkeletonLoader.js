import React from 'react';
import './SkeletonLoader.css';

/**
 * Skeleton loading component for improved perceived performance.
 * Shows animated placeholders while content is loading.
 */

// Basic skeleton shape
export const Skeleton = ({ 
  width = '100%', 
  height = '1rem', 
  borderRadius = '4px',
  className = '' 
}) => (
  <div 
    className={`skeleton ${className}`}
    style={{ width, height, borderRadius }}
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
    borderRadius="50%" 
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
      <Skeleton width="60px" height="24px" borderRadius="12px" />
      <Skeleton width="80px" height="24px" borderRadius="12px" />
      <Skeleton width="50px" height="24px" borderRadius="12px" />
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
      <Skeleton width="120px" height="32px" borderRadius="16px" />
      <Skeleton width="120px" height="32px" borderRadius="16px" />
    </div>
  </div>
);

// Table row skeleton
export const SkeletonTableRow = ({ columns = 4 }) => (
  <tr className="skeleton-table-row">
    {Array.from({ length: columns }).map((_, index) => (
      <td key={index}>
        <Skeleton width={`${60 + Math.random() * 30}%`} height="1rem" />
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

export default {
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
